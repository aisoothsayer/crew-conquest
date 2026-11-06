"""Moving-average crossover rules.

The strategy is intentionally deterministic: the same closing prices always
produce the same answer. An AI agent may operate and monitor the bot, but it
never decides trades itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

LONG = "long"
FLAT = "flat"


@dataclass(frozen=True)
class Signal:
    target: str  # LONG or FLAT
    fast_sma: float
    slow_sma: float
    last_close: float
    bars_used: int
    crossed_today: bool  # True when the target differs from the previous bar's target


def sma(values: Sequence[float], window: int) -> list[Optional[float]]:
    """Simple moving average; positions before the window fills are None."""
    if window < 1:
        raise ValueError("window must be >= 1")
    out: list[Optional[float]] = [None] * len(values)
    running = 0.0
    for i, value in enumerate(values):
        running += value
        if i >= window:
            running -= values[i - window]
        if i >= window - 1:
            out[i] = running / window
    return out


def targets(closes: Sequence[float], fast: int, slow: int) -> list[Optional[str]]:
    """Target state per bar: LONG while fast SMA > slow SMA, otherwise FLAT.

    Using a state (not just the crossing event) keeps the bot idempotent: a
    missed day or a rerun simply converges to the same target.
    """
    if fast >= slow:
        raise ValueError("fast window must be shorter than slow window")
    fast_line = sma(closes, fast)
    slow_line = sma(closes, slow)
    out: list[Optional[str]] = []
    for f, s in zip(fast_line, slow_line):
        out.append(None if f is None or s is None else (LONG if f > s else FLAT))
    return out


def latest_signal(closes: Sequence[float], fast: int, slow: int) -> Signal:
    if len(closes) < slow + 1:
        raise ValueError(f"need at least {slow + 1} closes, got {len(closes)}")
    states = targets(closes, fast, slow)
    fast_line = sma(closes, fast)
    slow_line = sma(closes, slow)
    return Signal(
        target=states[-1],
        fast_sma=fast_line[-1],
        slow_sma=slow_line[-1],
        last_close=closes[-1],
        bars_used=len(closes),
        crossed_today=states[-1] != states[-2],
    )
