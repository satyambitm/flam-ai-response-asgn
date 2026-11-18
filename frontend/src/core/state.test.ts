import { describe, expect, it } from "vitest";
import type { Result } from "./api";
import { type GenAction, type GenState, genReducer, initialState } from "./state";

type D = { v: number };
const META = { attempts: 1, provider: "mock", model: "m", latencyMs: 1, repaired: false, usage: null };
const ok = (v: number): Result<D> => ({ ok: true, data: { v }, meta: META });
const fail = (kind: "timeout" | "empty" | "aborted" | "network"): Result<D> => ({
  ok: false,
  error: { kind, message: kind, retryable: true },
});

const run = (actions: GenAction<D>[], from: GenState<D> = initialState) => actions.reduce(genReducer<D>, from);
const start = (requestId: number, input = `in${requestId}`): GenAction<D> => ({
  type: "start",
  requestId,
  input,
  startedAt: 0,
});
const resolve = (requestId: number, result: Result<D>): GenAction<D> => ({ type: "resolve", requestId, result });

describe("genReducer", () => {
  it("idle → loading → success", () => {
    const loading = run([start(1, "hello")]);
    expect(loading).toMatchObject({ status: "loading", requestId: 1, input: "hello", previous: null });
    expect(genReducer(loading, resolve(1, ok(7)))).toEqual({
      status: "success",
      requestId: 1,
      input: "hello",
      data: { v: 7 },
      meta: META,
    });
  });

  it("maps an empty error to the empty state and other errors to error", () => {
    expect(run([start(1), resolve(1, fail("empty"))])).toMatchObject({ status: "empty", message: "empty" });
    expect(run([start(1), resolve(1, fail("timeout"))])).toMatchObject({
      status: "error",
      error: { kind: "timeout" },
    });
  });

  it("drops a stale result (requestId not the latest)", () => {
    const s = run([start(1), start(2), resolve(1, ok(1))]);
    expect(s).toMatchObject({ status: "loading", requestId: 2 });
    expect(genReducer(s, resolve(2, ok(2)))).toMatchObject({ status: "success", data: { v: 2 } });
  });

  it("ignores results once nothing is loading", () => {
    const done = run([start(1), resolve(1, ok(1))]);
    expect(genReducer(done, resolve(1, ok(99)))).toBe(done);
    expect(genReducer(initialState as GenState<D>, resolve(1, ok(1)))).toBe(initialState);
  });

  it("cancel returns to the previous success, kept across superseded requests", () => {
    const success = run([start(1), resolve(1, ok(1))]);
    const s = run([start(2), start(3), { type: "cancel", requestId: 3 }], success);
    expect(s).toBe(success);
  });

  it("cancel with no previous success returns to idle", () => {
    expect(run([start(1), { type: "cancel", requestId: 1 }])).toEqual(initialState);
  });

  it("cancel for an old request is ignored", () => {
    expect(run([start(1), start(2), { type: "cancel", requestId: 1 }])).toMatchObject({ requestId: 2 });
  });

  it("an aborted result for the current request never leaves it stuck loading", () => {
    expect(run([start(1), resolve(1, fail("aborted"))])).toEqual(initialState);
  });

  it("starting from an error does not carry it as previous", () => {
    expect(run([start(1), resolve(1, fail("network")), start(2)])).toMatchObject({ previous: null });
  });

  it("reset always returns to idle", () => {
    expect(run([start(1), { type: "reset" }])).toEqual(initialState);
  });
});
