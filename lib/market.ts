// Indian market rules that change over time. Keep these in one place so they're easy to update.

/** Nifty lot size by contract expiry date (weekly contracts). */
export function niftyLotSize(expiry: string): number {
  if (expiry > "2025-12-23") return 65; // NSE revision, first weekly at 65: 6 Jan 2026
  if (expiry >= "2024-12-26") return 75; // SEBI ₹15L min contract value; first weekly at 75: 2 Jan 2025
  if (expiry > "2024-04-25") return 25; // revision effective 26 Apr 2024
  return 50;
}

/** Statutory charge rates on option premium turnover, by trade date. */
export function chargeRates(date: string) {
  const sttSell = date >= "2026-04-01" ? 0.0015 : date >= "2024-10-01" ? 0.001 : 0.000625;
  const exchange = date >= "2024-10-01" ? 0.0003503 : 0.0005;
  return { sttSell, exchange, sebi: 0.000001, stampBuy: 0.00003, gst: 0.18 };
}

export function legCharges(date: string, side: "sell" | "buy", turnover: number, brokerage: number) {
  const r = chargeRates(date);
  const stt = side === "sell" ? turnover * r.sttSell : 0;
  const exch = turnover * r.exchange;
  const sebi = turnover * r.sebi;
  const stamp = side === "buy" ? turnover * r.stampBuy : 0;
  const gst = r.gst * (brokerage + exch + sebi);
  return stt + exch + sebi + stamp + gst + brokerage;
}

// ---------- Black–Scholes (used only to fill rare missing quotes, expected-move and the live plan) ----------

function ncdf(x: number) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  const t = 1 / (1 + (p * Math.abs(x)) / Math.SQRT2);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + s * y);
}

export function bsPrice(type: "CE" | "PE", S: number, K: number, years: number, iv: number, r = 0.065) {
  const T = Math.max(years, 1 / 365 / 4);
  const sig = Math.max(iv, 0.05);
  const d1 = (Math.log(S / K) + (r + (sig * sig) / 2) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  if (type === "CE") return S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2);
  return K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
}

export function calendarDays(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function expectedMove(spot: number, vix: number, fromDate: string, expiry: string) {
  const days = Math.max(calendarDays(fromDate, expiry), 0.5);
  return spot * (vix / 100) * Math.sqrt(days / 365);
}

// ---------- Market events (for tagging cycles) ----------

export const MARKET_EVENTS: { d: string; label: string }[] = [
  { d: "2021-11-26", label: "Omicron variant sell-off" },
  { d: "2022-02-01", label: "Union Budget 2022" },
  { d: "2022-02-24", label: "Russia invades Ukraine" },
  { d: "2022-03-07", label: "War sell-off low" },
  { d: "2022-05-04", label: "Surprise RBI rate hike" },
  { d: "2022-06-13", label: "US CPI shock sell-off" },
  { d: "2022-09-23", label: "Fed hawkish sell-off" },
  { d: "2023-01-27", label: "Adani–Hindenburg sell-off" },
  { d: "2023-02-01", label: "Union Budget 2023" },
  { d: "2023-03-13", label: "SVB banking crisis" },
  { d: "2023-12-04", label: "State election results rally" },
  { d: "2024-02-01", label: "Interim Budget 2024" },
  { d: "2024-06-03", label: "Exit-poll gap-up" },
  { d: "2024-06-04", label: "Election results crash" },
  { d: "2024-07-23", label: "Union Budget 2024 (STT hike)" },
  { d: "2024-08-05", label: "Yen carry-trade unwind" },
  { d: "2024-10-03", label: "Middle-East escalation sell-off" },
  { d: "2025-02-01", label: "Union Budget 2025" },
  { d: "2025-04-02", label: "US 'Liberation Day' tariffs" },
  { d: "2025-04-07", label: "Global tariff crash" },
  { d: "2025-05-07", label: "Operation Sindoor" },
  { d: "2025-05-12", label: "Ceasefire gap-up rally" },
  { d: "2025-09-02", label: "First Tuesday weekly expiry" },
  { d: "2026-02-01", label: "Union Budget 2026 (STT hike)" },
];
