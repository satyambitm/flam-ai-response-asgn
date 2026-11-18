# Plan: Generic Structured-AI Module

Final decisions for the generic module. The problem definition is in [main-problem.md](main-problem.md).
The theme from the assignment is built **after** this module is done and tested.

## 0. Locked decisions

| Area | Decision |
|---|---|
| Topology | Backend and frontend are **separate apps** in one repo, deployed independently. One shared, hosted backend serves every theme |
| Backend | **FastAPI** + Pydantic v2, Python **3.12** (pinned with `uv`) |
| Frontend | **React + TypeScript**, Vite |
| LLM providers | **Gemini**, **Groq** and **OpenAI** via their **official async SDKs** (`google-genai`, `groq`, `openai`), behind a provider interface. Selected by env var, with an optional fallback. More can be added later |
| Hosting | **Render** (backend) and **Vercel** (frontend) |
| Bad-output strategy | Lenient extraction, strict validation, **one repair retry** that sends the validation errors back to the model |
| Source of truth | Pydantic schemas on the backend → OpenAPI → generated TS types on the frontend |
| State management | Hand-written `useReducer` state machine. No React Query or Redux |
| Tests | pytest (backend), Vitest (frontend) |

---

## 1. Architecture

```
┌──────────── frontend (Vercel) ─────────────┐         ┌─────────────── backend (Render) ───────────────┐
│ ui/      input · loading · error · empty   │         │ POST /generate { themeId, input }              │
│ core/    useGenerate (reducer, abort,      │  HTTPS  │  1. validate input + theme whitelist           │
│          race guard)                       │  CORS   │  2. theme.build_prompt(input)                  │
│ core/    api client (timeout, envelope     │────────►│  3. provider.generate(...) within deadline     │
│          guard)                            │         │  4. extract JSON → Pydantic validate           │
│ themes/  <id>/View (interaction state)     │◄────────│  5. on malformed/invalid: 1 repair retry       │
│ ErrorBoundary around every View            │envelope │  6. normalize → is_empty → envelope            │
└────────────────────────────────────────────┘         └────────────────────────────────────────────────┘
```

**Responsibility split**
- **Backend** owns everything that touches the model: the API key, prompts, schemas, parsing, validation, repair, provider choice and fallback. It only ever returns a well-formed envelope.
- **Frontend** owns transport reliability (network failures, timeouts, aborts, stale responses, a malformed envelope) and the UX of every state. It never trusts the network.

---

## 2. Repo layout

```
/
├─ backend/
│  ├─ app/
│  │  ├─ main.py              FastAPI app, CORS, routes, exception handlers
│  │  ├─ config.py            pydantic-settings: env vars
│  │  ├─ api/
│  │  │  ├─ schemas.py        GenerateRequest, SuccessEnvelope, ErrorEnvelope
│  │  │  └─ routes.py         /health, /themes, /generate
│  │  ├─ core/
│  │  │  ├─ errors.py         ErrorKind enum, AppError, status mapping
│  │  │  ├─ extract.py        raw text → JSON value
│  │  │  ├─ pipeline.py       the six-step generate pipeline + repair
│  │  │  ├─ deadline.py       total-budget helper
│  │  │  └─ ratelimit.py      in-memory per-IP limiter
│  │  ├─ providers/
│  │  │  ├─ base.py           Provider protocol, ProviderError
│  │  │  ├─ gemini.py         google-genai SDK adapter
│  │  │  ├─ groq.py           groq SDK adapter
│  │  │  ├─ openai.py         openai SDK adapter
│  │  │  ├─ mock.py           fault-injection provider
│  │  │  └─ factory.py        builds the primary + fallback chain from env
│  │  └─ themes/
│  │     ├─ base.py           Theme protocol
│  │     ├─ registry.py       id → Theme
│  │     └─ echo.py           throwaway theme for testing the pipeline
│  ├─ tests/
│  │  ├─ fixtures/            bad-output samples
│  │  └─ test_*.py
│  ├─ pyproject.toml · uv.lock · requirements.txt (exported for Render)
│  ├─ .python-version (3.12)
│  └─ .env.example
├─ frontend/
│  ├─ src/
│  │  ├─ core/
│  │  │  ├─ api.ts            fetch wrapper, timeout, envelope guard
│  │  │  ├─ errors.ts         ClientErrorKind, user-facing messages
│  │  │  ├─ state.ts          GenState union + reducer (pure)
│  │  │  ├─ useGenerate.ts    hook: reducer + abort + requestId
│  │  │  └─ api-types.ts      GENERATED from OpenAPI (do not edit)
│  │  ├─ ui/                  InputPanel, LoadingView, ErrorView, EmptyView,
│  │  │                       ErrorBoundary, DevFaultPanel, Shell
│  │  ├─ themes/
│  │  │  ├─ registry.ts       themeId → View component
│  │  │  └─ echo/View.tsx
│  │  └─ main.tsx · App.tsx
│  ├─ package.json · vite.config.ts · tsconfig.json
│  └─ .env.example            VITE_API_URL
├─ package.json               root: postinstall + start (see §8)
├─ main-problem.md · plan.md · README.md
└─ .gitignore
```

