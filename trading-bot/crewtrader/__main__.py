"""Command line: backtest, run, status."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import backtest, data
from .bot import DEFAULT_JOURNAL, Config, run_once, status


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="crewtrader")
    sub = parser.add_subparsers(dest="cmd", required=True)

    bt = sub.add_parser("backtest", help="backtest a CSV of daily closes or returns")
    bt.add_argument("csv", nargs="+")
    bt.add_argument("--fast", type=int, default=20)
    bt.add_argument("--slow", type=int, default=50)
    bt.add_argument("--cost-bps", type=float, default=5.0)
    bt.add_argument("--delay", type=int, default=1, choices=[0, 1])

    run = sub.add_parser("run", help="one bot pass against the Alpaca paper account")
    run.add_argument("--symbols", default="SPY", help="comma separated, e.g. SPY,QQQ")
    run.add_argument("--fast", type=int, default=20)
    run.add_argument("--slow", type=int, default=50)
    run.add_argument("--max-alloc", type=float, default=0.10)
    run.add_argument("--agent", default="crew")
    run.add_argument("--journal", type=Path, default=DEFAULT_JOURNAL)
    run.add_argument("--execute", action="store_true", help="place paper orders (default: dry run)")

    st = sub.add_parser("status", help="paper account equity, positions and open orders")
    st.add_argument("--start-equity", type=float)

    # AI-decided crypto paper desk (local ledger, public prices)
    for name, text in [("agent-mcp", "serve the paper desk to an AI agent over MCP (stdio)"),
                       ("agent-status", "equity, position and benchmarks for one agent's desk"),
                       ("agent-tick", "mark to market and check liquidation, no decision"),
                       ("agent-decide", "apply one decision JSON through the risk gate"),
                       ("agent-prompt", "print the per-cycle decision prompt")]:
        p = sub.add_parser(name, help=text)
        p.add_argument("--agent", default="claude")
        p.add_argument("--start-equity", type=float, default=10_000.0)
        if name == "agent-decide":
            p.add_argument("decision", help='e.g. {"action":"long","symbol":"SOL-USD","leverage":2,"reasoning":"..."}')

    args = parser.parse_args(argv)
    if args.cmd == "backtest":
        for path in args.csv:
            dates, closes = data.load_closes(path)
            result = backtest.run(dates, closes, args.fast, args.slow, args.cost_bps, args.delay)
            print(backtest.format_result(Path(path).stem, args.fast, args.slow, result))
        return 0

    if args.cmd.startswith("agent-"):
        return _agent(args)

    from .alpaca import AlpacaClient  # only needed for account commands

    client = AlpacaClient.from_env()
    if args.cmd == "run":
        cfg = Config(
            symbols=[s.strip().upper() for s in args.symbols.split(",") if s.strip()],
            fast=args.fast, slow=args.slow, max_alloc=args.max_alloc,
            agent=args.agent, execute=args.execute, journal=args.journal,
        )
        for record in run_once(client, cfg):
            print(json.dumps(record, sort_keys=True))
        return 0
    print(json.dumps(status(client, args.start_equity), indent=2))
    return 0


def _agent(args) -> int:
    from .mcp_server import DECISION_PROMPT, serve

    if args.cmd == "agent-prompt":
        print(DECISION_PROMPT)
        return 0
    from .desk import Desk
    from .market import CoinbaseMarket

    desk = Desk(args.agent, CoinbaseMarket(), start_equity=args.start_equity)
    if args.cmd == "agent-mcp":
        serve(desk)
        return 0
    if args.cmd == "agent-tick":
        out = {"liquidation": desk.mark(), **desk.get_position()}
    elif args.cmd == "agent-status":
        out = {**desk.get_equity(), **desk.get_position()}
    else:
        d = json.loads(args.decision)
        action = d.get("action")
        if action in ("long", "short"):
            out = desk.open(action, d.get("symbol", ""), d.get("leverage"), d.get("reasoning", ""), d.get("size_pct"))
        elif action == "close":
            out = desk.close(d.get("reasoning", ""))
        elif action == "hold":
            out = desk.hold(d.get("reasoning", ""))
        else:
            raise SystemExit("action must be long, short, close or hold")
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
