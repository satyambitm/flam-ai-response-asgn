import { describe, expect, it } from "vitest";
import { formatCost, formatUsage } from "./format";

describe("formatUsage", () => {
  it("formats tokens and cost", () => {
    expect(formatUsage({ inputTokens: 1432, outputTokens: 248, costUsd: 0.0002136 })).toBe(
      "1,432 in · 248 out tokens · $0.000214",
    );
  });

  it("handles unknown cost and missing usage", () => {
    expect(formatUsage({ inputTokens: 10, outputTokens: 5, costUsd: null })).toBe("10 in · 5 out tokens · cost n/a");
    expect(formatUsage(null)).toBe("usage n/a");
  });

  it("formats larger and zero costs", () => {
    expect(formatCost(0.0234)).toBe("$0.0234");
    expect(formatCost(0)).toBe("$0");
  });
});
