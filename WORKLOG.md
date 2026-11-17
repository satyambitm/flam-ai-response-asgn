# Worklog

One line per build step (plan.md §7). Times are wall-clock.

| Step | What | Time | AI usage |
|---|---|---|---|
| 0 | Problem analysis, plan.md, main-problem.md | 1h00 | Claude Code drafted the docs from my decisions; I chose the stack and split |
| 1 | Backend skeleton: config, /health, CORS, envelope, exception handlers | 0h10 | Claude Code wrote code + tests from plan.md |
| 2 | Lenient JSON extraction + bad-output fixtures | 0h10 | Claude Code wrote extractor + tests; tests caught a truncated-fragment bug, fixed |
| 3 | Theme protocol, registry, echo theme, /themes | 0h10 | Claude Code; added `example` to the protocol (shape hint in prompt + mock output) |
