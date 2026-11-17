# Main Problem: Reliable Structured AI Generation

## Problem statement

> Given free-form user text, get a **structured result** from an unreliable LLM and expose it to the UI as a **predictable state**. The result is either valid typed data or a clear, recoverable error, never a crash and never stale data.

The core is a **theme-agnostic module** that the UI consumes. Each theme (study assistant, recipe, trip planner) is a thin **plugin**: a schema, a prompt, and renderers. The core holds no theme-specific logic.

```
 user text ─► [Theme: buildPrompt] ─► [Backend proxy] ─► LLM
                                                          │
 UI ◄─ state ◄─ [Core: parse ► validate(theme.schema) ► normalize] ◄─ raw text
```

---

## 1. The contract (what a theme must provide)

| Field | Purpose |
|---|---|
| `id` | Theme identifier, e.g. `"trip"` |
| `buildPrompt(input)` | Turns user text into the system and user prompt, including the required JSON shape |
| `schema` | Runtime validator (e.g. Zod) for the expected output |
| `normalize(data)` *(optional)* | Fixes harmless issues: add IDs, trim strings, apply defaults |
| `isEmpty(data)` | Decides whether a valid result has no useful content (e.g. 0 cards) |
| `View` | React component that renders validated data and owns its own interaction state |

**Rule:** the core never imports theme code; themes register with the core. Adding a theme means adding one folder and changing nothing in the core.

---

## 2. What the core must solve

### 2.1 Secure transport
- The browser calls **our backend** (`POST /api/generate { themeId, input }`), never the LLM provider directly.
- The API key exists only on the server (in an env var).
- The backend enforces a timeout, an input length limit, and returns a **uniform error shape**.

### 2.2 Parsing untrusted output
The raw LLM text is untrusted input. The core must:
1. Extract JSON even when it's wrapped in ```` ```json ```` fences or surrounded by prose.
2. Use `JSON.parse` safely, and return a typed failure when parsing fails.
3. Validate the parsed value against `theme.schema`.
4. Run `normalize`, then `isEmpty`.

### 2.3 Failure taxonomy (every case maps to a distinct, user-readable error)

| Kind | Cause | Retryable |
|---|---|---|
| `network` | Fetch failed, offline | yes |
| `timeout` | No response within N seconds | yes |
| `provider` | LLM API error, 429 rate limit, 5xx | yes (back off on 429) |
| `malformed` | Response isn't valid JSON | yes (auto-retry once) |
| `invalid_shape` | Valid JSON that fails the schema | yes (auto-retry once) |
| `empty` | Valid shape with no useful content | yes |
| `input` | User input is empty or too long | no (fix the input) |
| `aborted` | Superseded by a newer request or cancelled | silent, not shown |

### 2.4 Request lifecycle and concurrency
- **A stale response must never overwrite a newer one.** Each request gets an ID or an `AbortController`. Starting a new request aborts the previous one, and a response is applied only if its ID matches the latest request.
- Cancelling is supported, and unmounting the component cancels in-flight requests.
- Auto-retry is bounded: at most 1 automatic retry for `malformed` / `invalid_shape`, then a manual **Retry** button.
- The core enforces its own timeout, independent of the backend's.

### 2.5 State machine exposed to the UI
A single hook such as `useGenerate(theme)` returns a discriminated state:

```
idle ─► loading ─► success(data)
                 ├► empty
                 └► error(kind, message, retryable)
  any ─► loading   (new submit or retry; the old request is aborted)
```

Plus the actions `generate(input)`, `retry()`, `cancel()` and `reset()`.
Impossible states (e.g. `loading` with `error` set) must be unrepresentable.

### 2.6 Generic UI shell
Shared across all themes:
- An input box with validation and a submit button that's disabled while a request is invalid
- A loading view (skeleton or spinner, with a cancel button)
- An error view with a message per error kind and a Retry button
- An empty-state view
- A success view that renders `<theme.View data={...} />` inside an error boundary, so a renderer bug can't white-screen the app
- A mobile-first layout

---

## 3. What stays theme-specific (out of the core)

Interaction state that lives inside `theme.View`:
- **Study:** flip cards, take the quiz, re-test wrong answers
- **Recipe:** check off steps, scale servings, swap ingredients
- **Trip:** expand, remove and reorder stops

**Build one theme fully.** A second theme is only worthwhile as proof that the module is generic.

---

## 4. Acceptance criteria (the core is "done" when)

- [ ] The API key is absent from the client bundle and network tab
- [ ] Each failure kind in §2.3 can be triggered (via a mock or dev toggle) and shows the correct UI, with no crashes
- [ ] Submitting A, then B quickly, always ends showing B, never A
- [ ] Malformed or wrong-shape output triggers one silent retry, then a recoverable error
- [ ] An exception inside a theme renderer is caught by the error boundary
- [ ] The loading, empty and error states all render on a 360px-wide screen
- [ ] Adding a theme requires **no changes** to core files
- [ ] Parser and validator are unit-tested against bad-output fixtures (fenced JSON, prose + JSON, truncated JSON, wrong types, empty arrays)

---

## 5. Non-goals (core scope)

Auth, chat history, multiple providers, and streaming are left out. Streaming, refinement and saved sessions are stretch goals and should be layered on top of a working core, not built into it from day one.
