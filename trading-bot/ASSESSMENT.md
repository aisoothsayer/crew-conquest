# Assessment: the "Claude trading bot" TikTok

Source: [@laeshaai_ on TikTok](https://www.tiktok.com/@laeshaai_/video/7702135544335109406), 6m19s, about 76.5k plays when reviewed on 2026-11-06. The video is labeled educational, uses paper money only and is described as not financial advice. These notes come from TikTok's English auto-captions.

## What the video proposes

1. Install the Claude Desktop app and open a `trading bot` folder in Claude Code.
2. Open an **Alpaca** brokerage account and make a **paper** (fake-money) account, $50,000 in the video.
3. Add the Alpaca MCP server to Claude Desktop's config, with the Alpaca key and secret pasted into the config file.
4. Ask Claude for the balance and to "buy one share of Apple". Claude places the order through the MCP.
5. Automate it with rules. The strategy is a **20-day / 50-day moving-average crossover**: hold when the 20-day average is above the 50-day average, and exit otherwise.
6. The full prompts sit behind "comment 'trade'" and the creator's bio links, so they are not in the video.

The case it makes for a bot: it follows rules without emotion, never forgets to check, and watches the market while you sleep. That part is true and is the real value.

## Does the strategy work? A backtest on real data

The backtest code is in `crewtrader/backtest.py`. A signal is computed at the close of day t and filled at the close of day t+1 (no look-ahead). Each buy or sell costs 5 bps. Cash earns 0%.

| Data | Rule | Strategy CAGR | Buy & hold CAGR | Strategy max drawdown | Buy & hold max drawdown | Trades |
|---|---|---|---|---|---|---|
| SPY 1993–2018 | **20/50 (video)** | **3.3%** | **7.9%** | -39% | -55% | 140 |
| SPY 1993–2018 | 10/30 | 4.0% | 7.9% | -37% | -55% | 233 |
| SPY 1993–2018 | 50/200 | 8.4% | 8.0% | -20% | -55% | 23 |
| GOOG 2004–2013 | **20/50 (video)** | **11.6%** | **18.9%** | -38% | -65% | 41 |
| GOOG 2004–2013 | 10/30 | 25.8% | 24.0% | -30% | -65% | 67 |
| GOOG 2004–2013 | 50/200 | 6.3% | 14.1% | -44% | -65% | 11 |

The 20/50 rule on SPY by period, strategy vs buy & hold: 1993–99: 9.0% vs 19.2%; 2000–07: -2.3% vs 0.6%; 2008–12: -0.2% vs 2.7%; 2013–18: 7.3% vs 13.2%. **It lost to buy-and-hold in every period.** With costs set to zero it still makes only 3.6%. Cash earning interest would add roughly 1 point a year in some periods (the strategy is out of the market about 35% of the time), which still leaves a large gap.

Where the data came from: SPY daily returns are the benchmark file shipped with the `zipline-reloaded` package, compounded into an index. GOOG daily prices are the sample file shipped with the `backtesting` package. Neither file is committed here. Use `python -m crewtrader backtest <csv>` to rerun on any CSV of daily closes.

## Verdict

- **As a way to make money: no, not as shown.** The video's exact rule roughly halved returns compared with just holding the index. Its strength is smaller drawdowns, which it buys at a large cost in return. Results swing with the window lengths (10/30 won on GOOG, 50/200 won on SPY). That is a warning sign of curve-fitting, not an edge.
- **As a project or a content piece: yes, with paper money.** It is a good, honest demo of an AI agent running a disciplined process: rules, logs, risk limits and a public scoreboard. That suits AI Soothsayer's audience.
- **Design fix vs. the video:** don't let the LLM place trades by chatting through an MCP. Language-model output is not deterministic, and a misread prompt becomes a real order. Here **code makes every trade decision**, and the agent only runs, monitors and reports. The MCP route is fine for asking questions about the account.

## Hard lines for us

- **Paper only.** The client refuses any non-paper Alpaca endpoint. Going live is a separate human decision with its own review, not a config flag.
- **Never trade for viewers or the crew, pool their money, or tie trades to game rewards or betting.** Managing or advising other people's money is regulated (broker-dealer and investment-adviser rules), and stream-linked "picks" invite trouble. Showing our own paper results with a "not financial advice" note is fine.
- Keys go in environment variables or a secret store, never in Git, a stream overlay or a screenshot. The video pastes them into a desktop config file, so treat that machine as holding live credentials.

---

# Assessment 2: "Day 17" — Claude decides, a risk gate disposes

Source: a later @laeshaai_ video ("Follow for day 17! #trading #claude #sidehustle", 2026-10-28), reviewed from screenshots of its framework diagram. The video could not be fetched directly.

## The framework, as reverse-engineered from the diagram

```
public candles (free, e.g. SOL) ──> Claude Code
                                   1. read the last 24h and the open position
                                   2. reason about whether there is an edge
                                   3. decide: long · short · close · hold
                                   4. return one line of reasoning with it
                                          │ decision json
                                          ▼
                     MCP server   READ  get_candles(sym, tf) · get_position() · get_equity()
                                  WRITE open_long(sym, lev) · open_short(sym, lev) · close_position()
                                          │ every write passes through this first
                                          ▼
                     RISK GATE    size cap 25% of equity per position, as margin
                                  leverage cap 5x isolated, rejected above
                                  concurrency 1 position, no second entry
                                  fees 0.04% × 2, charged on every fill
                                          ▼
                     PAPER LEDGER fills at the real price, marks to the real market,
                                  on my laptop, not an exchange
```

This is rebuilt in `crewtrader/` as the **paper desk**: `market.py` (free Coinbase candles), `mcp_server.py` (same read and write tools, plus `hold`), `risk.py` (the gate) and `ledger.py`. It adds isolated-margin liquidation, checked against candle lows and highs between calls. Additions not in the diagram: a kill switch, a 15% daily-loss halt on new entries, a 15-minute cooldown between a fill and a new entry, and a required one-line reason on every write. The gate rejects requests and never quietly shrinks them.

## Verdict

- **The architecture is right.** The model proposes, deterministic code enforces limits, and every action is logged with its reason. Keep this shape for anything an AI touches.
- **The "edge" step is the weak link.** Nothing shows a language model can find a durable edge in 24 hours of candles, so expect roughly zero before costs. Costs are not zero. At 25% margin × 5x, the position is 1.25× equity. A round trip costs 0.08% × 1.25 ≈ **0.1% of equity** in fees alone, before slippage and funding. One trade a day is about **-30% a year** of drag.
- **5x isolated hurts.** A move of about 19.5% against the position wipes out that position's margin, which is 25% of the account. SOL has made 20% daily moves. Four liquidations leave about 32% of the account.
- **It can't be backtested honestly.** A model may have memorized historical prices. Only forward paper trading counts, and 17 days cannot separate skill from luck. Judge it over months against buy-and-hold and against doing nothing.
- **Real money is a different matter.** The ledger ignores funding payments, and paper fills are kinder than real ones. Leveraged crypto perpetuals are mostly offered by venues that don't accept US customers. Keep it paper.
- **As content it's strong** (22.1k likes on day 17). The best version for us is a **public race**: Claude vs Codex vs the plain SMA bot vs buy-and-hold, each with its own paper account, results posted every day, losses included. No viewer money, no picks for viewers, and no link to game rewards.
