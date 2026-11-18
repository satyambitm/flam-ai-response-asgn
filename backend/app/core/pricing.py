"""List prices in USD per 1M tokens (input, output), standard tier, checked 2026-11-20.

Unknown models get no cost (shown as n/a) rather than a guess. Free-tier keys are billed $0 in reality;
this is what the same usage costs at list price.
"""

from app.providers.base import Usage

PRICES_PER_M: dict[str, tuple[float, float]] = {
    "gpt-5.4-mini": (0.75, 4.50),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4o-mini": (0.15, 0.60),
    "openai/gpt-oss-120b": (0.15, 0.60),
    "openai/gpt-oss-20b": (0.075, 0.30),
    "gemini-3.5-flash-lite": (0.30, 2.50),
}


def cost_usd(model: str, usage: Usage) -> float | None:
    price = PRICES_PER_M.get(model)
    if price is None:
        return None
    return (usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1_000_000
