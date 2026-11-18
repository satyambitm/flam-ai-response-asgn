import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { EchoView } from "./View";

const DATA = {
  title: "Chores",
  items: [
    { id: "a", text: "Dishes" },
    { id: "b", text: "Laundry" },
  ],
};

it("tracks done and removed items, and restores them", async () => {
  render(<EchoView data={DATA} />);
  expect(screen.getByText("0 of 2 done")).toBeInTheDocument();

  await userEvent.click(screen.getByLabelText("Dishes"));
  expect(screen.getByText(/1 of 2 done/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: 'Remove "Laundry"' }));
  expect(screen.queryByText("Laundry")).toBeNull();
  expect(screen.getByText(/1 of 1 done/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "restore 1 removed" }));
  expect(screen.getByText("Laundry")).toBeInTheDocument();
});
