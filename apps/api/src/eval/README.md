# Tool-calling evaluation

Two runners live here.

- `npm run eval` scores the concierge against every case on one model and writes `eval-reports/latest.md`.
- `npm run eval:compare` runs the same cases against two or more models, several trials each, and writes `eval-reports/comparison.md`.

Results of the first comparison run, with the limitations that bound them, are in [`eval-reports/RESULTS.md`](../../eval-reports/RESULTS.md).

The comparison exists to measure **consistency**, not just accuracy. A model that passes a case on one attempt and fails it on the next is the interesting result, and a single run hides it. That gap between what a model can do and what it reliably does is what Salesforce AI Research calls jagged intelligence, and it is the thing this harness is pointed at.

Every pick is verified against live TMDB data, so a model cannot pass by sounding confident.

## Running a comparison

```bash
npm run eval:compare -- --models claude,xlam --trials 3
npm run eval:compare -- --models xlam --trials 1 --cases 5   # quick smoke test
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--models` | `claude,xlam` | Comma-separated keys from `models.ts` |
| `--trials` | `3` | Runs per model. Use 1 while debugging, 3+ for real numbers |
| `--cases` | all | First N cases only |
| `--out` | `comparison` | Report name, so two serving setups don't overwrite each other |

`TMDB_API_KEY` is always required. Claude needs `ANTHROPIC_API_KEY`. Local models need a server already running.

## Running xLAM locally

Salesforce's xLAM models predict tool calls rather than text, which is exactly what this agent asks for. They are open weights under Apache 2.0.

### Ollama (simplest on a Mac)

```bash
brew install ollama
ollama serve   # leave running in its own tab
ollama pull robbiemu/Salesforce_Llama-xLAM-2:8b-fc-r-q5_K_M
```

That is a community repackage of `Llama-xLAM-2-8b-fc-r`. There is no `latest` tag, so the quantization has to be named: `8b-fc-r-q3_K_M`, `8b-fc-r-q5_K_M`, `8b-fc-r-q8_0`, or `8b-fc-r-bf16`. q5 is 5.3 GB of weights.

**Build the derived tag before running it.** The upstream tag pins `num_ctx` to the model's full 131072 train context, and `OLLAMA_CONTEXT_LENGTH` does not override it. On a 12 GB GPU that reserves an 8.7 GB KV cache, pushes a third of the layers onto the CPU, and drops generation to **0.56 tok/s**, which measures the spill rather than the model:

```bash
ollama create xlam-8b-16k -f apps/api/src/eval/xlam-8b.Modelfile
```

Ollama serves an OpenAI-compatible API on `http://localhost:11434/v1`, which is the default this runner expects. Name the tag, and label it so the report says which checkpoint produced the numbers:

```bash
XLAM_MODEL=xlam-8b-16k \
XLAM_LABEL="Llama-xLAM-2-8b (q5_K_M)" \
XLAM_NOTE="community GGUF, Ollama, Apple M5, 16K ctx, all layers on GPU" \
npm run eval:compare -- --models claude,xlam --trials 3
```

Confirm the fix in the `ollama serve` log before trusting any timing number. `offloaded 33/33 layers to GPU` is what you want; anything less and the latency column is measuring memory pressure.

`XLAM_LABEL` defaults to the model id, so an unlabeled run is still honest about what ran. It is never silently labeled 3b.

### llama.cpp (official GGUF weights)

Salesforce publishes its own GGUF builds, which ship the chat template the model was trained with. `llama-server` pulls them straight from Hugging Face:

```bash
brew install llama.cpp
llama-server -hf Salesforce/xLAM-2-3b-fc-r-gguf:Q4_K_M --port 8080 --jinja
```

```bash
XLAM_BASE_URL=http://localhost:8080/v1 \
XLAM_MODEL=xLAM-2-3b-fc-r \
XLAM_LABEL="xLAM-2-3b-fc-r (Q4_K_M)" \
npm run eval:compare -- --models xlam --trials 3
```

`--jinja` is not optional. Without it llama.cpp ignores the model's own template and the model returns tool calls as prose, which the adapter counts as malformed rather than as a tool call. Official sizes: `xLAM-2-1b-fc-r-gguf`, `xLAM-2-3b-fc-r-gguf`, `Llama-xLAM-2-8b-fc-r-gguf`.

