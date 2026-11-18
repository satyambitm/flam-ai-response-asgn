import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../core/api";
import type { components } from "../core/api-types";
import { defineView } from "../themes/registry";
import { ErrorBoundary } from "./ErrorBoundary";
import { ErrorView } from "./ErrorView";
import { InputPanel } from "./InputPanel";
import { LoadingView, WAKE_HINT_AFTER_MS } from "./LoadingView";
import { Workspace } from "./Workspace";

vi.mock("../core/api", async (orig) => ({ ...(await orig<typeof import("../core/api")>()), generate: vi.fn() }));
const generateMock = vi.mocked(api.generate);

beforeEach(() => {
  generateMock.mockReset();
  for (const level of ["info", "debug", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

function Boom(): never {
  throw new Error("render bug");
}

describe("ErrorBoundary", () => {
  it("contains a crashing child and offers retry", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorBoundary resetKey={1} onRetry={onRetry}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Couldn't display this result")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("clears the error when resetKey changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey={1} onRetry={() => {}}>
        <Boom />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey={2} onRetry={() => {}}>
        <p>fine now</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine now")).toBeInTheDocument();
  });
});

describe("ErrorView", () => {
  it("shows title, message and retry for retryable errors", async () => {
    const onRetry = vi.fn();
    render(<ErrorView error={{ kind: "timeout", message: "too slow", retryable: true }} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("That took too long");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("has no retry for input errors and points at the input", () => {
    render(<ErrorView error={{ kind: "input", message: "too long", retryable: false }} onRetry={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Edit your text above/)).toBeInTheDocument();
  });

  it("counts down retryAfter before enabling retry", () => {
    vi.useFakeTimers();
    render(
      <ErrorView
        error={{ kind: "rate_limited", message: "busy", retryable: true, retryAfter: 2 }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Retry in 2s");
    expect(screen.getByRole("button")).toBeDisabled();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button")).toHaveTextContent("Retry");
    expect(screen.getByRole("button")).toBeEnabled();
  });
});

describe("InputPanel", () => {
  it("disables submit when empty or too long, and shows the counter", async () => {
    render(<InputPanel hint="hint" maxChars={5} onSubmit={() => {}} />);
    const button = screen.getByRole("button", { name: "Generate" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "   ");
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "abcdef");
    expect(button).toBeDisabled();
    expect(screen.getByText(/6 \/ 5/)).toHaveClass("over");
  });

  it("submits on click and on Ctrl+Enter", async () => {
    const onSubmit = vi.fn();
    render(<InputPanel hint="hint" maxChars={100} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("textbox"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
    await userEvent.type(screen.getByRole("textbox"), "{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenNthCalledWith(1, "hello");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("LoadingView", () => {
  it("shows the cold-start hint after the threshold", () => {
    vi.useFakeTimers();
    render(<LoadingView startedAt={Date.now()} onCancel={() => {}} />);
    expect(screen.queryByText(/Waking up the server/)).toBeNull();
    act(() => vi.advanceTimersByTime(WAKE_HINT_AFTER_MS + 300));
    expect(screen.getByText(/Waking up the server/)).toBeInTheDocument();
  });
});

describe("Workspace", () => {
  const THEME = { id: "echo", title: "Echo", inputHint: "Type here", maxInputChars: 100 };
  const META = { attempts: 2, provider: "mock", model: "mock-ok", latencyMs: 1200, repaired: true };
  const Echo = defineView<components["schemas"]["EchoData"]>(({ data }) => <h3>{data.title}</h3>);

  async function submit(text = "notes") {
    await userEvent.type(screen.getByRole("textbox"), text);
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));
  }

  it("renders the View with meta on success and focuses the result", async () => {
    generateMock.mockResolvedValue({ ok: true, data: { title: "My list", items: [] }, meta: META });
    render(<Workspace theme={THEME} View={Echo} fault={null} />);
    await submit();
    expect(await screen.findByRole("heading", { name: "My list" })).toBeInTheDocument();
    expect(screen.getByText("auto-repaired")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Result" })).toHaveFocus();
  });

  it("sends the selected fault", async () => {
    generateMock.mockReturnValue(new Promise(() => {}));
    render(<Workspace theme={THEME} View={Echo} fault="truncated" />);
    await submit();
    expect(generateMock).toHaveBeenCalledWith("echo", "notes", expect.objectContaining({ fault: "truncated" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    generateMock.mockResolvedValue({ ok: false, error: { kind: "empty", message: "nothing", retryable: true } });
    render(<Workspace theme={THEME} View={Echo} fault={null} />);
    await submit();
    expect(await screen.findByText("Nothing to show yet")).toBeInTheDocument();
  });

  it("contains a View that throws instead of blanking the app", async () => {
    generateMock.mockResolvedValue({ ok: true, data: { title: "x", items: [] }, meta: META });
    render(<Workspace theme={THEME} View={defineView(Boom)} fault={null} />);
    await submit();
    expect(await screen.findByText("Couldn't display this result")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