---

## 3. Backend: the generic module

### 3.1 API contract

```
GET  /health    → 200 { ok: true }
GET  /themes    → 200 [{ id, title, inputHint, maxInputChars }]
POST /generate  body: { themeId: string, input: string }
                header (optional, only when ALLOW_FAULTS=true): X-Fault: <fault>

  200 → { ok: true,  data: <theme schema>, meta: { attempts, provider, model, latencyMs, repaired } }
  4xx/5xx → { ok: false, error: { kind, message, retryable, retryAfter? } }
```

- Every response, including FastAPI's own validation errors and unhandled exceptions, goes through exception handlers that produce the error envelope. **No raw stack traces and no HTML error pages.**
- `data` is typed per theme in OpenAPI through a discriminated union on `themeId`, so the generated TS types are exact.

### 3.2 Error kinds (shared vocabulary)

| `kind` | HTTP | Raised when | `retryable` |
|---|---|---|---|
| `input` | 422 | Empty or too-long input, unknown `themeId` | false |
| `rate_limited` | 429 | Our limiter, or a provider 429 on every provider in the chain | true (with `retryAfter`) |
| `provider` | 502 | Provider 4xx/5xx, auth or config error, unreachable | true |
| `timeout` | 504 | Total deadline exceeded | true |
| `malformed` | 502 | No parseable JSON after the repair attempt | true |
| `invalid_shape` | 502 | JSON fails the schema after the repair attempt | true |
| `empty` | 422 | Valid, but `theme.is_empty(data)` is true | true |
| `internal` | 500 | Unexpected bug (logged; the message is generic) | true |

Client-only kinds (frontend): `network`, `bad_response`, `aborted`, `client_timeout`.

### 3.3 Theme protocol

```python
class Theme(Protocol):
    id: str
    title: str
    input_hint: str
    max_input_chars: int            # default 4000
    Schema: type[BaseModel]         # output model; also drives the JSON schema
    def build_prompt(self, user_input: str) -> Prompt: ...   # (system, user)
    def normalize(self, data: BaseModel) -> BaseModel: ...   # ids, trim, defaults
    def is_empty(self, data: BaseModel) -> bool: ...
```

- `Schema.model_json_schema()` is passed to the provider for native structured output, **and** embedded in the system prompt (for weaker models and the fallback path).
- Schemas use `extra="ignore"` (extra keys are tolerated and dropped) and strict types for required fields. Wherever a value can be defaulted safely, fields have defaults.
- `normalize` assigns stable `id`s (e.g. `uuid4().hex[:8]`) to every list item that the UI will key, reorder or remove.

### 3.4 Provider layer

```python
class Provider(Protocol):
    name: str                       # "gemini" | "groq" | "openai" | "mock"
    model: str
    async def generate(self, *, system: str, user: str,
                       json_schema: dict, timeout_s: float) -> str: ...   # raw text
```

