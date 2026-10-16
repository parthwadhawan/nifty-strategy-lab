const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function rupees(x: number, compact = false) {
  const sign = x < 0 ? "−" : "";
  const a = Math.abs(x);
  if (compact) {
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
  }
  return `${sign}₹${inr.format(a)}`;
}

export function pct(x: number, d = 1, signed = false) {
  if (!Number.isFinite(x)) return "–";
  const s = x.toFixed(d);
  const v = s.startsWith("-") ? "−" + s.slice(1) : (signed && x > 0 ? "+" : "") + s;
  return `${v}%`;
}

export function num(x: number, d = 2) {
  if (!Number.isFinite(x)) return "–";
  const s = x.toFixed(d);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateLabel(iso: string, withYear = true) {
  const [y, m, d] = iso.split("-").map(Number);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}
export function weekday(iso: string) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(iso + "T00:00:00Z").getUTCDay()];
}
export const monthName = (m: number) => MONTHS[m - 1];
