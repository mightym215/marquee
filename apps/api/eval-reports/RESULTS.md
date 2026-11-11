# xLAM-2-8b against a frontier model on Marquee's tool-calling suite

Run of 11 November 2026. Raw output in [`comparison.md`](./comparison.md).

Marquee's concierge is an agent with six tools: five MCP tools over TMDB, plus a
`present_picks` tool it calls to show its final answer. The eval suite is 21
requests a real user might make, each with constraints checked against live TMDB
data after the fact, so a model cannot pass by sounding confident.

This asks a narrower question than "which model is better": **where does a small
open action model stop working, and is that edge sharp or ragged?** Each model
ran all 21 cases three times, because a model that passes a case once and fails
it the next time is the interesting result and a single run hides it.

## What ran

| | |
| --- | --- |
| Baseline | `claude-sonnet-5-5`, hosted |
| Local model | `Llama-xLAM-2-8b-fc-r`, q5_K_M community GGUF, served by Ollama 0.40.16 |
| Hardware | Apple M5, 11.8 GiB unified memory, Metal, all 33 layers on GPU |
| Context | 16384, q8_0 KV cache, flash attention |
| Scale | 21 cases × 3 trials × 2 models = 126 runs, 0 errors |

xLAM-2 is Salesforce's open action model family, trained to predict tool calls
rather than prose. It is the natural thing to point this harness at.

## Headline

| Metric | claude-sonnet-5-5 | Llama-xLAM-2-8b (q5_K_M) |
| --- | --- | --- |
| Cases passed, mean of trials | 21 / 21 | 1.3 / 21 |
| Spread across trials | 21–21 | 1–2 |
| Passed every trial | 21 / 21 | 1 / 21 |
| Flaky, passed some and failed some | 0 | 1 |
| Grounded picks | 100% | 100% |
| Latency, mean / p95 | 7.2s / 11.6s | 19.3s / 43.2s |
| Cost per request | $0.0622 | $0 |
| Errors | 0 | 0 |

The baseline passing 21/21 three times with no spread is what makes the rest
readable. It is a flat control, so any variance below belongs to the model under
test rather than to the harness.

## The finding

**It cleared the minimum pick count once in 60 attempts.** `enough picks`
requires three or more verified picks and passed 1.7% of the time. That is the
entire gap. Not taste, not accuracy, not grounding.

**Where it broke, per constraint:**

| Check | claude-sonnet-5-5 | xLAM-2-8b |
| --- | --- | --- |
| enough picks | 100% | **1.7%** |
| declines off topic | 100% | 100% |
| grounded | 100% | 100% |
| genre | 100% | 100% |
| skips watched | 100% | 100% |
| language, rating, runtime, years | 100% | n/a |

The `n/a` cells are not zeros and not perfect scores. They mean the constraint
was never evaluated, because the agent produced no picks to evaluate it against.
That distinction is the subject of the scorer fix described below, and without it
those four rows read 100% and the table says the opposite of the truth.

**Grounding held.** Every pick xLAM produced resolved to a movie id that came out
of a real tool result. It never invented a film. The eval looks up any id the
agent did not see in a tool result rather than trusting it, and nothing needed
looking up. Over a small number of picks, but the failure is not hallucination.

**Retrieval and tool selection held.** A single case traced step by step:

```
step 1  search_movies       {"query":"Interstellar"}            ok, 10 movies
step 2  get_recommendations {"movie_id":287954}                 ok, 10 movies
step 3  discover_movies     {"query":"Comedy, Science Fiction"} ok, 10 movies
step 4  present_picks       {"picks":[{"title":"Barbarella","year":1968, ...}]}  FAILED
step 5  present_picks       {}                                  FAILED
step 6  []
```

287954 is Interstellar's real TMDB id. The model read the first tool result and
carried a value out of it into the next call. Three correct tool choices in a
row, and by step 3 it had ten plausible comedy science fiction films in hand.

**It broke on the output schema.** `present_picks` declares
`{picks: [{movie_id: integer, reason: string}]}`. The model sent
`{title, year, rating, genres, language}`: a sensible description of a movie, and
not the declared shape. It knows what to present and does not carry the id
through. Handed the validation error, it retried with `{}`, then emitted an empty
array and stopped.

