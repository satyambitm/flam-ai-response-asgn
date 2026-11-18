# Worklog

One line per build step (plan.md §7). Times are wall-clock.

| Step | What | Time | AI usage |
|---|---|---|---|
| 0 | Problem analysis, plan.md, main-problem.md | 1h00 | Claude Code drafted the docs from my decisions; I chose the stack and split |
| 1 | Backend skeleton: config, /health, CORS, envelope, exception handlers | 0h10 | Claude Code wrote code + tests from plan.md |
| 2 | Lenient JSON extraction + bad-output fixtures | 0h10 | Claude Code wrote extractor + tests; tests caught a truncated-fragment bug, fixed |
| 3 | Theme protocol, registry, echo theme, /themes | 0h10 | Claude Code; added `example` to the protocol (shape hint in prompt + mock output) |
| 4 | Provider protocol, ProviderError, mock provider (11 faults) | 0h10 | Claude Code; added a `timeout` fault (hang) separate from `slow` (delayed success) |
| 5 | Pipeline (deadline, provider chain, one repair), /generate, per-IP rate limit, full pytest matrix | 0h25 | Claude Code wrote pipeline + 60 tests; I ran a live smoke test of the logs |
| 6 | Gemini/Groq/OpenAI SDK adapters, fallback chain, exception-mapping tests, live check of all 3 keys | 0h35 | Claude Code; live runs found gemini-2.5-flash retired (404), flash models overloaded, and a Gemini 10s minimum deadline (fixed) |
| 7 | Render blueprint (render.yaml); Render build + start command verified locally in a clean 3.12 venv | 0h10 | Claude Code; no Render CLI/login here, so the one-click Blueprint deploy is left to the account owner |
| 8 | Frontend skeleton: Vite + React + TS, generated API types, never-throwing api client + envelope guard | 0h20 | Claude Code; openapi-typescript needs TS5 while Vite ships TS7, so gen:api runs via npx in isolation |
| 9 | GenState reducer + useGenerate (abort + requestId guard) + reducer/race/cancel/unmount tests | 0h20 | Claude Code; strengthened the race test so it exercises the requestId check, not just the status check |
| 10 | UI shell: input, loading (cold-start hint), error (per kind, 429 countdown), empty, ErrorBoundary, DevFaultPanel, mobile CSS + UI tests | 0h35 | Claude Code; lint flagged setState-in-effect twice, refactored to derived state |