- **Gemini**: official `google-genai` SDK (async client, `client.aio.models.generate_content`), with `response_mime_type="application/json"` and the JSON schema in the config.
- **Groq**: official `groq` SDK (`AsyncGroq`, `chat.completions.create`). Uses `response_format: json_schema` when the model supports it, otherwise `json_object`.
- **OpenAI**: official `openai` SDK (`AsyncOpenAI`, `chat.completions.create`) with `response_format: {type: "json_schema", strict: true}`. Strict mode requires every field to be listed as required, so the adapter adapts the Pydantic JSON schema to fit (and falls back to `json_object` if that isn't possible).
- **Why SDKs:** they're maintained by the providers, so auth, endpoint and API changes are handled for us, and they're typed.
- **SDK rules:**
  1. **Turn off the SDK's built-in retries** (Groq and OpenAI `max_retries=0`; Gemini's retry options off). Retrying, fallback and deadlines belong to our pipeline only.
  2. Pass our per-call timeout explicitly, and also wrap each call in `asyncio.timeout`.
  3. Map every SDK exception to `ProviderError(status, retry_after, retryable)` **inside the adapter**. No SDK type leaks out of `providers/`.
  4. Each adapter returns **raw text** only. We don't use the SDK's own parsed or Pydantic output, so our extraction, validation and repair path always runs and behaves the same for every provider.
- **Chain:** `LLM_PROVIDER=gemini|groq|openai`, `LLM_FALLBACK=<another provider>` (optional). The fallback runs **only** for provider-level failures (5xx, 429, timeout, network). It never runs for bad output; the repair retry handles that.
- **Mock provider:** selected per request by the `X-Fault` header. Faults:
  `ok · fenced · prose · truncated · wrong_shape · empty · slow · error_500 · rate_429 · bad_then_ok`.
  `bad_then_ok` returns invalid output on the first call and valid output on the repair call, which demonstrates the repair path. The mock costs nothing, so faults can stay enabled on the deployed demo.
- Model names come from env vars (`GEMINI_MODEL`, `GROQ_MODEL`, `OPENAI_MODEL`). The defaults are checked against each provider's current model list at implementation time.

### 3.5 Extraction (`core/extract.py`)

Lenient, in order:
1. Trim whitespace. Empty text → `malformed`.
2. If the text is fenced in ```` ``` ```` or ```` ```json ````, take the fenced content.
3. Try `json.loads`.
4. Otherwise scan for the first balanced `{...}` or `[...]` block, string-aware so braces inside strings don't count, and `json.loads` that.
5. Failure → `malformed`, with a short reason that is reused in the repair prompt.

Not done: repairing truncated JSON, or guessing at fixes. Truncated output fails cleanly and goes to repair.

### 3.6 Pipeline (`core/pipeline.py`)

```
validate input (length, theme exists)            → input
deadline = Deadline(TOTAL_TIMEOUT_S = 40)
attempt 1: raw = chain.generate(prompt, timeout=min(25, deadline.left))
           parsed = extract(raw)                 → malformed?
           data   = Theme.Schema.model_validate(parsed) → invalid_shape?
if attempt 1 failed with malformed / invalid_shape and deadline.left > 5s:
    attempt 2 (repair): messages = original prompt
                       + "Your previous output: <raw, truncated to 4k chars>"
                       + "Problems: <compact error list, max 10 errors>"
                       + "Return ONLY corrected JSON matching the schema."
    same extract → validate
still failing                                    → malformed | invalid_shape
data = theme.normalize(data)
theme.is_empty(data)                             → empty
return SuccessEnvelope(data, meta{attempts, provider, model, latencyMs, repaired})
```

- Pydantic errors are compacted to `path: message` lines (e.g. `days.2.stops: field required`) so the repair prompt stays small.
- Every attempt is logged with the theme, provider, attempt number, outcome and latency. Inputs and outputs are not logged by default.

### 3.7 Security and limits