**The only case it passed in every trial requires producing no structured output
at all.** That case is "What's the capital of France?", where passing means
declining and showing no picks.

So the shape of the edge: **retrieval and grounding are solid, multi-step state
carries, and structured output against a nested schema is the wall.**

## Is the wall absolute, or intermittent?

Intermittent, which is the harder problem.

Three full runs happened on 11 November, nine trials in all. xLAM scored between
1 and 2 out of 21 in this run and between 1 and 3 across all of them. The case
that moves is the interesting part. "A cozy movie under 2 hours" has, across
those runs, passed outright, failed on `runtime ≤ 120 min` having produced real
picks that were simply too long, and failed on `enough picks` having produced
none at all. Same prompt, same model, same settings, three different failure
modes.

A capability that appears intermittently is harder to design around than one
that is missing, because the failure does not announce itself. That gap between
what a model can do and what it reliably does is what Salesforce AI Research
calls jagged intelligence, and it is what this harness is pointed at.

## Three things that had to be fixed before any number meant anything

Each one produced a confident, publishable, wrong result first.

**The model was running two thirds on CPU.** The community Ollama tag inherits
`num_ctx` from the model's 131072 train context, and `OLLAMA_CONTEXT_LENGTH` does
not override it. That reserved an 8.7 GB KV cache on a 12 GB GPU, pushed 9 of 33
layers onto the CPU, and dropped generation to **0.56 tokens per second**. The
latency column would have measured memory pressure. Pinning a 16384 context in a
derived Modelfile keeps every layer on the GPU and brought it to about 22 tokens
per second.

**The runtime was dropping the model's tool calls.** xLAM returns tool calls as
its own JSON in the message content:

```json
[{"name": "search_movies", "arguments": {"query": "Interstellar"}}]
```

Lifting that into OpenAI's `tool_calls` field is the serving stack's job. vLLM
does it with `--tool-call-parser xlam`, llama.cpp with `--jinja`. Ollama renders
the tools into the prompt but ships no xLAM parser, so correct tool calls arrived
as prose, the agent saw no call, and a smoke test returned 0/3. The model had
chosen the right tool with the right argument every time.

The adapter now recovers those calls, guarded so recovery only happens when the
server returned no tool calls of its own, the whole content parses as JSON, and
every entry names a tool the request actually declared. In this run it recovered
**100 tool calls across 162 requests**. Without it, most of what the model did
would have been invisible and the published number would have measured Ollama.

**The scorer was crediting constraints it never checked.** Each per pick
constraint scored `hits === total` over the picks produced. With no picks that is
`0 === 0`, so every genre, year, runtime, language and rating check passed for
free on exactly the cases the agent failed hardest. An earlier run therefore
reported xLAM at 100% on five constraint types and 97.7% on genre, which read as
a model that satisfied nearly every rule while failing nearly every case. A
constraint with nothing to evaluate is now reported as not applicable rather than
passed, which is where the `n/a` cells above come from.

None of the three would have surfaced from the pass rate. Two were found by
running a single case with every tool call printed, and the third by asking why a
failing model had perfect constraint scores.

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
4. **The passing figures for xLAM rest on very few picks.** Grounding, genre and
   skips-watched at 100% are real but measured over the handful of picks it
   managed to produce: 4 picks for grounding and a single case for genre, against
   252 and 24 for the baseline. As bare percentages those read as the same claim
   as the baseline's and they are not. `analyze.py` prints a 95% Wilson interval
   beside every rate for this reason, and xLAM's genre figure carries an interval
   of roughly 21% to 100%. They are evidence its picks were not junk, not that it
   reliably satisfies those constraints.

The obvious next run is the official GGUF through llama.cpp with `--jinja`, which
removes the first two at once.

## What was deliberately not done

`present_picks` was left exactly as the baseline model faces it. Relaxing it to
accept `{title, year}` and resolving ids afterwards would have raised xLAM's
score immediately and made the number meaningless. A benchmark that gets adjusted
until the model passes is not measuring the model.

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
