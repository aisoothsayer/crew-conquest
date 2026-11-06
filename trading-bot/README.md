# Crew Trader (paper only)

Two paper-trading experiments based on the TikTok ideas reviewed in [ASSESSMENT.md](ASSESSMENT.md); read that first.

1. **SMA bot**: a deterministic 20/50 moving-average crossover on an **Alpaca paper account** (stocks). Good as an experiment, and on historical data it is not a winning strategy.
2. **Paper desk**: an AI agent (Claude Code or Codex) reads public crypto candles and decides long, short, close or hold through an MCP server. Every write passes a **risk gate**, and fills land in a **local paper ledger**. No exchange and no keys are involved.

It is separate from the Crew Conquest game. The game's Dockerfile does not copy this folder, and the bot uses only the Python 3.10+ standard library, so it has no dependencies to install.

## How it works

Each `run` is one idempotent pass:

1. Stop if the `STOP` file exists, `CREWTRADER_HALT` is set, or the account is blocked.
2. For each symbol, fetch adjusted daily bars (IEX feed) and **drop today's partial bar**.
3. Target = **long** if the fast SMA is above the slow SMA, otherwise **flat**. This is a state, not just the crossing event, so a missed day or a rerun converges to the same answer.
4. Reconcile: buy whole shares worth `max_alloc` × equity if flat and the target is long; sell everything if long and the target is flat; otherwise hold. Skip a symbol with an open order, and never short.
5. Orders go in only while the market is open and only with `--execute`. Each order's `client_order_id` is `<agent>-<symbol>-<date>-<side>`, so a second run the same day cannot double-buy.
6. Every decision is appended to `journal/decisions.jsonl`.

Defaults match the video: SPY, 20/50, 10% of equity per symbol (hard cap 25%).

## Setup

1. Create a free account at alpaca.markets and generate **paper** API keys (Paper Trading → API Keys).
2. Export them. Do not commit them:
   ```bash
   export APCA_API_KEY_ID=...  APCA_API_SECRET_KEY=...
   ```
   Leave `APCA_API_BASE_URL` unset. Anything other than `https://paper-api.alpaca.markets` is refused.
3. From `trading-bot/`:
   ```bash
   python3 -m unittest discover -s tests          # offline tests
   python3 -m crewtrader status                    # check the connection
   python3 -m crewtrader run                       # dry run: decide and log only
   python3 -m crewtrader run --execute             # place paper orders
   python3 -m crewtrader backtest prices.csv --fast 20 --slow 50
   ```

## Run it daily

Run once per trading day during market hours, e.g. 10:30 America/New_York. Crontab example (the host's timezone must be New York):

```cron
30 10 * * 1-5 cd /path/to/crew-conquest/trading-bot && python3 -m crewtrader run --execute >> journal/cron.log 2>&1
```

A GitHub Actions schedule, a Codex/Claude scheduled task, or any always-on box works the same way. The machine needs the two key variables and HTTPS access to `paper-api.alpaca.markets` and `data.alpaca.markets`.

To stop everything: `touch trading-bot/STOP`.

## Seeing how it goes

- `python3 -m crewtrader status --start-equity 50000` shows equity, return since start, positions and open orders.
- `journal/decisions.jsonl` records each day's SMAs, target and action.
- Judge it against buy-and-hold SPY over the same dates, not against zero. Give it months, not days. A 20/50 crossover trades only a handful of times a year.

## Paper desk (AI-decided, crypto, local ledger)

There is no account to create and no key to set. Prices come from Coinbase's free public API (`api.exchange.coinbase.com`). Each agent gets its own ledger in `journal/agents/<agent>/`, starting at $10,000 of paper money.

| Rule | Default |
|---|---|
| Symbols | SOL-USD, BTC-USD, ETH-USD |
| Margin per position | ≤ 25% of equity (default 25%) |
| Leverage | 1–5x isolated; above 5x is **rejected**, not reduced |
| Concurrency | 1 position; no second entry, no flipping without a close |
| Fees / slippage | 0.04% per fill / 2 bps per fill |
| Liquidation | isolated, 0.5% maintenance margin, checked against candle highs and lows between calls |
| Extra guards | `STOP` file or `CREWTRADER_HALT`, 15% daily-loss halt, 15 min entry cooldown, one-line reason required |

Closing is always allowed, even when halted. Funding payments are not modeled.

**Claude Code:** start `claude` inside `trading-bot/`. The bundled `.mcp.json` registers the `crew-paper-desk` server as agent `claude`; approve it when asked. Then ask: *"Run one paper desk decision cycle."*

**Codex:** add this to `~/.codex/config.toml`:

```toml
[mcp_servers.crew-paper-desk]
command = "python3"
args = ["-m", "crewtrader", "agent-mcp", "--agent", "codex"]
env = { PYTHONPATH = "/absolute/path/to/crew-conquest/trading-bot" }
```

**Any agent or script without MCP:**

```bash
python3 -m crewtrader agent-prompt                       # the per-cycle instructions
python3 -m crewtrader agent-decide --agent codex '{"action":"long","symbol":"SOL-USD","leverage":2,"reasoning":"..."}'
python3 -m crewtrader agent-status --agent codex         # equity, position, distance to liq, buy-and-hold benchmarks
python3 -m crewtrader agent-tick   --agent codex         # mark to market / liquidation check only
```

**Unattended cycles**, e.g. hourly from `trading-bot/`:

```bash
claude -p "$(python3 -m crewtrader agent-prompt)" --allowedTools "mcp__crew-paper-desk__*"
codex exec "$(python3 -m crewtrader agent-prompt)"
```

AI agents that operate either bot follow [AGENTS.md](AGENTS.md).
