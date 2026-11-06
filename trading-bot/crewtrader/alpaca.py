"""Minimal Alpaca REST client (standard library only), locked to paper trading."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from typing import Any, Optional

PAPER_URL = "https://paper-api.alpaca.markets"
DATA_URL = "https://data.alpaca.markets"


class AlpacaError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"Alpaca HTTP {status}: {body[:300]}")
        self.status = status
        self.body = body


class PaperOnlyError(RuntimeError):
    pass


class AlpacaClient:
    def __init__(self, key_id: str, secret: str, feed: str = "iex", timeout: float = 20.0):
        if not key_id or not secret:
            raise ValueError("Alpaca key id and secret are required")
        self._headers = {
            "APCA-API-KEY-ID": key_id,
            "APCA-API-SECRET-KEY": secret,
            "Accept": "application/json",
        }
        self.feed = feed
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "AlpacaClient":
        base = os.environ.get("APCA_API_BASE_URL", PAPER_URL).rstrip("/")
        if base != PAPER_URL:
            # This project never places live orders. Changing that is a human
            # decision that belongs in a separate, reviewed project.
            raise PaperOnlyError(f"refusing non-paper endpoint {base!r}; only {PAPER_URL} is allowed")
        return cls(
            os.environ.get("APCA_API_KEY_ID", ""),
            os.environ.get("APCA_API_SECRET_KEY", ""),
            feed=os.environ.get("CREWTRADER_FEED", "iex"),
        )

    def _request(self, method: str, url: str, body: Optional[dict] = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        headers = dict(self._headers)
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as exc:
            raise AlpacaError(exc.code, exc.read().decode(errors="replace")) from None
        return json.loads(raw) if raw else None

    def _trading(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        return self._request(method, PAPER_URL + path, body)

    # trading API
    def account(self) -> dict:
        return self._trading("GET", "/v2/account")

    def clock(self) -> dict:
        return self._trading("GET", "/v2/clock")

    def positions(self) -> list[dict]:
        return self._trading("GET", "/v2/positions")

    def open_orders(self) -> list[dict]:
        return self._trading("GET", "/v2/orders?status=open&limit=500")

    def submit_order(self, symbol: str, qty: int, side: str, client_order_id: str) -> dict:
        return self._trading(
            "POST",
            "/v2/orders",
            {
                "symbol": symbol,
                "qty": str(qty),
                "side": side,
                "type": "market",
                "time_in_force": "day",
                "client_order_id": client_order_id,
            },
        )

    # market data API
    def daily_closes(self, symbol: str, lookback_days: int) -> list[tuple[str, float]]:
        """Split- and dividend-adjusted daily closes, oldest first."""
        start = (date.today() - timedelta(days=lookback_days)).isoformat()
        params = {
            "symbols": symbol,
            "timeframe": "1Day",
            "start": start,
            "adjustment": "all",
            "feed": self.feed,
            "limit": "10000",
        }
        out: list[tuple[str, float]] = []
        token = None
        while True:
            if token:
                params["page_token"] = token
            url = f"{DATA_URL}/v2/stocks/bars?{urllib.parse.urlencode(params)}"
            payload = self._request("GET", url)
            for bar in (payload.get("bars") or {}).get(symbol, []):
                out.append((bar["t"][:10], float(bar["c"])))
            token = payload.get("next_page_token")
            if not token:
                return out
