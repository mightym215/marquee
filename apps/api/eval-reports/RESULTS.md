# xLAM-2-8b against a frontier model on Marquee's tool-calling suite

First run: 11 November 2026. Raw output in [`comparison.md`](./comparison.md).

Marquee's concierge is an agent with six tools: five MCP tools over TMDB, plus a
`present_picks` tool it calls to show its final answer. The eval suite is 21
requests a real user might make, each with constraints checked against live TMDB
data after the fact, so a model cannot pass by sounding confident.

This run asks a narrower question than "which model is better": **where does a
small open action model stop working, and is that edge sharp or ragged?** Each
model ran all 21 cases three times, because a model that passes a case once and
fails it the next time is the interesting result and a single run hides it.

## What ran

| | |
| --- | --- |
| Baseline | `claude-sonnet-5-5`, hosted |
| Local model | `Llama-xLAM-2-8b-fc-r`, q5_K_M community GGUF, served by Ollama 0.40.16 |
| Hardware | Apple M5, 11.8 GiB unified memory, Metal, all 33 layers on GPU |
| Context | 16384, q8_0 KV cache, flash attention |
| Cases | 21 × 3 trials × 2 models = 126 runs |

xLAM-2 is Salesforce's open action model family, trained to predict tool calls
rather than prose. It is the natural thing to point this harness at.

## Headline

| Metric | claude-sonnet-5-5 | Llama-xLAM-2-8b (q5_K_M) |
| --- | --- | --- |
| Cases passed, mean of trials | 21 / 21 | 2 / 21 |
| Spread across trials | 21–21 | 1–3 |
| Passed every trial | 21 / 21 | 1 / 21 |
| Flaky, passed some and failed some | 0 | 2 |
| Grounded picks | 100% | 100% |
| Latency, mean / p95 | 7.3s / 11.7s | 23.1s / 80.5s |
| Cost per request | $0.0640 | $0 |
| Errors | 0 | 1 |

9.5% against 100%. That number on its own is not the finding, and taken alone it
is misleading about what the model can do.

## The finding

**Grounding held at 100%.** Every pick xLAM produced resolved to a movie id that
came out of a real tool result. It never invented a film. The eval looks up any
id the agent did not see in a tool result rather than trusting it, and nothing
needed looking up. Whatever is failing, it is not hallucination. This is
measured over the picks it actually produced, which on this run was a small
number.

**Retrieval and tool selection held.** A single case traced step by step:

```
step 1  search_movies      {"query":"Interstellar"}           ok, 10 movies
step 2  get_recommendations {"movie_id":287954}               ok, 10 movies
step 3  discover_movies    {"query":"Comedy, Science Fiction"} ok, 10 movies
step 4  present_picks      {"picks":[{"title":"Barbarella","year":1968, ...}]}  FAILED
step 5  present_picks      {}                                 FAILED
step 6  []
```

287954 is Interstellar's real TMDB id. The model read the first tool result and
carried a value out of it into the next call. Three correct tool choices in a
row, and by step 3 it had ten plausible comedy science fiction films in hand.

**It broke on the output schema.** `present_picks` declares
`{picks: [{movie_id: integer, reason: string}]}`. The model sent
`{title, year, rating, genres, language}`: a sensible description of a movie, and
not the declared shape. It knows what to present and does not carry the id
through. Given the validation error back, it retried with `{}`, then emitted an
empty array and stopped.

**The only case it passed in all three trials requires producing no structured
output at all.** That case is "What's the capital of France?", where passing
means declining and showing no picks. Everything that required filling a nested
schema was 0/3, except two:

| Case | claude-sonnet-5-5 | xLAM-2-8b |
| --- | --- | --- |
| What's the capital of France? | 3/3 | 3/3 |
| A cozy movie under 2 hours | 3/3 | 2/3 |
| More space movies like the ones I've watched | 3/3 | 1/3 |
| the other 18 | 3/3 | 0/3 |

Those two are the whole reason this ran three times. The schema is not impossible
for the model, it is intermittent. In one trial a case failed on
`genre: any of Comedy` rather than `enough picks`, meaning it cleared
`present_picks` that time and simply picked badly. An intermittent capability is
harder to design around than a missing one, because the failure does not announce
itself.

So the shape of the edge, on this harness: **retrieval and grounding are solid,
multi-step state carries, and structured output against a nested schema is the
wall.**

