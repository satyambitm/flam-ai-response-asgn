import type { components } from "./api-types";

export type ServerErrorKind = components["schemas"]["ErrorKind"];
export type ClientErrorKind = "network" | "bad_response" | "client_timeout" | "aborted";
export type ErrorKind = ServerErrorKind | ClientErrorKind;

export interface AppError {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
  retryAfter?: number | null;
}

// Record (not an array) so the compiler fails if the backend adds a kind we don't handle.
const SERVER_KINDS: Record<ServerErrorKind, true> = {
  input: true,
  rate_limited: true,
  provider: true,
  timeout: true,
  malformed: true,
  invalid_shape: true,
  empty: true,
  internal: true,
};

export function isServerErrorKind(value: unknown): value is ServerErrorKind {
  return typeof value === "string" && Object.hasOwn(SERVER_KINDS, value);
}

const CLIENT_MESSAGES: Record<ClientErrorKind, string> = {
  network: "Couldn't reach the server. Check your connection and try again.",
  bad_response: "The server sent a response we couldn't understand.",
  client_timeout: "The server took too long to answer.",
  aborted: "Request cancelled.",
};

export function clientError(kind: ClientErrorKind, detail?: string): AppError {
  const message = detail ? `${CLIENT_MESSAGES[kind]} (${detail})` : CLIENT_MESSAGES[kind];
  return { kind, message, retryable: kind !== "aborted" };
}

/** Headline per kind for the error view; the detailed message comes from the error itself. */
export const ERROR_TITLES: Record<ErrorKind, string> = {
  input: "Check your input",
  rate_limited: "Slow down a little",
  provider: "AI service unavailable",
  timeout: "That took too long",
  malformed: "The AI's answer was unreadable",
  invalid_shape: "The AI's answer was incomplete",
  empty: "Nothing useful came back",
  internal: "Something broke on our side",
  network: "You seem to be offline",
  bad_response: "Unexpected server response",
  client_timeout: "No response from the server",
  aborted: "Cancelled",
};