| Control | Value |
|---|---|
| API keys | Env only (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`). Never logged, never returned |
| Prompt control | Built only on the server. The client sends `themeId` + `input`, so the endpoint can't be used as an open relay |
| CORS | `CORS_ORIGINS` allowlist (the Vercel domain and localhost). No `*` |
| Input cap | `max_input_chars` per theme (default 4000). The request body is also capped |
| Rate limit | In-memory per-IP, `RATE_LIMIT_PER_MIN=10` by default. It resets on restart, which is acceptable at this scale and noted in the README |
| Faults | `ALLOW_FAULTS` env flag. Faults only ever route to the mock provider |
| Total deadline | 40 s per request, 25 s per provider call |

### 3.8 Backend tests (pytest)

- `extract`: clean, fenced, prose-wrapped, braces inside strings, truncated, empty, array root.
- `pipeline` with the mock provider: ok, wrong_shape→repair→ok, wrong_shape twice→`invalid_shape`, truncated twice→`malformed`, empty→`empty`, slow→`timeout`, 500 with fallback→ok, 429 on both providers→`rate_limited`.
- `routes`: every error path returns the envelope (including FastAPI's 422 and unhandled exceptions), CORS headers, rate limit.

---

## 4. Frontend: the generic client

### 4.1 Types
`npm run gen:api` runs `openapi-typescript` against `${VITE_API_URL}/openapi.json` and writes `src/core/api-types.ts`. This file is generated and committed. Request, envelope and per-theme data types all come from it, so nothing is maintained by hand.

### 4.2 API client (`core/api.ts`)
- `generate(themeId, input, { signal, fault? }): Promise<Result>`. It never throws; it always resolves to `{ ok: true, data, meta } | { ok: false, error }`.
- It combines the caller's abort signal with a **45 s client timeout** (`AbortSignal.any`). The client timeout is longer than the backend's 40 s deadline, so the backend's cleaner error normally wins.
- Mapping:
  - fetch rejected → `network` (or `aborted` / `client_timeout` depending on which signal fired)
  - body isn't JSON, or fails the envelope guard → `bad_response`
  - otherwise the server's envelope is passed through
- The envelope guard is a small hand-written type guard. It checks the envelope, not the deep data, because the backend has already validated the data, and the View is wrapped in an ErrorBoundary as a second line of defense.

### 4.3 State machine (`core/state.ts` + `core/useGenerate.ts`)

```ts
type GenState<T> =
  | { status: "idle" }
  | { status: "loading"; requestId: number; input: string; startedAt: number }
  | { status: "success"; requestId: number; input: string; data: T; meta: Meta }
  | { status: "empty";   requestId: number; input: string; message: string }
  | { status: "error";   requestId: number; input: string; error: AppError };
```

- The reducer is pure and tested on its own. Every `RESOLVED` action carries a `requestId`, and **the reducer drops any action whose `requestId` doesn't match the current one.**
- The hook keeps `abortRef` and `seqRef`. `generate(input)` aborts the previous request, increments `seqRef` and dispatches `START`. Unmounting aborts too.
- API: `{ state, generate(input), retry(), cancel(), reset() }`. `retry()` re-runs the last input. `cancel()` returns to the previous success state if there was one, otherwise to idle.
- Race safety is layered: the abort stops the old request, and the requestId guard catches responses that were already in flight when the abort fired.

### 4.4 UI shell (`ui/`)
- **InputPanel**: textarea with a character counter against `maxInputChars` from `/themes`. Submit is disabled when the input is empty or too long. Ctrl/Cmd+Enter submits.
- **LoadingView**: skeleton plus a Cancel button. After 5 s it shows "Waking up the server…", because a free Render instance can take 30–50 s to cold-start.
- **ErrorView**: a message and action per `kind`. Retry appears when `retryable`. A 429 shows a countdown from `retryAfter`. `input` errors point back to the input box.
- **EmptyView**: explains that nothing useful was generated and suggests how to rephrase.
- **ErrorBoundary** around the theme View: a render bug shows a "Couldn't display this result" card with Retry and doesn't break the app.
- **DevFaultPanel**: shown when `import.meta.env.DEV` is true or `?debug` is in the URL. It sets the `X-Fault` header. Used for the demo video and the interview.
- Mobile-first layout, tested at 360 px. Focus moves to the result or error on completion, and the status area uses `aria-live`.

### 4.5 Frontend tests (Vitest)
- Reducer: every transition, and the stale-`requestId` drop.
- Race: start A, start B, resolve A last → state shows B.
- `api.ts` with a mocked `fetch`: network error, non-JSON body, broken envelope, client timeout, abort.
- ErrorBoundary catches a View that throws.

---

## 5. Config (env)

**backend/.env.example**
```
LLM_PROVIDER=gemini            # gemini | groq | openai | mock
LLM_FALLBACK=groq              # optional; any provider other than the primary
GEMINI_API_KEY=
GEMINI_MODEL=
GROQ_API_KEY=
GROQ_MODEL=
OPENAI_API_KEY=
OPENAI_MODEL=
CORS_ORIGINS=http://localhost:5173
ALLOW_FAULTS=true
RATE_LIMIT_PER_MIN=10
TOTAL_TIMEOUT_S=40
PROVIDER_TIMEOUT_S=25
```

**frontend/.env.example**
```
VITE_API_URL=http://localhost:8000
```

---

## 6. Deployment

| | Render (backend) | Vercel (frontend) |
|---|---|---|
| Root dir | `backend/` | `frontend/` |
| Build | `pip install -r requirements.txt` | `npm run build` |
| Start | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | static |
| Env | all of §5 backend; `CORS_ORIGINS` = Vercel URL | `VITE_API_URL` = Render URL |
| Health | `/health` | — |
| Config file | `render.yaml` | — |

`requirements.txt` is exported from `uv.lock` (`uv export --no-dev`), so Render doesn't need uv. Python version: `PYTHON_VERSION=3.12`.

---

## 7. Build order (each step is a small commit)

Rules for every step: the code is tested before it's committed, there's one meaningful commit (or a few), and `WORKLOG.md` gets a line with the step, the time spent, and what AI was used for.

1. **Backend skeleton**: uv project, config, `/health`, CORS, envelope models, exception handlers, `ErrorKind`.
2. **Extraction** + pytest fixtures.
3. **Theme protocol + registry + `echo` theme**, `/themes`.
4. **Provider protocol + mock provider + faults.**
5. **Pipeline** with deadline + repair retry, `/generate`, rate limit. pytest for the full matrix.
6. **Gemini, Groq and OpenAI SDK adapters + fallback chain.** Unit tests for exception mapping (mocked SDK). Manual check with each real key that's available. A provider without a key is simply not configured.
7. **Deploy the backend to Render.** Verify `/health` and the faults remotely.
8. **Frontend skeleton**: Vite + React + TS, `gen:api`, `api.ts`, envelope guard.
9. **State machine + `useGenerate`** + Vitest (including the race test).
10. **UI shell**: input, loading, error, empty, ErrorBoundary, DevFaultPanel, mobile layout.
11. **Echo View** wired end to end. **Deploy to Vercel**, set CORS, run every fault against production.
12. README (setup, architecture, AI-usage note, limitations, time spent). The time and AI-usage figures come from `WORKLOG.md`, which is updated at every step.
13. *(Next phase)* The real theme from the assignment: a Pydantic schema, a prompt, and a React View with interaction state.

---

## 8. Running locally

```bash
# root: frontend only, pointed at the hosted backend (satisfies "npm install && npm start")
npm install && npm start

# backend locally
cd backend && uv sync && uv run uvicorn app.main:app --reload    # http://localhost:8000

# frontend against the local backend
cd frontend && VITE_API_URL=http://localhost:8000 npm run dev
```

Root `package.json`: `postinstall` → `npm --prefix frontend install`; `start` → `npm --prefix frontend run dev`.
The frontend's default `VITE_API_URL` (from `.env`) points at the Render URL once it's deployed.

---

## 9. Definition of done (generic module)

- [ ] No API key in the frontend bundle, network tab, logs or responses
- [ ] Every fault in §3.4 produces the correct envelope and UI, with no crashes or blank screens
- [ ] `bad_then_ok` shows a success result with `meta.repaired = true`
- [ ] Submitting A, then B quickly, always ends showing B
- [ ] Gemini down → Groq answers (fallback), visible in `meta.provider`
- [ ] Cold-start Render shows the "waking up" message, then a result
- [ ] Adding a theme = one backend theme file + one registry line + one View + one frontend registry line. **No core changes**
- [ ] pytest and Vitest pass
- [ ] Works at 360 px

## 10. Explicitly out of scope (for now)

Streaming (planned later via SSE), the refinement loop, saved sessions, auth, persistent rate limiting, and repairing truncated JSON. The interfaces are kept so these can be added without rewriting the core.