## A measurement bug in this run's per constraint table

`comparison.md` has a "Where each model breaks" table giving xLAM 100% on
language, rating, runtime, years and skips watched, and 97.7% on genre. **Those
figures are inflated and should not be read as the model satisfying those
constraints.**

Each per pick constraint was scored `hits === total` over the picks produced.
With no picks that is `0 === 0`, so every constraint passed for free on exactly
the cases the agent failed hardest. Since xLAM produced no picks on most cases,
most of those passes were vacuous.

The scorer now omits a constraint it had no picks to evaluate, so pooled rates
count only checks that actually ran. Case verdicts are unaffected, because a
case with no picks already fails on `enough picks`, so the headline table above
and the case by case results stand. The per constraint table in this run's
`comparison.md` predates the fix.

The two figures in it that were never vacuous are `enough picks` at **6.8%** and
grounding, which is computed over real picks rather than by that comparison.

## Two things that had to be fixed before any number meant anything

Both produced confident, wrong results first.

**The runtime was dropping the model's tool calls.** xLAM returns tool calls as
its own JSON in the message content:

```json
[{"name": "search_movies", "arguments": {"query": "Interstellar"}}]
```

Lifting that into OpenAI's `tool_calls` field is the serving stack's job. vLLM
does it with `--tool-call-parser xlam` and llama.cpp with `--jinja`. Ollama
renders the tools into the prompt but ships no xLAM parser, so correct tool calls
arrived as prose, the agent saw no call, and a smoke test returned 0/3. The model
had chosen the right tool with the right argument every time.

The adapter now recovers those calls, guarded so that recovery only happens when
the server returned no tool calls of its own, the whole content parses as JSON,
and every entry names a tool the request actually declared. In this run it
recovered **110 tool calls across 172 requests**. Without it roughly two thirds of
what the model did would have been invisible, and the published number would have
measured Ollama.

**The model was running two thirds on CPU.** The community Ollama tag inherits
`num_ctx` from the model's 131072 train context, and `OLLAMA_CONTEXT_LENGTH` does
not override it. That reserved an 8.7 GB KV cache on a 12 GB GPU, pushed 9 of 33
layers onto the CPU, and dropped generation to **0.56 tokens per second**. The
latency column would have measured memory pressure. Pinning a 16384 context in a
derived Modelfile keeps every layer on the GPU and brought it to about 22 tokens
per second.

Neither of these would have surfaced from the pass rate. Both were found by
running one case with every tool call printed.

## Limitations

Worth stating plainly, because they bound the claim.

1. **The system prompt was written for Claude.** xLAM-2 was trained with its own
   tool-calling prompt format, and this harness gives both models the same
   Claude-shaped prompt. Running Salesforce's official GGUF under
   `llama-server --jinja` would apply the model's own template and is the honest
   test of whether the schema failures survive. Until that runs, the claim is
   "under a shared harness," not "xLAM cannot do nested schemas."
2. **This is a community q5_K_M quantization**, not Salesforce's official
   weights. Quantization can cost structured-output precision specifically.
3. **8B against a frontier model is not size matched.** Salesforce's published
   τ-bench results are for the 70b. This says nothing about that model.
4. **One trial hit a timeout** on "A French romance" and is counted as an error,
   not a failure.
5. **The per constraint table in this run's `comparison.md` was produced by the
   old scorer** and overstates xLAM on every constraint except `enough picks`.
   See the section above. Rerunning regenerates it correctly.

The obvious next run is the official GGUF through llama.cpp with `--jinja`, which
removes limitations 1 and 2 at once.

## What was deliberately not done

`present_picks` was left exactly as the baseline model faces it. Relaxing it to
accept `{title, year}` and resolving ids afterwards would have raised xLAM's score
immediately, and would have made the number meaningless. A benchmark that gets
adjusted until the model passes is not measuring the model.

## Reproducing

```bash
ollama create xlam-8b-16k -f apps/api/src/eval/xlam-8b.Modelfile

XLAM_MODEL=xlam-8b-16k \
XLAM_LABEL="Llama-xLAM-2-8b (q5_K_M)" \
npm run eval:compare -- --models claude,xlam --trials 3
```

To see why a single case failed, with every tool call and its real arguments:

```bash
npm run eval:inspect -- --model xlam --case 0
```

Setup details and flags are in [`../src/eval/README.md`](../src/eval/README.md).
