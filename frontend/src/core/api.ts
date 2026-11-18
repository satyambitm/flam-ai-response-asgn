/** HTTP client for the backend. Never throws: every outcome resolves to a typed Result. */

import type { components } from "./api-types";
import { type AppError, clientError, isServerErrorKind } from "./errors";

type Schemas = components["schemas"];
export type Meta = Schemas["Meta"];
export type Usage = Schemas["UsageMeta"];
export type ThemeInfo = Schemas["ThemeInfo"];
export type Fault = Schemas["Fault"];
export type ThemeData = Schemas["SuccessEnvelope"]["data"];

export type Result<T> = { ok: true; data: T; meta: Meta } | { ok: false; error: AppError };
export type ThemesResult = { ok: true; data: ThemeInfo[] } | { ok: false; error: AppError };

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
/** Longer than the backend's 40s deadline, so the backend's clearer timeout error normally wins. */
export const CLIENT_TIMEOUT_MS = 45_000;

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GenerateOptions extends RequestOptions {
  fault?: Fault;
}

export async function generate(
  themeId: string,
  input: string,
  { fault, ...opts }: GenerateOptions = {},
): Promise<Result<ThemeData>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (fault) headers["X-Fault"] = fault;
  const res = await send("/generate", { method: "POST", headers, body: JSON.stringify({ themeId, input }) }, opts);
  if (!res.ok) return res;
  return isEnvelope(res.body) ? res.body : { ok: false, error: clientError("bad_response", `HTTP ${res.status}`) };
}

export async function fetchThemes(opts: RequestOptions = {}): Promise<ThemesResult> {
  const res = await send("/themes", { method: "GET" }, opts);
  if (!res.ok) return res;
  if (Array.isArray(res.body) && res.body.every(isThemeInfo)) return { ok: true, data: res.body };
  if (isEnvelope(res.body) && !res.body.ok) return res.body;
  return { ok: false, error: clientError("bad_response", `HTTP ${res.status}`) };
}

type Sent = { ok: true; status: number; body: unknown } | { ok: false; error: AppError };

async function send(path: string, init: RequestInit, opts: RequestOptions): Promise<Sent> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? CLIENT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  // Which signal fired decides the kind; anything else that rejects is a network failure.
  const failure = (): AppError =>
    opts.signal?.aborted
      ? clientError("aborted")
      : timeout.aborted
        ? clientError("client_timeout")
        : clientError("network");

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, signal });
  } catch {
    return { ok: false, error: failure() };
  }
  try {
    return { ok: true, status: response.status, body: await response.json() };
  } catch {
    if (signal.aborted) return { ok: false, error: failure() };
    return { ok: false, error: clientError("bad_response", `HTTP ${response.status}, body is not JSON`) };
  }
}

// --- envelope guard: checks the envelope, not the deep theme data (the backend validated that) ---

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

function isMeta(x: unknown): x is Meta {
  return (
    isObj(x) &&
    typeof x.attempts === "number" &&
    typeof x.provider === "string" &&
    typeof x.model === "string" &&
    typeof x.latencyMs === "number" &&
    typeof x.repaired === "boolean" &&
    (x.usage === null || isUsage(x.usage))
  );
}

function isUsage(x: unknown): x is Usage {
  return (
    isObj(x) &&
    typeof x.inputTokens === "number" &&
    typeof x.outputTokens === "number" &&
    (x.costUsd === null || typeof x.costUsd === "number")
  );
}

function isErrorBody(x: unknown): x is AppError {
  return (
    isObj(x) &&
    isServerErrorKind(x.kind) &&
    typeof x.message === "string" &&
    typeof x.retryable === "boolean" &&
    (x.retryAfter == null || typeof x.retryAfter === "number")
  );
}

export function isEnvelope(x: unknown): x is Result<ThemeData> {
  if (!isObj(x)) return false;
  if (x.ok === true) return isObj(x.data) && isMeta(x.meta);
  if (x.ok === false) return isErrorBody(x.error);
  return false;
}

function isThemeInfo(x: unknown): x is ThemeInfo {
  return (
    isObj(x) &&
    typeof x.id === "string" &&
    typeof x.title === "string" &&
    typeof x.inputHint === "string" &&
    typeof x.maxInputChars === "number"
  );
}
