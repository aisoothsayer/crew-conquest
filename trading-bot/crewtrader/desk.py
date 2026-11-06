"""The paper trading desk an AI agent talks to (through MCP or the CLI)."""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from .ledger import Costs, Ledger
from .market import GRANULARITY
from .risk import ROOT, Limits, check_entry

AGENTS_DIR = ROOT / "journal" / "agents"


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Desk:
    def __init__(self, agent: str, market, limits: Limits = Limits(), costs: Costs = Costs(),
                 start_equity: float = 10_000.0, base_dir: Path = AGENTS_DIR,
                 clock: Callable[[], float] = time.time):
        if not agent.replace("-", "").isalnum() or len(agent) > 16:
            raise ValueError("agent must be <= 16 letters, digits or dashes")
        self.agent = agent
        self.market = market
        self.limits = limits
        self.clock = clock
        self.dir = Path(base_dir) / agent
        self.ledger = Ledger(self.dir / "ledger.json", costs)
        self.journal = self.dir / "decisions.jsonl"
        if not self.ledger.exists:
            self.ledger.init(start_equity, self.clock(),
                             {s: self.market.price(s) for s in self.limits.symbols})

    # bookkeeping
    def _log(self, record: dict) -> dict:
        self.dir.mkdir(parents=True, exist_ok=True)
        record = {"ts": _iso(self.clock()), "agent": self.agent, **record}
        with open(self.journal, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, sort_keys=True) + "\n")
        return record

    def mark(self) -> Optional[dict]:
        """Check liquidation since the last mark and roll the daily loss baseline."""
        now = self.clock()
        st = self.ledger.state
        liq = None
        pos = st["position"]
        if pos:
            since = max(st["last_mark_ts"], pos["opened_ts"]) - 300
            tf = "5m" if now - since <= 300 * 299 else "1h"
            candles = self.market.candles(pos["symbol"], tf, datetime.fromtimestamp(since, timezone.utc),
                                          datetime.fromtimestamp(now, timezone.utc))
            liq = self.ledger.check_liquidation([(c.ts, c.low, c.high) for c in candles], now)
            if liq:
                self._log({"action": "liquidated", "fill": liq})
        else:
            st["last_mark_ts"] = now
        today = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        if st["day"]["date"] != today:
            st["day"] = {"date": today, "start_equity": self._equity()}
        self.ledger.save()
        return liq

    def _equity(self) -> float:
        pos = self.ledger.position
        return self.ledger.equity(self.market.price(pos["symbol"]) if pos else None)

    # read tools
    def get_candles(self, symbol: str, timeframe: str = "1h", hours: float = 24) -> dict:
        if symbol not in self.limits.symbols:
            raise ValueError(f"symbol must be one of {', '.join(self.limits.symbols)}")
        if not 0 < hours <= 24 * 30:
            raise ValueError("hours must be in (0, 720]")
        if hours * 3600 / GRANULARITY.get(timeframe, 1) > 1500:
            raise ValueError("too many candles; use a larger timeframe")
        end = datetime.fromtimestamp(self.clock(), timezone.utc)
        candles = self.market.candles(symbol, timeframe, end - timedelta(hours=hours), end)
        return {"symbol": symbol, "timeframe": timeframe, "count": len(candles),
                "candles": [c.as_dict() for c in candles]}

    def get_position(self) -> dict:
        self.mark()
        pos = self.ledger.position
        if not pos:
            return {"position": None}
        price = self.market.price(pos["symbol"])
        return {"position": {
            **{k: pos[k] for k in ("symbol", "side", "qty", "entry", "margin", "leverage", "liq_price")},
            "opened": _iso(pos["opened_ts"]), "mark_price": price,
            "unrealized_pnl": round(self.ledger.unrealized(price), 2),
            "distance_to_liq": f"{abs(price - pos['liq_price']) / price:.2%}",
        }}

    def get_equity(self) -> dict:
        self.mark()
        st = self.ledger.state
        equity = self._equity()
        bench = {}
        for sym, p0 in st["start_prices"].items():
            bench[f"{sym} buy-and-hold"] = f"{self.market.price(sym) / p0 - 1:+.2%}"
        return {
            "equity": round(equity, 2), "cash": round(st["cash"], 2), "start_equity": st["start_equity"],
            "return_since_start": f"{equity / st['start_equity'] - 1:+.2%}", "since": _iso(st["start_ts"]),
            "benchmarks_since_start": bench, "today_start_equity": round(st["day"]["start_equity"], 2),
            "fills": len(st["fills"]),
            "fees_paid": round(sum(f.get("fee", 0) for f in st["fills"]), 2),
            "liquidations": sum(1 for f in st["fills"] if f["kind"] == "liquidation"),
        }

    # write tools (every one goes through the risk gate)
    def open(self, side: str, symbol: str, leverage, reasoning: str, size_pct=None) -> dict:
        self.mark()
        size_pct = self.limits.size_cap if size_pct is None else size_pct
        equity = self._equity()
        request = {"side": side, "symbol": symbol, "leverage": leverage, "size_pct": size_pct,
                   "reasoning": reasoning}
        reject = check_entry(self.limits, self.ledger.state, equity, symbol, leverage, size_pct,
                             reasoning, self.clock())
        if reject:
            return self._log({"action": f"open_{side}", "accepted": False, "reject": reject, "request": request})
        fill = self.ledger.open(symbol, side, self.market.price(symbol), equity * size_pct, float(leverage),
                                self.clock())
        return self._log({"action": f"open_{side}", "accepted": True, "request": request, "fill": fill,
                          "liq_price": self.ledger.state["position"]["liq_price"]})

    def close(self, reasoning: str) -> dict:
        self.mark()  # closes are always allowed, even when halted
        pos = self.ledger.position
        if not pos:
            return self._log({"action": "close", "accepted": False, "reject": "no open position",
                              "reasoning": reasoning})
        fill = self.ledger.close(self.market.price(pos["symbol"]), self.clock())
        return self._log({"action": "close", "accepted": True, "reasoning": reasoning, "fill": fill})

    def hold(self, reasoning: str) -> dict:
        self.mark()
        return self._log({"action": "hold", "accepted": True, "reasoning": reasoning})
