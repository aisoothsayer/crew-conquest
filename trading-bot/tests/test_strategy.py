import os
import tempfile
import unittest
from pathlib import Path

from crewtrader import backtest, data
from crewtrader.strategy import FLAT, LONG, latest_signal, sma, targets


class StrategyTest(unittest.TestCase):
    def test_sma(self):
        self.assertEqual(sma([1, 2, 3, 4], 2), [None, 1.5, 2.5, 3.5])

    def test_targets_follow_trend(self):
        rising = [float(i) for i in range(1, 80)]
        self.assertEqual(targets(rising, 5, 20)[-1], LONG)
        self.assertEqual(targets(rising[::-1], 5, 20)[-1], FLAT)
        self.assertIsNone(targets(rising, 5, 20)[18])

    def test_crossed_today(self):
        closes = [100.0] * 30 + [101.0]
        sig = latest_signal(closes, 3, 10)
        self.assertEqual(sig.target, LONG)
        self.assertTrue(sig.crossed_today)

    def test_rejects_bad_windows(self):
        with self.assertRaises(ValueError):
            targets([1.0] * 60, 50, 20)


class BacktestTest(unittest.TestCase):
    def test_no_lookahead(self):
        # Price jumps once. A strategy that is flat beforehand must not earn the jump.
        closes = [100.0] * 60 + [200.0] * 40
        dates = [f"d{i:03d}" for i in range(100)]
        result = backtest.run(dates, closes, 5, 20, cost_bps=0)
        self.assertAlmostEqual(result.strategy.total_return, 0.0)
        self.assertAlmostEqual(result.buy_and_hold.total_return, 1.0)

    def test_costs_reduce_return(self):
        closes = [100 + (i % 10) for i in range(300)]
        dates = [str(i) for i in range(300)]
        free = backtest.run(dates, closes, 3, 8, cost_bps=0).strategy.total_return
        paid = backtest.run(dates, closes, 3, 8, cost_bps=50).strategy.total_return
        self.assertLess(paid, free)

    def test_load_returns_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "r.csv"
            path.write_text("date,return\n2020-01-01 00:00:00+00:00,0.1\n2020-01-02,-0.5\n")
            dates, closes = data.load_closes(path)
        self.assertEqual(dates, ["2020-01-01", "2020-01-02"])
        self.assertAlmostEqual(closes[1], 55.0)
