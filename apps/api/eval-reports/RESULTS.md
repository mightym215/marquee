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

> **Read [Serving is most of the story](#serving-is-most-of-the-story) before the
> scores.** Three separate serving configurations were tried. Two of the three
> destroyed the model's tool calls before the agent ever saw them, in opposite
> ways, and under its own chat template the model emits correct tool calls that
> the runtime then discards. The pass rates below are real, and they are bounded
> by that.

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

The baseline passing 21/21 in all three trials is what makes the rest readable.
A near flat control means the variance below belongs to the model under test
rather than to the harness.

It is near flat rather than perfectly flat. Across nine baseline trials run that
day, eight scored 21/21 and one scored 20/21, so 188 of 189 case runs passed.
The baseline has a little variance of its own, and a reading of these numbers
that treats it as a fixed ceiling is slightly too generous to it.

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

## Serving is most of the story

Three serving configurations were tried. The model is the same in all three.

| Setup | Result |
| --- | --- |
| Community GGUF, Ollama, no tool-call parser | Tool calls arrive as prose. Silent. Looks like 0% capability |
| Official GGUF, llama.cpp 0.9.0, `--jinja` | Correct tool calls rejected by the grammar. **59 of 63 requests return HTTP 500** |
| Community GGUF, Ollama, adapter recovers calls from content | Runs. This produced the numbers above |

**Ollama ships no parser for this model's output format.** It renders the tool
definitions into the prompt but logs `parser=""`, so the model's tool calls come
back in the message content and any OpenAI-compatible client sees none. Nothing
errors. The agent simply stops at step one.

**llama.cpp has a parser and it is too strict.** With `--jinja` the model's own
chat template is applied, which is what we wanted, and generation runs normally.
Then the grammar rejects the result and the whole turn 500s:

```
common_chat_peg_parse: unparsed peg-native output:
  {"name": "search_movies", "arguments": {"query": "Korean thriller"}}]
srv operator(): got exception: {"error":{"code":500,
  "message":"The model produced output that does not match the expected peg-native format"}}
```

Note the trailing `]` with no opening bracket. xLAM emits an **array** of calls.
The grammar expects a bare object, parses the object, and fails on the closing
bracket. Of 63 agent turns, 59 returned 500. The 4 that did not were the off
topic case, where the correct answer is prose and no tool call is produced, so
the parser never engages.

This is a known llama.cpp problem rather than an xLAM one: the same error is
open against Gemma 4, Qwen3.5 and gpt-oss, and a Docker Model Runner maintainer
attributes it to an upstream grammar that accepts only one tool call per turn.

**What that run does tell us is the most useful thing in this document.** Under
its own chat template, the calls the model produced before being rejected are
correct:

```json
{"name": "discover_movies", "arguments": {"genres": ["Horror"], "year_from": 2010, "year_to": 2019}}
{"name": "search_movies",   "arguments": {"query": "war", "max_runtime_minutes": 150}}
{"name": "search_movies",   "arguments": {"query": "romantic comedy", "year": 2000}}
{"name": "get_recommendations", "arguments": {"movie_id": 550}}
```

"A horror movie from the 2010s" became the right tool with the right genre and
the right year range. "A war movie under two and a half hours" became a search
carrying a runtime limit. That is correct tool selection and correct parameter
construction, thrown away by the serving layer.

Two real model errors are visible in the same logs and are worth keeping in
view. It emitted `{"name": "list_genres", "arguments": {}}`, which is not one of
the declared tools, and it reached for `movie_id: 550` for "Something like
Parasite", which is Fight Club's TMDB id and came from memory rather than from
any tool result. The grounding check exists for exactly that.

**What this does and does not settle.** It settles that the model's tool call
emission is well formed under its own template, so the scores above are not
explained by it being unable to call tools. It does not settle the
`present_picks` failure, because every llama.cpp turn died at step one and the
run never reached the final structured output step under the model's own
template. That question is still open, and it needs a runtime that can parse
this model: vLLM with `--tool-call-parser xlam`, or llama.cpp once the grammar
accepts an array.

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

1. **The scored run used a Claude-shaped system prompt.** xLAM-2 was trained with
   its own tool-calling prompt format, and the harness gives both models the same
   prompt. The attempt to remove this, Salesforce's official GGUF under
   `llama-server --jinja`, could not complete because the runtime 500s on the
   model's output. What came back from it is still informative: under its own
   template the model's tool calls are well formed, so the scores are not
   explained by prompt format at the tool-call level. Whether the
   `present_picks` schema failures survive a correct template is untested,
   because no turn got that far. The claim remains "under a shared harness."
2. **The scored run used a community q5_K_M quantization**, not Salesforce's
   official weights. The official Q5_K_M was obtained and loaded, but the
   llama.cpp parser prevented a scored run. Quantization can cost
   structured-output precision specifically, so this is untested.
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

Removing the first two needs a runtime that can read this model's output.
vLLM with `--tool-call-parser xlam` is the documented path and needs a GPU.
llama.cpp would work once its grammar accepts an array of calls.

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
