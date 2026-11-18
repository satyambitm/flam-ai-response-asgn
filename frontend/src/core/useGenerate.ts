import { useCallback, useEffect, useReducer, useRef } from "react";
import * as api from "./api";
import { formatUsage } from "./format";
import type { Fault, Result, ThemeData } from "./api";
import { type GenState, genReducer, initialState } from "./state";

export interface UseGenerate {
  state: GenState<ThemeData>;
  generate: (input: string, fault?: Fault) => void;
  retry: () => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Race safety is layered: starting a request aborts the previous one, and the reducer drops any
 * result whose requestId isn't the latest (a response can already be in flight when abort fires).
 */
export function useGenerate(themeId: string): UseGenerate {
  const [state, dispatch] = useReducer(genReducer<ThemeData>, initialState);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const lastRef = useRef<{ input: string; fault?: Fault } | null>(null);

  const generate = useCallback(
    async (input: string, fault?: Fault) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++seqRef.current;
      lastRef.current = { input, fault };
      const startedAt = Date.now();
      dispatch({ type: "start", requestId, input, startedAt });

      const result = await api.generate(themeId, input, { signal: controller.signal, fault });
      logOutcome(themeId, requestId, result, Date.now() - startedAt, controller.signal.aborted);
      dispatch({ type: "resolve", requestId, result });
    },
    [themeId],
  );

  const retry = useCallback(() => {
    if (lastRef.current) void generate(lastRef.current.input, lastRef.current.fault);
  }, [generate]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "cancel", requestId: seqRef.current });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    seqRef.current++;
    dispatch({ type: "reset" });
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, generate, retry, cancel, reset };
}

/** One console line per request. */
function logOutcome(themeId: string, id: number, result: Result<ThemeData>, ms: number, dropped: boolean) {
  const tag = `[generate #${id}] ${themeId}`;
  if (dropped) return console.debug(`${tag} superseded or cancelled after ${ms}ms; result dropped`);
  if (result.ok) {
    const { provider, model, attempts, repaired, usage } = result.meta;
    const extra = `attempts=${attempts}${repaired ? " repaired" : ""} · ${formatUsage(usage)}`;
    return console.info(`${tag} ok ${ms}ms ${provider}/${model} ${extra}`);
  }
  console.warn(`${tag} ${result.error.kind} ${ms}ms: ${result.error.message}`);
}
