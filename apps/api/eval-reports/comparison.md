# Tool-calling comparison

21 cases · 3 trials each · 2026-11-11 21:52 UTC

Every pick is checked against live TMDB data, so a model cannot pass by sounding confident.

| Metric | claude-sonnet-5-5 | Llama-xLAM-2-8b (q5_K_M) |
| --- | --- | --- |
| Cases passed (mean of trials) | 21 / 21 | 1.3 / 21 |
| Spread across trials | 21–21 | 1–2 |
| Passed every trial | 21 / 21 | 1 / 21 |
| Flaky (passed some, failed some) | 0 | 1 |
| Grounded picks | 100% | 100% |
| Latency, mean / p95 | 7.2s / 11.6s | 19.3s / 43.2s |
| Cost per request | $0.0622 | $0 (local) |
| Errors | 0 | 0 |

## Where each model breaks

Pass rate per constraint type, pooled across trials.

| Check | claude-sonnet-5-5 | Llama-xLAM-2-8b (q5_K_M) |
| --- | --- | --- |
| declines off topic | 100% | 100% |
| enough picks | 100% | 1.7% |
| genre | 100% | 100% |
| grounded | 100% | 100% |
| language | 100% | n/a |
| rating | 100% | n/a |
| runtime | 100% | n/a |
| skips watched | 100% | 100% |
| years | 100% | n/a |

## Case by case

Trials passed out of 3.

| Case | claude-sonnet-5-5 | Llama-xLAM-2-8b (q5_K_M) |
| --- | --- | --- |
| Something like Interstellar, but funny | ✅ 3/3 | ❌ 0/3 enough picks |
| A cozy movie under 2 hours | ✅ 3/3 | ❌ 0/3 enough picks |
| The best Korean thrillers | ✅ 3/3 | ❌ 0/3 enough picks |
| A 90s classic I probably missed | ✅ 3/3 | ❌ 0/3 enough picks |
| Animated movies for a family movie night | ✅ 3/3 | ❌ 0/3 enough picks |
| A horror movie from the 2010s | ✅ 3/3 | ❌ 0/3 enough picks |
| Something like Parasite | ✅ 3/3 | ❌ 0/3 enough picks |
| A great music documentary | ✅ 3/3 | ❌ 0/3 enough picks |
| A romantic comedy from the 2000s | ✅ 3/3 | ❌ 0/3 enough picks |
| A war movie under two and a half hours | ✅ 3/3 | ❌ 0/3 enough picks |
| Japanese animated films like Spirited Away | ✅ 3/3 | ❌ 0/3 enough picks |
| Science fiction from before 1985 | ✅ 3/3 | ❌ 0/3 enough picks |
| More space movies like the ones I've watched | ✅ 3/3 | ⚠️ 1/3 enough picks |
| A western worth watching | ✅ 3/3 | ❌ 0/3 enough picks |
| A mystery under 100 minutes | ✅ 3/3 | ❌ 0/3 enough picks |
| What's the capital of France? | ✅ 3/3 | ✅ 3/3 |
| A French romance | ✅ 3/3 | ❌ 0/3 enough picks |
| Highly rated crime movies from the 70s | ✅ 3/3 | ❌ 0/3 enough picks |
| Something good that came out in the last two years | ✅ 3/3 | ❌ 0/3 enough picks |
| A smart heist movie from the 2000s | ✅ 3/3 | ❌ 0/3 enough picks |
| Pick something based on my 5 star films | ✅ 3/3 | ❌ 0/3 enough picks |

## Setup

- **claude-sonnet-5-5** (`claude-sonnet-5-5`) — hosted frontier model
- **Llama-xLAM-2-8b (q5_K_M)** (`xlam-8b-16k`) — community GGUF via Ollama, Apple M5, 16K ctx — tool calls were not returned in the OpenAI tool_calls field; 100 were recovered from the model's own JSON content across 162 requests
