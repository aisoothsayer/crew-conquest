import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from crewtrader import bot
from crewtrader.alpaca import AlpacaClient, PaperOnlyError


class FakeClient:
    def __init__(self, closes, qty=0.0, is_open=True, pending=()):
        self.closes = closes
        self.qty = qty
        self.is_open = is_open
        self.pending = pending
        self.orders = []

    def clock(self):
        return {"is_open": self.is_open}

    def account(self):
        return {"equity": "50000", "cash": "50000"}

    def positions(self):
        return [{"symbol": "SPY", "qty": str(self.qty)}] if self.qty else []

    def open_orders(self):
        return [{"symbol": s} for s in self.pending]

    def daily_closes(self, symbol, lookback_days):
        bars = [(f"2026-01-{i:03d}", c) for i, c in enumerate(self.closes)]
        return bars + [("2026-12-31", 1.0)]  # "today": partial bar that must be ignored

    def submit_order(self, symbol, qty, side, client_order_id):
        self.orders.append((symbol, qty, side, client_order_id))
        return {"id": "o1", "status": "accepted"}


RISING = [100.0 + i for i in range(80)]
FALLING = RISING[::-1]


class BotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.journal = Path(self.tmp.name) / "j.jsonl"
        self.stop = mock.patch.object(bot, "STOP_FILE", Path(self.tmp.name) / "STOP")
        self.stop.start()

    def tearDown(self):
        self.stop.stop()
        self.tmp.cleanup()

    def cfg(self, **kw):
        return bot.Config(journal=self.journal, **kw)

    def test_dry_run_places_nothing(self):
        client = FakeClient(RISING)
        [rec] = bot.run_once(client, self.cfg(), today="2026-12-31")
        self.assertEqual(rec["action"], "buy")
        self.assertEqual(client.orders, [])
        self.assertTrue(self.journal.exists())

    def test_buy_sizes_to_allocation(self):
        client = FakeClient(RISING)
        bot.run_once(client, self.cfg(execute=True), today="2026-12-31")
        # 10% of 50,000 at last completed close 179 -> 27 shares; partial bar ignored
        self.assertEqual(client.orders, [("SPY", 27, "buy", "crew-SPY-2026-12-31-buy")])

    def test_sell_when_trend_turns(self):
        client = FakeClient(FALLING, qty=27)
        bot.run_once(client, self.cfg(execute=True), today="2026-12-31")
        self.assertEqual(client.orders[0][2], "sell")

    def test_hold_and_pending_and_closed(self):
        self.assertEqual(bot.run_once(FakeClient(RISING, qty=5), self.cfg(execute=True), "2026-12-31")[0]["action"], "hold")
        self.assertEqual(bot.run_once(FakeClient(RISING, pending=["SPY"]), self.cfg(execute=True), "2026-12-31")[0]["action"], "skip")
        closed = FakeClient(RISING, is_open=False)
        self.assertEqual(bot.run_once(closed, self.cfg(execute=True), "2026-12-31")[0]["action"], "wait-buy")
        self.assertEqual(closed.orders, [])

    def test_kill_switch(self):
        bot.STOP_FILE.write_text("stop")
        client = FakeClient(RISING)
        [rec] = bot.run_once(client, self.cfg(execute=True), today="2026-12-31")
        self.assertEqual(rec["action"], "halted")
        self.assertEqual(client.orders, [])

    def test_config_limits(self):
        with self.assertRaises(ValueError):
            bot.run_once(FakeClient(RISING), self.cfg(max_alloc=0.5))

    def test_live_endpoint_refused(self):
        with mock.patch.dict(os.environ, {"APCA_API_BASE_URL": "https://api.alpaca.markets",
                                          "APCA_API_KEY_ID": "k", "APCA_API_SECRET_KEY": "s"}):
            with self.assertRaises(PaperOnlyError):
                AlpacaClient.from_env()
