// On-demand only: fetches NSE daily files published after the bundled dataset ends.
// Runs only when someone presses "Check this week" — nothing is scheduled.
import { unzipSync, strFromU8 } from "fflate";
import type { DayData, ExpiryChain, OHLC } from "@/lib/types";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const dmy = (d: Date) => `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;

async function get(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, cache: "no-store" });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    const head = strFromU8(b.slice(0, 20)).trim().toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html")) return null;
    return b;
  } catch {
    return null;
  }
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h.trim()] = c[i]));
    return o;
  });
}

async function fetchDay(d: Date): Promise<DayData | null> {
  const zip = await get(`https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ymd(d)}_F_0000.csv.zip`);
  if (!zip) return null;
  const idx = await get(`https://nsearchives.nseindia.com/content/indices/ind_close_all_${dmy(d)}.csv`);
  if (!idx) return null;
  const files = unzipSync(zip);
  const csv = strFromU8(Object.values(files)[0]);
  const iso = d.toISOString().slice(0, 10);

  let n: OHLC | null = null, v: OHLC | null = null;
  for (const r of parseCsv(strFromU8(idx))) {
    const name = (r["Index Name"] ?? "").trim().toLowerCase();
    const q = [r["Open Index Value"], r["High Index Value"], r["Low Index Value"], r["Closing Index Value"]].map((x) => parseFloat(x) || 0) as OHLC;
    if (name === "nifty 50") n = q;
    if (name === "india vix") v = q;
  }
  if (!n) return null;
  const spot = n[3];
  const rows = parseCsv(csv).filter((r) => r.TckrSymb === "NIFTY" && r.FinInstrmTp === "IDO" && r.XpryDt >= iso);
  const exps = [...new Set(rows.map((r) => r.XpryDt))].sort().slice(0, 2);
  const x: ExpiryChain[] = [];
  for (const e of exps) {
    const rs = rows.filter((r) => r.XpryDt === e && Math.abs(parseFloat(r.StrkPric) / spot - 1) <= 0.09 && parseFloat(r.StrkPric) % 50 === 0);
    if (!rs.length) continue;
    const ks = rs.map((r) => parseFloat(r.StrkPric));
    const k0 = Math.min(...ks), k1 = Math.max(...ks);
    const len = Math.round((k1 - k0) / 50) + 1;
    const ce: (OHLC | null)[] = Array(len).fill(null), pe: (OHLC | null)[] = Array(len).fill(null);
    for (const r of rs) {
      const i = Math.round((parseFloat(r.StrkPric) - k0) / 50);
      const c = parseFloat(r.ClsPric) || parseFloat(r.SttlmPric) || 0;
      const vol = parseFloat(r.TtlTradgVol) || 0;
      const q: OHLC = vol === 0 ? [0, 0, 0, c] : [parseFloat(r.OpnPric) || 0, parseFloat(r.HghPric) || 0, parseFloat(r.LwPric) || 0, c];
      if (!q[0] && !q[3]) continue;
      (r.OptnTp === "CE" ? ce : pe)[i] = q;
    }
    x.push({ e, k0, st: 50, ce, pe });
  }
  if (!x.length) return null;
  return { d: iso, n, v, x };
}

export async function GET(req: Request) {
  const since = new URL(req.url).searchParams.get("since");
  if (!since) return Response.json({ error: "since required" }, { status: 400 });
  const start = new Date(since + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() + 1);
  const today = new Date();
  const dates: Date[] = [];
  for (const d = new Date(start); d <= today && dates.length < 25; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(new Date(d));
  }
  const days: DayData[] = [];
  for (const d of dates) {
    const r = await fetchDay(d);
    if (r) days.push(r);
  }
  return Response.json({ days, checked: dates.length });
}
