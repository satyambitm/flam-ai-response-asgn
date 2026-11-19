# Worklog

One line per build step (plan.md §7). Times are wall-clock, taken from commit timestamps (2026-11-19/20).
They measure the AI-assisted build session only. Reading the assignment, deciding the design, and reviewing the result happened outside these windows and are not counted here.

| Step | What | Commit time | Took | AI usage / notes |
|---|---|---|---|---|
| 0 | Problem analysis, main-problem.md, plan.md | 23:25–23:45 | ~20m (+ earlier discussion) | Claude Code drafted docs from my decisions (FE/BE split, FastAPI, SDKs, providers) |
| 1 | Backend skeleton: config, /health, CORS, envelope, exception handlers | 23:51 | ~6m | Claude Code wrote code + tests |
| 2 | Lenient JSON extraction + bad-output fixtures | 23:52 | ~2m | Tests caught a truncated-fragment bug; fixed before commit |
| 3 | Theme protocol, registry, echo theme, /themes | 23:53 | ~1m | Added `example` to the protocol (shape hint in prompt + mock output) |
| 4 | Provider protocol, mock provider (11 faults) | 23:53 | <1m | Added a `timeout` fault (hang) separate from `slow` |
| 5 | Pipeline (deadline, chain, one repair), /generate, rate limit | 23:57 | ~4m | Live smoke test of the logs |
| 6 | Gemini/Groq/OpenAI SDK adapters + fallback chain | 00:06 | ~9m | Live runs found gemini-2.5-flash retired, flash models overloaded, Gemini's 10s minimum deadline (fixed) |
| 7 | Render blueprint; build + start verified in a clean venv | 00:07 | ~1m | No Render CLI/login here; one-click deploy left to the account owner |
| 8 | Frontend skeleton, generated API types, api client | 00:13 | ~6m | openapi-typescript needs TS5 (Vite ships TS7), so gen:api runs via npx |
| 9 | Reducer + useGenerate + race tests | 00:15 | ~2m | Race test strengthened to exercise the requestId check |
| 10 | UI shell + UI tests | 00:18 | ~3m | Lint flagged setState-in-effect twice; refactored |
| — | LF line-ending normalization | 00:20 | ~2m | Mixed CRLF/LF from Windows tooling |
| 10b | Token usage + cost per response (meta, UI, logs) | 00:22 | ~2m | Prices from public pricing pages; verified live on all 3 providers |
| 11 | Echo View end to end; every fault + CORS + limiter verified over HTTP | 00:36 | ~14m | Browser automation blocked by extension permissions |
| 13 | Study assistant theme | 00:43 | ~7m | Live-checked quiz answers for correctness on all 3 providers |
| 12 | README | 00:50 | ~7m | |
| 14 | UI redesign: dusk palette, 3D flashcard deck, quiz verdicts, two-pane layout | 01:07 | ~12m | Browser-verified with Claude in Chrome (desktop, 360px, light/dark); found and fixed verdict-vs-selected specificity and mobile control wrap |
| 15 | Provider picker: GET /providers, per-request `providerId`, Model dropdown | 01:32 | ~10m | Live-checked Groq, Gemini and OpenAI via curl and the UI; found the --reload server hadn't picked up the new route and restarted it |
| 16 | Richer study content (sections, hints, details, per-option rationales, skill tags, option shuffle) and a paper redesign: ruled index cards with pointer parallax, one-question quiz sheets, red-pen results | 01:48 | ~35m | Live-checked content from Groq, Gemini and OpenAI; browser-verified desktop and 375px; fixed text-off-rules alignment, duplicate card counter and a ref read during render |
| 17 | Guardrails: input cleaning and `<material>` fencing, security rules, per-request canary + recital/paraphrase leak check (`blocked`), foreign-link stripping, output-token cap, 128 KB body cap, unspoofable rate-limit key, security headers | 02:12 | ~30m | Live red-team, 10 attacks + 2 controls on Groq, Gemini and OpenAI: 0 hijacks. Found and fixed a Gemini paraphrase leak (telltale check), an over-refusal of "300 cards" and `X-Forwarded-For` spoofing in render.yaml; npm audit and pip-audit clean |

**Build session total: ~1h25m** (23:25 → ~00:50).
