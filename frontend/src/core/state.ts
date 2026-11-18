/** Request lifecycle as a pure reducer. A discriminated union, so impossible states can't be represented. */

import type { Meta, Result } from "./api";
import type { AppError } from "./errors";

export type SuccessState<T> = { status: "success"; requestId: number; input: string; data: T; meta: Meta };

export type GenState<T> =
  | { status: "idle" }
  | { status: "loading"; requestId: number; input: string; startedAt: number; previous: SuccessState<T> | null }
  | SuccessState<T>
  | { status: "empty"; requestId: number; input: string; message: string }
  | { status: "error"; requestId: number; input: string; error: AppError };

export type GenAction<T> =
  | { type: "start"; requestId: number; input: string; startedAt: number }
  | { type: "resolve"; requestId: number; result: Result<T> }
  | { type: "cancel"; requestId: number }
  | { type: "reset" };

export const initialState = { status: "idle" } as const;

export function genReducer<T>(state: GenState<T>, action: GenAction<T>): GenState<T> {
  switch (action.type) {
    case "start":
      return {
        status: "loading",
        requestId: action.requestId,
        input: action.input,
        startedAt: action.startedAt,
        // Cancel returns to the last good result, even across several superseded requests.
        previous: state.status === "success" ? state : state.status === "loading" ? state.previous : null,
      };

    case "resolve": {
      // Race guard: only the in-flight request may settle the state. Stale results are dropped.
      if (state.status !== "loading" || action.requestId !== state.requestId) return state;
      const { requestId, input } = state;
      const { result } = action;
      if (result.ok) return { status: "success", requestId, input, data: result.data, meta: result.meta };
      if (result.error.kind === "aborted") return state.previous ?? initialState;
      if (result.error.kind === "empty") return { status: "empty", requestId, input, message: result.error.message };
      return { status: "error", requestId, input, error: result.error };
    }

    case "cancel":
      if (state.status !== "loading" || action.requestId !== state.requestId) return state;
      return state.previous ?? initialState;

    case "reset":
      return initialState;
  }
}