### vLLM (if you have a GPU)

```bash
pip install "vllm>=0.6.5"
vllm serve Salesforce/xLAM-2-3b-fc-r --enable-auto-tool-choice --tool-call-parser xlam
XLAM_BASE_URL=http://localhost:8000/v1 npm run eval:compare -- --models claude,xlam
```

## When a server has no parser for the model's tool calls

xLAM returns tool calls as its own JSON in the message content:

```json
[{"name": "search_movies", "arguments": {"query": "Interstellar"}}]
```

Lifting that into OpenAI's `tool_calls` field is the serving stack's job. vLLM does it with `--tool-call-parser xlam`, llama.cpp with `--jinja`. Ollama renders your tools into the prompt but ships no xLAM parser, so the call arrives as prose, the agent sees no tool call, and every case fails at the first step with zero picks. That result says nothing about the model.

The adapter recovers those calls so the comparison measures the model's decision rather than the server's missing parser. It only does so when the server returned no tool calls of its own, the whole content parses as JSON, and **every** entry names a tool the request actually declared. Anything else stays text, so a recovery can never invent a call the model did not make.

Recoveries are counted and written into the report's Setup section, because needing one is a finding about the serving stack and changes how the numbers should be read. `npm run eval:inspect` prints the count for a single case.

## Diagnosing one case

```bash
npm run eval:inspect -- --model xlam --case 0
```

Runs one case and prints every tool call with its real arguments, the picks, and the adapter counters. The comparison tells you a case failed and names the check; this tells you why.

## Analyzing a run

```bash
python3 apps/api/src/eval/analyze.py apps/api/eval-reports/comparison.json
python3 apps/api/src/eval/analyze.py run1.json run2.json --plot consistency.png
```

`comparison.md` says what happened in one run. This answers two things it cannot.

**How much of a gap is real and how much is sample size.** Every rate gets a 95% Wilson score interval and its sample size. It matters more than it sounds: in the first run xLAM showed 100% on genre and 100% on grounding, the same figures the baseline showed. The baseline's were pooled over all 63 runs. xLAM's were pooled over the handful of runs that produced any picks at all, since `enough picks` passed 1.7% of the time. Rendered as bare percentages those look like the same claim. With an interval and an n beside them they do not.

**Whether a case fails the same way every time.** Pass several reports and per case results pool across every trial in every run, so a case that alternates is separated from one that never works. The second is a missing capability; the first is a jagged one, and it is the harder problem.

Standard library only. `--plot` needs matplotlib and is skipped with a note if it is not installed.

## Adding a model

Add an entry to `BACKENDS` in `models.ts`. Anything that speaks OpenAI chat completions works:

```ts
mistral: {
  key: "mistral",
  label: "Mistral 7B",
  provider: "openai-compat",
  model: "mistral:7b",
  baseUrl: "http://localhost:11434/v1",
  price: { input: 0, output: 0 },
}
```

## Reading the report

| Row | What it tells you |
| --- | --- |
| Cases passed (mean of trials) | Headline accuracy |
| Spread across trials | How much the same model varies run to run |
| Passed every trial | The strict number, and usually the honest one |
| Flaky | Cases it passed sometimes. The jagged ones |
| Where each model breaks | Pass rate per constraint type, so failures have a shape |
| Case by case | Per case, how many trials passed and which check broke |

A local model losing on accuracy is not the finding. *Where* it loses is.

## Environment

| Variable | Purpose |
| --- | --- |
| `TMDB_API_KEY` | Required. Verifies every pick |
| `ANTHROPIC_API_KEY` | Required for the `claude` backend |
| `XLAM_BASE_URL` | Local server, default `http://localhost:11434/v1` |
| `XLAM_MODEL` | Model id or Ollama tag, including the quantization |
| `XLAM_LABEL` | Column header in the report. Defaults to `XLAM_MODEL` |
| `XLAM_NOTE` | Printed under Setup, for the hardware and quantization |
| `EVAL_TIMEOUT_MS` | Per request, default 300000. Small models on CPU are slow |
| `EVAL_CONCURRENCY` | Defaults to 2 for hosted, 1 for local |
