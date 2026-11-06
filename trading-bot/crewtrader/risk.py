"""Risk gate: every write passes through this first. Rejections are final, never clamped."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
STOP_FILE = ROOT / "STOP"


@dataclass(frozen=True)
class Limits:
    size_cap: float = 0.25  # margin per position as a share of equity
    max_leverage: float = 5.0  # isolated; anything above is rejected
    symbols: tuple[str, ...] = ("SOL-USD", "BTC-USD", "ETH-USD")
    daily_loss_halt: float = 0.15  # no new entries once equity is this far below the day's start
    entry_cooldown_s: int = 15 * 60  # time since the last fill before a new entry
    min_reason: int = 10
    max_reason: int = 280


def halted() -> Optional[str]:
    if STOP_FILE.exists():
        return "kill switch file STOP is present"
    if os.environ.get("CREWTRADER_HALT"):
        return "CREWTRADER_HALT is set"
    return None


def check_entry(limits: Limits, state: dict, equity: float, symbol: str, leverage, size_pct,
                reasoning: str, now: float) -> Optional[str]:
    """Return a rejection reason, or None if the entry may proceed."""
    reason = halted()
    if reason:
        return reason
    if symbol not in limits.symbols:
        return f"symbol {symbol!r} not allowed; allowed: {', '.join(limits.symbols)}"
    if not isinstance(leverage, (int, float)) or isinstance(leverage, bool) or leverage < 1:
        return "leverage must be a number >= 1"
    if leverage > limits.max_leverage:
        return f"leverage {leverage}x rejected; cap is {limits.max_leverage:g}x isolated"
    if not isinstance(size_pct, (int, float)) or isinstance(size_pct, bool) or not 0 < size_pct <= limits.size_cap:
        return f"size_pct must be in (0, {limits.size_cap}]"
    if state["position"]:
        return "one position at a time: close the open position before any new entry"
    text = (reasoning or "").strip()
    if not limits.min_reason <= len(text) <= limits.max_reason or "\n" in text:
        return f"reasoning must be one line of {limits.min_reason}-{limits.max_reason} characters"
    day_start = state["day"]["start_equity"]
    if equity <= day_start * (1 - limits.daily_loss_halt):
        return f"daily loss halt: equity {equity:.2f} is {limits.daily_loss_halt:.0%}+ below today's start {day_start:.2f}"
    last = state.get("last_fill_ts")
    if last is not None and now - last < limits.entry_cooldown_s:
        return f"cooldown: wait {int(limits.entry_cooldown_s - (now - last))}s after the last fill"
    if equity <= 0:
        return "no equity left"
    return None
