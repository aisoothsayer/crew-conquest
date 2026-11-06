"""Stdio MCP server exposing the paper desk to Claude Code, Codex or any MCP client.

Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout. Logs go to stderr.
"""

from __future__ import annotations

import json
import sys
import traceback

from . import __version__
from .desk import Desk

DECISION_PROMPT = """You are the decision step of a paper-trading experiment. No real money is at risk, \
and a risk gate enforces every limit, but act as if it were real.
1. Read the last 24h of candles (get_candles) and the open position (get_position, get_equity).
2. Reason about whether there is an edge. "No edge" is a valid and common answer.
3. Decide exactly one: open_long, open_short, close_position, or hold.
4. Call that tool once, with one line of reasoning. Do not retry a rejected write with a different size or leverage to get around the gate."""

_SYM = {"type": "string", "description": "e.g. SOL-USD"}
_REASON = {"type": "string", "description": "one line (10-280 chars) explaining the decision"}
_LEV = {"type": "number", "description": "isolated leverage, 1-5; above 5 is rejected"}
_SIZE = {"type": "number", "description": "margin as share of equity, max 0.25 (default 0.25)"}

TOOLS = [
    {"name": "get_candles", "description": "Public OHLCV candles, oldest first.",
     "inputSchema": {"type": "object", "properties": {
         "symbol": _SYM, "timeframe": {"type": "string", "enum": ["1m", "5m", "15m", "1h", "6h", "1d"]},
         "hours": {"type": "number", "description": "lookback, default 24"}}, "required": ["symbol"]}},
    {"name": "get_position", "description": "The open paper position, if any, with mark price and distance to liquidation.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "get_equity", "description": "Paper equity, return since start and buy-and-hold benchmarks.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "open_long", "description": "Open a long. Passes the risk gate first.",
     "inputSchema": {"type": "object", "properties": {"symbol": _SYM, "leverage": _LEV, "size_pct": _SIZE,
                                                      "reasoning": _REASON},
                     "required": ["symbol", "leverage", "reasoning"]}},
    {"name": "open_short", "description": "Open a short. Passes the risk gate first.",
     "inputSchema": {"type": "object", "properties": {"symbol": _SYM, "leverage": _LEV, "size_pct": _SIZE,
                                                      "reasoning": _REASON},
                     "required": ["symbol", "leverage", "reasoning"]}},
    {"name": "close_position", "description": "Close the open position at market. Always allowed.",
     "inputSchema": {"type": "object", "properties": {"reasoning": _REASON}, "required": ["reasoning"]}},
    {"name": "hold", "description": "Record a decision to do nothing this cycle.",
     "inputSchema": {"type": "object", "properties": {"reasoning": _REASON}, "required": ["reasoning"]}},
]


def call_tool(desk: Desk, name: str, args: dict) -> dict:
    if name == "get_candles":
        return desk.get_candles(args["symbol"], args.get("timeframe", "1h"), float(args.get("hours", 24)))
    if name == "get_position":
        return desk.get_position()
    if name == "get_equity":
        return desk.get_equity()
    if name in ("open_long", "open_short"):
        return desk.open(name.split("_")[1], args["symbol"], args.get("leverage"), args.get("reasoning", ""),
                         args.get("size_pct"))
    if name == "close_position":
        return desk.close(args.get("reasoning", ""))
    if name == "hold":
        return desk.hold(args.get("reasoning", ""))
    raise KeyError(name)


def handle(desk: Desk, msg: dict):
    """Return a JSON-RPC response dict, or None for notifications."""
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None
    if method == "initialize":
        result = {"protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-06-18"),
                  "capabilities": {"tools": {}},
                  "serverInfo": {"name": "crew-paper-desk", "version": __version__},
                  "instructions": DECISION_PROMPT}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        params = msg.get("params", {})
        try:
            out = call_tool(desk, params.get("name"), params.get("arguments") or {})
            rejected = out.get("accepted") is False
            result = {"content": [{"type": "text", "text": json.dumps(out, indent=1)}], "isError": rejected}
        except KeyError as exc:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool or argument {exc}"}}
        except Exception as exc:  # report tool failures to the agent instead of crashing
            traceback.print_exc(file=sys.stderr)
            result = {"content": [{"type": "text", "text": f"error: {exc}"}], "isError": True}
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def serve(desk: Desk) -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        else:
            reply = handle(desk, msg)
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()
