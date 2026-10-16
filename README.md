# Nifty Strategy Lab

Describe a Nifty weekly options strategy in plain English or by voice. The app turns it into exact rules, runs it over 5 years of real NSE data, and explains where it works, where it breaks, and what to change.

## What's inside

| Part | What it does |
|---|---|
| `public/data/` | 5 years of NSE daily data: every Nifty weekly option's open/high/low/close (nearest two expiries, strikes within ±9% of Nifty), Nifty 50 and India VIX. Built from NSE's own F&O bhavcopy and index files. |
| `lib/engine.ts` | The backtester. It handles weekly cycles relative to the real expiry dates (Thursday until Aug 2025, Tuesday after, plus holiday shifts), premium-target strike selection, a comfort floor, gap and strike-touch adjustments, recover-the-loss rolling, stop-loss and profit booking, and hedges. |
| `lib/market.ts` | Indian market rules that change over time: Nifty lot sizes (50 → 25 → 75 → 65), STT (0.0625% → 0.1% → 0.15%), exchange fees, GST, stamp duty, and a list of market events. |
| `lib/metrics.ts` | Every metric in the report: returns, drawdowns, Sharpe and Sortino, win/loss stats, regimes (VIX, trend, gap, expiry day, year), Monte Carlo, and more. |
| `app/api/interpret` | Claude reads the strategy (text or voice transcript) and returns structured rules, the assumptions it made, and questions. |
| `app/api/analyze` | Claude reviews the results and suggests concrete changes. Each suggestion can be tested with one click. |
| `app/api/latest` | Fetches days newer than the bundled data from NSE, only when someone presses **Check this week**. |

## Run it on your laptop

```bash
npm install
cp .env.example .env.local     # paste your Anthropic API key into .env.local
npm run dev                    # open http://localhost:3000
```

The app works without a key. You set the rules by hand, and the AI review is replaced by a quick rule-based summary.

## Put it online (Vercel, free tier)

1. Push this folder to a GitHub repository.
2. Go to vercel.com, sign in with GitHub, choose **Add New → Project**, and import the repository.
3. Under **Environment Variables**, add `ANTHROPIC_API_KEY` with your key.
4. Press **Deploy**. You'll get a link that works on phones and laptops.

## Keeping the data fresh

- **This week tab:** pulls any newer NSE days on demand, for that session.
- **Permanent update:** on GitHub, open **Actions → Update market data → Run workflow**. It downloads the new days and commits them, and Vercel redeploys automatically. This runs only when you press it. You can also run `npm run update-data` locally.

## How the backtest models reality (and its limits)

- Entries at 9:16 use the option's **opening price** from the bhavcopy. Exits at 3:30 use the **closing price**. Slippage (default 1%, minimum ₹0.05) is applied to every fill.
- **Gap adjustments** happen at the open using actual opening prices.
- **Strike-touch adjustments** (intraday mode) are detected from Nifty's day high/low. Daily data has no intraday option prices, so the fill is estimated by re-pricing each option at the trigger level with its own implied volatility from that day's close. Choose "Only at 3:30 close" to use actual closing prices instead.
- **Margin** is an estimate (default 9% of notional for a naked strangle). Check your broker's calculator.
- Profits are shown before income tax, with an after-tax figure at your slab rate. F&O profit is business income.
- Minute-level data (exact 9:16 prices and intraday paths) can be added later via the Upstox API.

## Tests

```bash
npm run test:engine   # runs the sample strategy on the bundled data and prints the key numbers
```
