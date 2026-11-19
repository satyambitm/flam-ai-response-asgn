// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviders, fetchThemes, generate } from "./api";

const META = { attempts: 1, provider: "mock", model: "m", latencyMs: 5, repaired: false, usage: null };
const OK = { ok: true, data: { title: "t", items: [] }, meta: META };
const ERR = { ok: false, error: { kind: "rate_limited", message: "busy", retryable: true, retryAfter: 7 } };

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

/** A fetch that only settles when its signal aborts, like a hung server. */
const hang = (_: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));

afterEach(() => vi.unstubAllGlobals());

describe("generate", () => {
  it("passes a success envelope through and sends the request shape", async () => {
    const fetch = mockFetch(() => json(OK));
    expect(await generate("echo", "hi", { fault: "slow" })).toEqual(OK);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/generate$/);
    expect(JSON.parse(init.body as string)).toEqual({ themeId: "echo", input: "hi" });
    expect((init.headers as Record<string, string>)["X-Fault"]).toBe("slow");
  });

  it("sends the chosen provider in the body", async () => {
    const fetch = mockFetch(() => json(OK));
    await generate("echo", "hi", { provider: "gemini" });
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
      themeId: "echo",
      input: "hi",
      providerId: "gemini",
    });
  });

  it("passes a server error envelope through regardless of status", async () => {
    mockFetch(() => json(ERR, 429));
    expect(await generate("echo", "hi")).toEqual(ERR);
  });

  it("maps a rejected fetch to network", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const r = await generate("echo", "hi");
    expect(!r.ok && r.error.kind).toBe("network");
    expect(!r.ok && r.error.retryable).toBe(true);
  });

  it("maps a non-JSON body to bad_response", async () => {
    mockFetch(() => Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    const r = await generate("echo", "hi");
    expect(!r.ok && r.error.kind).toBe("bad_response");
    expect(!r.ok && r.error.message).toContain("HTTP 502");
  });

  it.each([
    ["not an object", [1, 2]],
    ["missing ok", { data: {} }],
    ["success without meta", { ok: true, data: {} }],
    ["meta with broken usage", { ...OK, meta: { ...META, usage: { inputTokens: "1" } } }],
    ["unknown error kind", { ok: false, error: { kind: "weird", message: "x", retryable: true } }],
    ["bad retryAfter", { ok: false, error: { kind: "timeout", message: "x", retryable: true, retryAfter: "7" } }],
  ])("rejects a broken envelope (%s)", async (_, body) => {
    mockFetch(() => json(body));
    const r = await generate("echo", "hi");
    expect(!r.ok && r.error.kind).toBe("bad_response");
  });

  it("maps the client timeout to client_timeout", async () => {
    mockFetch(hang);
    const r = await generate("echo", "hi", { timeoutMs: 20 });
    expect(!r.ok && r.error.kind).toBe("client_timeout");
  });

  it("maps a caller abort to aborted (not retryable)", async () => {
    mockFetch(hang);
    const ctrl = new AbortController();
    const pending = generate("echo", "hi", { signal: ctrl.signal });
    ctrl.abort();
    const r = await pending;
    expect(!r.ok && r.error).toMatchObject({ kind: "aborted", retryable: false });
  });
});

describe("fetchThemes", () => {
  const THEME = { id: "echo", title: "Echo", inputHint: "x", maxInputChars: 4000 };

  it("returns the theme list", async () => {
    mockFetch(() => json([THEME]));
    expect(await fetchThemes()).toEqual({ ok: true, data: [THEME] });
  });

  it("rejects a malformed list", async () => {
    mockFetch(() => json([{ id: "echo" }]));
    const r = await fetchThemes();
    expect(!r.ok && r.error.kind).toBe("bad_response");
  });
});

describe("fetchProviders", () => {
  const INFO = { default: "groq", options: [{ id: "groq", title: "Groq", model: "openai/gpt-oss-120b" }] };

  it("returns the provider list", async () => {
    const fetch = mockFetch(() => json(INFO));
    expect(await fetchProviders()).toEqual({ ok: true, data: INFO });
    expect(fetch.mock.calls[0][0]).toMatch(/\/providers$/);
  });

  it("rejects a malformed list", async () => {
    mockFetch(() => json({ default: "groq", options: [{ id: "groq" }] }));
    const r = await fetchProviders();
    expect(!r.ok && r.error.kind).toBe("bad_response");
  });
});
