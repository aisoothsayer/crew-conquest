"""One idempotent bot run: read prices, compute the target, reconcile the paper account."""

from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .strategy import LONG, latest_signal

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JOURNAL = ROOT / "journal" / "decisions.jsonl"
STOP_FILE = ROOT / "STOP"


@dataclass
class Config:
    symbols: list[str] = field(default_factory=lambda: ["SPY"])
    fast: int = 20
    slow: int = 50
    max_alloc: float = 0.10  # share of account equity per symbol
    agent: str = "crew"  # tags orders and journal lines, one name per agent/account
    execute: bool = False  # False = dry run: decide and log, place nothing
    journal: Path = DEFAULT_JOURNAL

    def validate(self) -> None:
        if not 0 < self.max_alloc <= 0.25:
            raise ValueError("max_alloc must be in (0, 0.25]")
        if not 2 <= self.fast < self.slow <= 250:
            raise ValueError("need 2 <= fast < slow <= 250")
        if not self.agent.replace("-", "").isalnum() or len(self.agent) > 16:
            raise ValueError("agent must be <= 16 letters, digits or dashes")


def halted() -> Optional[str]:
    if STOP_FILE.exists():
        return f"kill switch file present: {STOP_FILE}"
    if os.environ.get("CREWTRADER_HALT"):
        return "CREWTRADER_HALT is set"
    return None


def _journal(cfg: Config, record: dict) -> None:
    cfg.journal.parent.mkdir(parents=True, exist_ok=True)
    with open(cfg.journal, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True) + "\n")


def run_once(client, cfg: Config, today: Optional[str] = None) -> list[dict]:
    """Decide and (when cfg.execute) act for each symbol. Returns the journal records."""
    cfg.validate()
    now = datetime.now(timezone.utc)
    today = today or now.date().isoformat()
    base = {"ts": now.isoformat(timespec="seconds"), "agent": cfg.agent, "dry_run": not cfg.execute}

    reason = halted()
    if reason:
        record = {**base, "action": "halted", "reason": reason}
        _journal(cfg, record)
        return [record]

    clock = client.clock()
    account = client.account()
    if account.get("trading_blocked") or account.get("account_blocked"):
        record = {**base, "action": "halted", "reason": "account is blocked"}
        _journal(cfg, record)
        return [record]
    equity = float(account["equity"])
    held = {p["symbol"]: float(p["qty"]) for p in client.positions()}
    pending = {o["symbol"] for o in client.open_orders()}

    records = []
    for symbol in cfg.symbols:
        record = {**base, "symbol": symbol, "fast": cfg.fast, "slow": cfg.slow}
        bars = client.daily_closes(symbol, lookback_days=int(cfg.slow * 1.6) + 30)
        # Only completed sessions: drop today's partial bar so reruns agree.
        bars = [b for b in bars if b[0] < today]
        try:
            sig = latest_signal([c for _, c in bars], cfg.fast, cfg.slow)
        except ValueError as exc:
            record.update(action="skip", reason=str(exc))
            records.append(record)
            _journal(cfg, record)
            continue
        qty_held = held.get(symbol, 0.0)
        record.update(
            last_bar=bars[-1][0],
            signal={k: (round(v, 4) if isinstance(v, float) else v) for k, v in asdict(sig).items()},
            position_qty=qty_held,
        )

        side, qty = None, 0
        if qty_held < 0:
            record.update(action="skip", reason="short position found; this bot never shorts, needs a human")
        elif symbol in pending:
            record.update(action="skip", reason="open order already pending")
        elif sig.target == LONG and qty_held == 0:
            qty = math.floor(equity * cfg.max_alloc / sig.last_close)
            side = "buy" if qty > 0 else None
            record.update(action="buy" if side else "skip", qty=qty,
                          reason="fast above slow" if side else "allocation smaller than one share")
        elif sig.target != LONG and qty_held > 0:
            side, qty = "sell", math.floor(qty_held)
            record.update(action="sell", qty=qty, reason="fast at or below slow")
        else:
            record.update(action="hold", reason=f"already {'long' if qty_held else 'flat'}")

        if side and qty > 0:
            if not clock.get("is_open"):
                record.update(action=f"wait-{side}", reason="market closed; rerun during market hours")
            elif cfg.execute:
                # Same id on a rerun the same day -> Alpaca rejects the duplicate.
                coid = f"{cfg.agent}-{symbol}-{today}-{side}"
                try:
                    order = client.submit_order(symbol, qty, side, coid)
                    record.update(order_id=order.get("id"), client_order_id=coid, order_status=order.get("status"))
                except Exception as exc:  # journal and continue with other symbols
                    record.update(action="error", reason=str(exc))
        records.append(record)
        _journal(cfg, record)
    return records


def status(client, start_equity: Optional[float] = None) -> dict:
    account = client.account()
    equity = float(account["equity"])
    out = {
        "equity": equity,
        "cash": float(account["cash"]),
        "positions": [
            {k: p.get(k) for k in ("symbol", "qty", "avg_entry_price", "market_value", "unrealized_pl")}
            for p in client.positions()
        ],
        "open_orders": [{k: o.get(k) for k in ("symbol", "side", "qty", "status", "client_order_id")}
                        for o in client.open_orders()],
    }
    if start_equity:
        out["return_since_start"] = round(equity / start_equity - 1.0, 5)
    return out
