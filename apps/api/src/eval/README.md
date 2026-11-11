# Tool-calling evaluation

Two runners live here.

- `npm run eval` scores the concierge against every case on one model and writes `eval-reports/latest.md`.
- `npm run eval:compare` runs the same cases against two or more models, several trials each, and writes `eval-reports/comparison.md`.

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

`TMDB_API_KEY` is always required. Claude needs `ANTHROPIC_API_KEY`. Local models need a server already running.

## Running xLAM locally

Salesforce's xLAM models predict tool calls rather than text, which is exactly what this agent asks for. They are open weights under Apache 2.0.

### Ollama (simplest on a Mac)

```bash
brew install ollama
ollama serve                                   # leave running
ollama pull robbiemu/Salesforce_Llama-xLAM-2   # community port
```

Ollama serves an OpenAI-compatible API on `http://localhost:11434/v1`, which is the default this runner expects. Point it at whatever tag you pulled:

```bash
XLAM_MODEL=robbiemu/Salesforce_Llama-xLAM-2 npm run eval:compare -- --models claude,xlam --trials 3
```

### llama.cpp (official GGUF weights)

Salesforce publishes GGUF builds at `Salesforce/xLAM-2-3b-fc-r-gguf`. With `llama-server` running:

```bash
llama-server -m xLAM-2-3b-fc-r-Q4_K_M.gguf --port 8080 --jinja
XLAM_BASE_URL=http://localhost:8080/v1 npm run eval:compare -- --models xlam --trials 3
```

### vLLM (if you have a GPU)

```bash
pip install "vllm>=0.6.5"
vllm serve Salesforce/xLAM-2-3b-fc-r --enable-auto-tool-choice --tool-call-parser xlam
XLAM_BASE_URL=http://localhost:8000/v1 npm run eval:compare -- --models claude,xlam
```

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
| `XLAM_MODEL` | Model id or Ollama tag |
| `EVAL_TIMEOUT_MS` | Per request, default 300000. Small models on CPU are slow |
| `EVAL_CONCURRENCY` | Defaults to 2 for hosted, 1 for local |
