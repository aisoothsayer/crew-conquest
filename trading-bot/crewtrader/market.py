"""Free public crypto candles and prices (Coinbase Exchange, no API key)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

GRANULARITY = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "1d": 86400}
MAX_CANDLES = 300  # Coinbase limit per request


@dataclass(frozen=True)
class Candle:
    ts: int  # bucket start, unix seconds UTC
    open: float
    high: float
    low: float
    close: float
    volume: float

    def as_dict(self) -> dict:
        return {
            "t": datetime.fromtimestamp(self.ts, timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "o": self.open, "h": self.high, "l": self.low, "c": self.close, "v": round(self.volume, 2),
        }


class CoinbaseMarket:
    BASE = "https://api.exchange.coinbase.com"

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout

    def _get(self, path: str, params: dict | None = None):
        url = self.BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        req = urllib.request.Request(url, headers={"User-Agent": "crewtrader/0.1", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Coinbase HTTP {exc.code}: {exc.read().decode(errors='replace')[:200]}") from None

    def price(self, symbol: str) -> float:
        return float(self._get(f"/products/{symbol}/ticker")["price"])

    def candles(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> list[Candle]:
        """Candles with bucket start in [start, end), oldest first."""
        if timeframe not in GRANULARITY:
            raise ValueError(f"timeframe must be one of {', '.join(GRANULARITY)}")
        step = GRANULARITY[timeframe]
        out: dict[int, Candle] = {}
        chunk_start = start
        while chunk_start < end:
            chunk_end = min(end, chunk_start + timedelta(seconds=step * MAX_CANDLES))
            rows = self._get(
                f"/products/{symbol}/candles",
                {"granularity": step, "start": chunk_start.isoformat(), "end": chunk_end.isoformat()},
            )
            for t, low, high, op, close, vol in rows:  # Coinbase order: time, low, high, open, close, volume
                out[int(t)] = Candle(int(t), float(op), float(high), float(low), float(close), float(vol))
            chunk_start = chunk_end
        lo, hi = start.timestamp(), end.timestamp()
        return [out[t] for t in sorted(out) if lo - step < t < hi]
