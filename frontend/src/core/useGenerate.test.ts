import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { useGenerate } from "./useGenerate";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), generate: vi.fn() }));

const META = { attempts: 1, provider: "mock", model: "m", latencyMs: 1, repaired: false, usage: null };
const ok = (title: string): api.Result<api.ThemeData> => ({ ok: true, data: { title, items: [] }, meta: META });

/** A controllable api.generate call: resolve it whenever the test wants, ignoring abort (already in flight). */
function deferred() {
  let resolve!: (r: api.Result<api.ThemeData>) => void;
  const promise = new Promise<api.Result<api.ThemeData>>((r) => (resolve = r));
  return { promise, resolve };
}

const generateMock = vi.mocked(api.generate);

beforeEach(() => {
  generateMock.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

describe("useGenerate", () => {
  it("race: A then B, A resolves last → shows B", async () => {
    const a = deferred();
    const b = deferred();
    generateMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result } = renderHook(() => useGenerate("echo"));

    act(() => {
      result.current.generate("A");
    });
    act(() => {
      result.current.generate("B");
    });
    await act(async () => b.resolve(ok("B")));
    await act(async () => a.resolve(ok("A")));

    expect(result.current.state).toMatchObject({ status: "success", input: "B", data: { title: "B" } });
  });

  it("race: A resolves while B is still loading → A is dropped, B wins", async () => {
    const a = deferred();
    const b = deferred();
    generateMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result } = renderHook(() => useGenerate("echo"));

    act(() => {
      result.current.generate("A");
    });
    act(() => {
      result.current.generate("B");
    });
    await act(async () => a.resolve(ok("A")));
    expect(result.current.state).toMatchObject({ status: "loading", input: "B" });
    await act(async () => b.resolve(ok("B")));
    expect(result.current.state).toMatchObject({ status: "success", data: { title: "B" } });
  });

  it("aborts the previous request when a new one starts", () => {
    generateMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useGenerate("echo"));
    act(() => {
      result.current.generate("A");
    });
    act(() => {
      result.current.generate("B");
    });
    const [first, second] = generateMock.mock.calls.map((c) => c[2]!.signal!);
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it("passes theme, input and fault to the api", () => {
    generateMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useGenerate("echo"));
    act(() => {
      result.current.generate("hello", { fault: "slow" });
    });
    expect(generateMock).toHaveBeenCalledWith("echo", "hello", expect.objectContaining({ fault: "slow" }));
  });

  it("retry re-runs the last input, fault and provider", async () => {
    generateMock.mockResolvedValue({ ok: false, error: { kind: "timeout", message: "t", retryable: true } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useGenerate("echo"));
    await act(async () => result.current.generate("again", { fault: "error_500", provider: "groq" }));
    await act(async () => result.current.retry());
    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(generateMock.mock.calls[1].slice(0, 2)).toEqual(["echo", "again"]);
    expect(generateMock.mock.calls[1][2]).toMatchObject({ fault: "error_500", provider: "groq" });
  });

  it("cancel aborts and returns to idle; a late response is ignored", async () => {
    const a = deferred();
    generateMock.mockReturnValueOnce(a.promise);
    const { result } = renderHook(() => useGenerate("echo"));
    act(() => {
      result.current.generate("A");
    });
    act(() => {
      result.current.cancel();
    });
    expect(generateMock.mock.calls[0][2]!.signal!.aborted).toBe(true);
    await act(async () => a.resolve(ok("A")));
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("unmount aborts the in-flight request", () => {
    generateMock.mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useGenerate("echo"));
    act(() => {
      result.current.generate("A");
    });
    unmount();
    expect(generateMock.mock.calls[0][2]!.signal!.aborted).toBe(true);
  });
});
