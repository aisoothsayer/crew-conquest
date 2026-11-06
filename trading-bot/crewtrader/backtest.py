"""Daily backtest of the crossover rules against buy-and-hold."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

from .strategy import LONG, targets

TRADING_DAYS = 252


@dataclass(frozen=True)
class Stats:
    total_return: float
    cagr: float
    volatility: float
    sharpe: float  # risk-free rate 0, so this flatters neither side
    max_drawdown: float
    exposure: float  # share of days invested
    trades: int  # count of buys plus sells


@dataclass(frozen=True)
class Result:
    start: str
    end: str
    days: int
    strategy: Stats
    buy_and_hold: Stats


def _stats(daily_returns: Sequence[float], positions: Sequence[float], trades: int) -> Stats:
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for r in daily_returns:
        equity *= 1.0 + r
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    n = len(daily_returns)
    years = n / TRADING_DAYS
    mean = sum(daily_returns) / n
    var = sum((r - mean) ** 2 for r in daily_returns) / max(n - 1, 1)
    vol = math.sqrt(var) * math.sqrt(TRADING_DAYS)
    return Stats(
        total_return=equity - 1.0,
        cagr=equity ** (1.0 / years) - 1.0 if years > 0 and equity > 0 else float("nan"),
        volatility=vol,
        sharpe=(mean * TRADING_DAYS) / vol if vol > 0 else float("nan"),
        max_drawdown=max_dd,
        exposure=sum(1 for p in positions if p > 0) / n,
        trades=trades,
    )


def run(
    dates: Sequence[str],
    closes: Sequence[float],
    fast: int = 20,
    slow: int = 50,
    cost_bps: float = 5.0,
    delay: int = 1,
) -> Result:
    """Backtest without look-ahead.

    The signal is computed from the close of day t. With delay=1 the trade
    fills at the close of day t+1, so the strategy first earns the return from
    t+1 to t+2. cost_bps is charged on every buy and every sell (fees,
    spread and slippage combined). Cash earns nothing.
    """
    if len(dates) != len(closes):
        raise ValueError("dates and closes differ in length")
    states = targets(closes, fast, slow)
    first = slow - 1 + delay  # first bar whose position can be set by a signal
    if len(closes) - first < 2:
        raise ValueError("not enough history for these windows")

    strat_returns: list[float] = []
    hold_returns: list[float] = []
    positions: list[float] = []
    trades = 0
    prev_pos = 0.0
    cost = cost_bps / 10_000.0
    # position held from close t to close t+1
    for t in range(first, len(closes) - 1):
        pos = 1.0 if states[t - delay] == LONG else 0.0
        market = closes[t + 1] / closes[t] - 1.0
        r = pos * market
        if pos != prev_pos:
            trades += 1
            r -= cost
        strat_returns.append(r)
        hold_returns.append(market)
        positions.append(pos)
        prev_pos = pos
    hold_cost_first = [hold_returns[0] - cost] + hold_returns[1:]
    return Result(
        start=dates[first],
        end=dates[-1],
        days=len(strat_returns),
        strategy=_stats(strat_returns, positions, trades),
        buy_and_hold=_stats(hold_cost_first, [1.0] * len(hold_returns), 1),
    )


def format_result(name: str, fast: int, slow: int, result: Result) -> str:
    def row(label: str, s: Stats) -> str:
        return (
            f"  {label:<13} total {s.total_return:>8.1%}  CAGR {s.cagr:>6.2%}  "
            f"vol {s.volatility:>6.1%}  Sharpe {s.sharpe:>5.2f}  "
            f"maxDD {s.max_drawdown:>7.1%}  invested {s.exposure:>4.0%}  trades {s.trades}"
        )

    return "\n".join(
        [
            f"{name}  SMA {fast}/{slow}  {result.start} to {result.end} ({result.days} days)",
            row("crossover", result.strategy),
            row("buy & hold", result.buy_and_hold),
        ]
    )
