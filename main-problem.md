# Main Problem: Reliable Structured AI Generation

## Problem statement

> Given free-form user text, get a **structured result** from an unreliable LLM and turn it into a **predictable UI state**. The result is either valid typed data or a clear, recoverable error, never a crash and never stale data.

The solution is a **theme-agnostic module** split across two separately deployed apps:

- **Backend (one shared, hosted service):** turns `{ themeId, input }` into **validated JSON or a typed error**. It owns everything that touches the model.
- **Frontend (generic client):** turns that response into **reliable UI state**. It owns everything that touches the network and the user.

Each theme (study assistant, recipe, trip planner) is a thin **plugin**: a schema and prompt on the backend, and a View on the frontend. Neither core contains theme-specific logic.

```
 user text ─► [FE core: api + state machine] ──HTTPS──► [BE: prompt ► LLM ► extract ► validate ► repair? ► normalize]
                                                                                              │
 UI ◄─ GenState ◄─ [FE core: envelope guard, race guard] ◄──── envelope { ok, data | error } ◄─┘
```

Implementation details and decisions are in [plan.md](plan.md).

---

## 1. The theme contract

| Side | Piece | Purpose |
|---|---|---|
| Backend | `id`, `title`, `input_hint`, `max_input_chars` | Identity and input rules |
| Backend | `Schema` (Pydantic) | The expected output. Also produces the JSON schema sent to the provider |
| Backend | `build_prompt(input)` | User text → system and user prompt |
| Backend | `normalize(data)` | Harmless fixes: stable ids, trimming, defaults |
| Backend | `is_empty(data)` | Whether a valid result has no useful content |
| Frontend | `View` | Renders validated data and owns its interaction state |

**Rule:** neither core imports theme code; themes register themselves. Adding a theme means one backend theme file, one View, and one registry line on each side. **No core changes.**

---

## 2. What the backend must solve

### 2.1 Secure, controlled access to the model
- API keys live only in server env vars. They are never logged and never returned.
- **Prompts are built on the server only.** The client sends `themeId` + `input`, so the endpoint can't be used as an open relay for our key.
- Theme whitelist, input length cap, per-IP rate limit, and a CORS allowlist.

### 2.2 Treat model output as untrusted input
1. Extract JSON **leniently**: handle code fences, surrounding prose, and braces inside strings.
2. Validate **strictly** against the theme's Pydantic schema.
3. If the JSON is malformed or the shape is wrong, make **one repair retry**: send the bad output and the validation errors back to the model.
4. Normalize, then run the empty check.
5. Truncated JSON is never guessed at. It fails cleanly and goes to repair.

### 2.3 Provider unreliability
- Providers (Gemini, Groq) sit behind one interface. The primary and an optional fallback are chosen by env var.
- The fallback is used only for **provider failures** (5xx, 429, timeout, network), never for bad output.
- There is a total deadline per request, shared across all attempts.
- A **mock provider** with fault injection reproduces every failure on demand.

### 2.4 One response shape, always
Every response, including framework errors and unexpected exceptions, is either
`{ ok: true, data, meta }` or `{ ok: false, error: { kind, message, retryable, retryAfter? } }`.

---

## 3. What the frontend must solve

### 3.1 Never trust the network
The API client never throws. Fetch failures, non-JSON bodies, broken envelopes, client timeouts and aborts all become typed errors.

### 3.2 Request lifecycle and concurrency
- **A stale response must never overwrite a newer one.** Starting a new request aborts the previous one, **and** the reducer drops any result whose `requestId` isn't the latest.
- Cancel is supported, and unmounting aborts any request still in flight.
- The client timeout is longer than the backend deadline, so the backend's clearer error normally wins.

### 3.3 State machine
`useGenerate(themeId)` returns a discriminated union, so impossible states can't be represented:

```
idle ─► loading ─► success(data, meta)
                 ├► empty
                 └► error(kind, message, retryable)
  any ─► loading   (new submit or retry; the old request is aborted)
```

Actions: `generate(input)`, `retry()`, `cancel()`, `reset()`.

### 3.4 Generic UI shell
- Input box with a character counter. Submit is disabled while the input is invalid.
- Loading skeleton with Cancel. A "waking up server" hint covers cold starts.
- Error view with a message per kind, Retry when retryable, and a countdown on 429.
- Empty view.
- The theme View is wrapped in an **ErrorBoundary**, so a renderer bug never white-screens the app.
- A dev fault panel for triggering every failure.
- Mobile-first layout (360 px).

---

## 4. Failure taxonomy

| Kind | Origin | Cause | Retryable |
|---|---|---|---|
| `input` | BE | Empty or too-long input, unknown theme | no |
| `rate_limited` | BE | Our limiter, or provider 429 on every provider in the chain | after `retryAfter` |
| `provider` | BE | Provider error or unreachable, on every provider in the chain | yes |
| `timeout` | BE | Total deadline exceeded | yes |
| `malformed` | BE | No parseable JSON, even after repair | yes |
| `invalid_shape` | BE | JSON fails the schema, even after repair | yes |
| `empty` | BE | Valid, but no useful content | yes |
| `internal` | BE | Unexpected server bug | yes |
| `network` | FE | Fetch failed, offline, CORS | yes |
| `bad_response` | FE | Response isn't a valid envelope | yes |
| `client_timeout` | FE | No response within the client timeout | yes |
| `aborted` | FE | Superseded or cancelled | silent |

---

## 5. What stays theme-specific

Interaction state inside each theme's View:
- **Study:** flip cards, take the quiz, re-test wrong answers
- **Recipe:** check off steps, scale servings, swap ingredients
- **Trip:** expand, remove and reorder stops

**Build one theme fully.** A second theme is only worth adding as proof that the module is generic.

---

## 6. Acceptance criteria

- [ ] No API key in the frontend bundle, network tab, logs, or responses
- [ ] Every fault can be triggered and shows the correct UI, with no crashes or blank screens
- [ ] Bad output followed by a good repair → success with `meta.repaired = true`
- [ ] Submitting A, then B quickly, always ends showing B
- [ ] Primary provider down → fallback answers
- [ ] A theme renderer exception is caught by the ErrorBoundary
- [ ] Loading, empty and error states all work at 360 px
- [ ] Adding a theme requires **no core changes**
- [ ] Extraction, pipeline, reducer and race handling are unit-tested against bad-output fixtures

---

## 7. Non-goals (for now)

Streaming, refinement loop, saved sessions, auth, persistent rate limiting, and repairing truncated JSON. The interfaces leave room for these later without a rewrite.
