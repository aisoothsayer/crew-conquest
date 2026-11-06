import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from crewtrader import risk
from crewtrader.desk import Desk
from crewtrader.ledger import Costs, liquidation_price
from crewtrader.market import Candle
from crewtrader.mcp_server import handle

T0 = 1_800_000_000.0


class FakeMarket:
    def __init__(self, price=100.0):
        self.px = price
        self.lows_highs = []  # extra candles returned by candles()

    def price(self, symbol):
        return self.px

    def candles(self, symbol, timeframe, start, end):
        return [Candle(ts, self.px, h, l, self.px, 1.0) for ts, l, h in self.lows_highs
                if start.timestamp() <= ts < end.timestamp()]


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


class DeskTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.stop = mock.patch.object(risk, "STOP_FILE", Path(self.tmp.name) / "STOP")
        self.stop.start()
        self.market = FakeMarket()
        self.clock = Clock()
        self.desk = Desk("test", self.market, costs=Costs(slippage_bps=0), base_dir=Path(self.tmp.name),
                         clock=self.clock)

    def tearDown(self):
        self.stop.stop()
        self.tmp.cleanup()

    def long(self, lev=5, size=None, reason="trend up on rising volume"):
        return self.desk.open("long", "SOL-USD", lev, reason, size)

    def test_open_and_close_with_fees(self):
        out = self.long(lev=4)
        self.assertTrue(out["accepted"])
        pos = self.desk.ledger.position
        self.assertAlmostEqual(pos["margin"], 2500)  # 25% of 10,000
        self.assertAlmostEqual(pos["qty"], 100)  # 2500 * 4 / 100
        self.market.px = 110
        self.clock.t += 3600
        self.desk.close("target reached")
        # pnl 100 * 10 = 1000, fees 0.04% of 10,000 and of 11,000
        self.assertAlmostEqual(self.desk.ledger.state["cash"], 10_000 + 1000 - 4.0 - 4.4)

    def test_gate_rejects(self):
        self.assertIn("rejected", self.long(lev=6)["reject"])
        self.assertIn("size_pct", self.long(size=0.3)["reject"])
        self.assertIn("not allowed", self.desk.open("long", "DOGE-USD", 2, "meme momentum here")["reject"])
        self.assertIn("reasoning", self.long(reason="yolo")["reject"])
        self.assertTrue(self.long()["accepted"])
        self.assertIn("one position", self.desk.open("short", "SOL-USD", 2, "hedge the long now")["reject"])

    def test_cooldown_and_kill_switch(self):
        self.long()
        self.desk.close("changed my mind quickly")
        self.assertIn("cooldown", self.long()["reject"])
        self.clock.t += 16 * 60
        risk.STOP_FILE.write_text("stop")
        self.assertIn("kill switch", self.long()["reject"])
        risk.STOP_FILE.unlink()
        self.assertTrue(self.long()["accepted"])
        risk.STOP_FILE.write_text("stop")
        self.assertTrue(self.desk.close("closing is always allowed")["accepted"])

    def test_liquidation_from_candle_low(self):
        self.long(lev=5)
        liq = self.desk.ledger.position["liq_price"]
        self.assertAlmostEqual(liq, liquidation_price("long", 100, 5, 0.005))  # 80.5
        self.clock.t += 1800
        self.market.lows_highs = [(int(T0) + 600, liq - 0.01, 101.0)]
        self.desk.get_position()
        self.assertIsNone(self.desk.ledger.position)
        self.assertEqual(self.desk.ledger.state["fills"][-1]["kind"], "liquidation")
        self.assertAlmostEqual(self.desk.ledger.state["cash"], 10_000 - 2500 - 5.0)

    def test_short_profit(self):
        self.desk.open("short", "SOL-USD", 2, "lower highs, fading bounce", 0.1)
        self.market.px = 90
        eq = self.desk.get_equity()
        self.assertGreater(eq["equity"], 10_000)

    def test_daily_loss_halt(self):
        self.long(lev=5)
        self.market.px = 85  # -15% * 5x on 25% margin = -18.75% equity
        self.clock.t += 3600
        self.desk.close("stop out after breakdown")
        self.clock.t += 3600
        self.assertIn("daily loss halt", self.long()["reject"])

    def test_mcp_protocol(self):
        init = handle(self.desk, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                  "params": {"protocolVersion": "2025-06-18"}})
        self.assertEqual(init["result"]["serverInfo"]["name"], "crew-paper-desk")
        self.assertIsNone(handle(self.desk, {"jsonrpc": "2.0", "method": "notifications/initialized"}))
        names = [t["name"] for t in handle(self.desk, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})["result"]["tools"]]
        self.assertEqual(names[:3], ["get_candles", "get_position", "get_equity"])
        bad = handle(self.desk, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "open_long", "arguments": {"symbol": "SOL-USD", "leverage": 10, "reasoning": "going big today"}}})
        self.assertTrue(bad["result"]["isError"])
        self.assertIn("rejected", json.loads(bad["result"]["content"][0]["text"])["reject"])
        self.assertIn("error", handle(self.desk, {"jsonrpc": "2.0", "id": 4, "method": "nope"}))
        journal = (Path(self.tmp.name) / "test" / "decisions.jsonl").read_text().splitlines()
        self.assertFalse(json.loads(journal[-1])["accepted"])
