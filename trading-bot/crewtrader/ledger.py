"""Local paper ledger for isolated-margin perpetual-style positions.

Fills happen at the real market price plus slippage, positions are marked to
the real market, and fees are charged on every fill. Nothing touches an
exchange. Funding payments are NOT modeled, which flatters held positions
slightly.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class Costs:
    fee_rate: float = 0.0004  # 0.04% of notional, charged on open and on close
    slippage_bps: float = 2.0
    maintenance: float = 0.005  # maintenance margin as a share of notional


def liquidation_price(side: str, entry: float, leverage: float, mm: float) -> float:
    # Isolated margin = notional / leverage. Liquidated when the loss eats the
    # margin down to the maintenance requirement.
    return entry * (1 - 1 / leverage + mm) if side == "long" else entry * (1 + 1 / leverage - mm)


class Ledger:
    def __init__(self, path: Path, costs: Costs = Costs()):
        self.path = Path(path)
        self.costs = costs
        self.state: dict = json.loads(self.path.read_text()) if self.path.exists() else {}

    @property
    def exists(self) -> bool:
        return bool(self.state)

    def init(self, equity: float, now: float, start_prices: dict[str, float]) -> None:
        if self.exists:
            raise RuntimeError(f"ledger already exists: {self.path}")
        self.state = {
            "start_equity": equity, "cash": equity, "start_ts": now, "start_prices": start_prices,
            "position": None, "last_mark_ts": now, "last_fill_ts": None,
            "day": {"date": None, "start_equity": equity}, "fills": [],
        }
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=1, sort_keys=True))
        os.replace(tmp, self.path)

    # views
    @property
    def position(self) -> Optional[dict]:
        return self.state["position"]

    def unrealized(self, price: float) -> float:
        p = self.position
        if not p:
            return 0.0
        move = price - p["entry"] if p["side"] == "long" else p["entry"] - price
        return max(p["qty"] * move, -p["margin"])  # isolated: never lose more than the margin

    def equity(self, price: Optional[float]) -> float:
        p = self.position
        if not p:
            return self.state["cash"]
        if price is None:
            raise ValueError("price needed to value an open position")
        return self.state["cash"] + p["margin"] + self.unrealized(price)

    # writes
    def _fill_price(self, price: float, buying: bool) -> float:
        s = self.costs.slippage_bps / 10_000
        return price * (1 + s) if buying else price * (1 - s)

    def _record(self, fill: dict) -> dict:
        self.state["fills"].append(fill)
        self.state["last_fill_ts"] = fill["ts"]
        self.save()
        return fill

    def open(self, symbol: str, side: str, price: float, margin: float, leverage: float, now: float) -> dict:
        if self.position:
            raise RuntimeError("position already open")
        fill = self._fill_price(price, buying=side == "long")
        notional = margin * leverage
        fee = notional * self.costs.fee_rate
        if margin + fee > self.state["cash"]:
            raise RuntimeError("not enough cash for margin plus fee")
        self.state["cash"] -= margin + fee
        self.state["position"] = {
            "symbol": symbol, "side": side, "qty": notional / fill, "entry": fill, "margin": margin,
            "leverage": leverage, "opened_ts": now,
            "liq_price": liquidation_price(side, fill, leverage, self.costs.maintenance),
        }
        return self._record({"ts": now, "kind": "open", "symbol": symbol, "side": side, "price": fill,
                             "notional": notional, "fee": fee, "leverage": leverage})

    def close(self, price: float, now: float, kind: str = "close") -> dict:
        p = self.position
        if not p:
            raise RuntimeError("no open position")
        fill = self._fill_price(price, buying=p["side"] == "short")
        pnl = self.unrealized(fill)
        fee = p["qty"] * fill * self.costs.fee_rate
        self.state["cash"] += max(p["margin"] + pnl - fee, 0.0)
        self.state["position"] = None
        return self._record({"ts": now, "kind": kind, "symbol": p["symbol"], "side": p["side"],
                             "price": fill, "pnl": pnl, "fee": fee})

    def check_liquidation(self, lows_highs: list[tuple[int, float, float]], now: float) -> Optional[dict]:
        """Scan (ts, low, high) candles since the last mark; liquidate on the first breach."""
        p = self.position
        fill = None
        if p:
            for ts, low, high in lows_highs:
                if ts < p["opened_ts"]:
                    continue  # candle began before the entry; its range includes pre-entry prices
                hit = low <= p["liq_price"] if p["side"] == "long" else high >= p["liq_price"]
                if hit:
                    self.state["position"] = None  # isolated: the whole margin is lost
                    fill = self._record({"ts": ts, "kind": "liquidation", "symbol": p["symbol"],
                                         "side": p["side"], "price": p["liq_price"], "pnl": -p["margin"], "fee": 0.0})
                    break
        self.state["last_mark_ts"] = now
        self.save()
        return fill
