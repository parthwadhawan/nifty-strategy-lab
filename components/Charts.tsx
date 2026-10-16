"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { BacktestResult, CycleResult } from "@/lib/types";
import type { Metrics } from "@/lib/metrics";
import { dateLabel, monthName, pct, rupees } from "@/lib/format";

const VARS = ["--s1", "--s2", "--s3", "--pos", "--neg", "--grid", "--axis", "--muted", "--ink-2", "--surface", "--mid"] as const;
type Theme = Record<(typeof VARS)[number], string>;

export function useTheme(): Theme {
  const read = () => {
    const out: any = {};
    if (typeof window === "undefined") return out;
    const cs = getComputedStyle(document.documentElement);
    for (const v of VARS) out[v] = cs.getPropertyValue(v).trim();
    return out;
  };
  const [t, setT] = useState<Theme>(read);
  useEffect(() => {
    setT(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const f = () => setT(read());
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return t;
}

const axisProps = (t: Theme) => ({
  stroke: t["--axis"],
  tick: { fill: t["--muted"], fontSize: 11.5 },
  tickLine: false,
});

const yearTick = (d: string) => d.slice(0, 4);
const compactRupee = (v: number) => rupees(v, true).replace("₹", "₹");

function TipBox({ children }: { children: React.ReactNode }) {
  return <div className="tooltip">{children}</div>;
}

/** Equity curve of the strategy vs putting the same capital into Nifty */
export function EquityChart({ res }: { res: BacktestResult }) {
  const t = useTheme();
  const data = useMemo(() => res.daily.map((p) => ({ d: p.d, eq: Math.round(p.equity), bh: Math.round(p.benchmark) })), [res]);
  const yearTicks = useMemo(() => {
    const seen = new Set<string>();
    return data.filter((p) => { const y = p.d.slice(0, 4); if (seen.has(y)) return false; seen.add(y); return true; }).map((p) => p.d).slice(1);
  }, [data]);
  return (
    <>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><i style={{ background: t["--s1"] }} />This strategy</span>
        <span><i style={{ background: t["--s2"] }} />Same money in Nifty (buy &amp; hold)</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={t["--grid"]} vertical={false} />
          <XAxis dataKey="d" {...axisProps(t)} ticks={yearTicks} tickFormatter={yearTick} />
          <YAxis {...axisProps(t)} tickFormatter={compactRupee} width={70} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p: any = payload[0].payload;
              return (
                <TipBox>
                  <b>{dateLabel(p.d)}</b>
                  <div>Strategy: {rupees(p.eq)}</div>
                  <div>Nifty buy &amp; hold: {rupees(p.bh)}</div>
                </TipBox>
              );
            }}
          />
          <ReferenceLine y={res.spec.sizing.capital} stroke={t["--axis"]} />
          <Area type="monotone" dataKey="eq" stroke="none" fill={t["--s1"]} fillOpacity={0.1} isAnimationActive={false} baseValue={res.spec.sizing.capital} />
          <Line type="monotone" dataKey="bh" stroke={t["--s2"]} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="eq" stroke={t["--s1"]} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

/** How far below its previous high the account was, in % of capital */
export function DrawdownChart({ res }: { res: BacktestResult }) {
  const t = useTheme();
  const data = useMemo(() => {
    let peak = -Infinity;
    const cap = res.spec.sizing.capital;
    return res.daily.map((p) => { peak = Math.max(peak, p.equity); return { d: p.d, dd: ((p.equity - peak) / cap) * 100 }; });
  }, [res]);
  const yearTicks = useMemo(() => {
    const seen = new Set<string>();
    return data.filter((p) => { const y = p.d.slice(0, 4); if (seen.has(y)) return false; seen.add(y); return true; }).map((p) => p.d).slice(1);
  }, [data]);
  return (
    <ResponsiveContainer width="100%" height={170}>
      <ComposedChart data={data} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={t["--grid"]} vertical={false} />
        <XAxis dataKey="d" {...axisProps(t)} ticks={yearTicks} tickFormatter={yearTick} />
        <YAxis {...axisProps(t)} tickFormatter={(v) => `${v.toFixed(0)}%`} width={70} />
        <Tooltip content={({ active, payload }) => active && payload?.length ? (
          <TipBox><b>{dateLabel((payload[0].payload as any).d)}</b><div>{pct((payload[0].payload as any).dd, 2)} below the previous high</div></TipBox>
        ) : null} />
        <Area type="monotone" dataKey="dd" stroke={t["--neg"]} strokeWidth={1.5} fill={t["--neg"]} fillOpacity={0.12} isAnimationActive={false} baseValue={0} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Each week's result against how much Nifty moved that week */
export function MoveScatter({ res, onPick }: { res: BacktestResult; onPick?: (c: CycleResult) => void }) {
  const t = useTheme();
  const traded = res.cycles.filter((c) => c.entryDate);
  const calm = traded.filter((c) => !c.adjustments.length).map((c) => ({ x: +c.niftyRangePct.toFixed(2), y: +c.returnPct.toFixed(3), c }));
  const adj = traded.filter((c) => c.adjustments.length).map((c) => ({ x: +c.niftyRangePct.toFixed(2), y: +c.returnPct.toFixed(3), c }));
  return (
    <>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><i style={{ background: t["--s1"], height: 8, width: 8, borderRadius: 4 }} />Weeks with no adjustment</span>
        <span><i style={{ background: t["--s2"], height: 8, width: 8, borderRadius: 4 }} />Weeks with an adjustment</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 16 }}>
          <CartesianGrid stroke={t["--grid"]} />
          <XAxis type="number" dataKey="x" {...axisProps(t)} tickFormatter={(v) => `${v}%`} name="Nifty move"
            label={{ value: "Widest Nifty swing from entry during the week", position: "insideBottom", offset: -10, fill: t["--muted"], fontSize: 11.5 }} />
          <YAxis type="number" dataKey="y" {...axisProps(t)} tickFormatter={(v) => `${v}%`} width={56} name="Week P&L" />
          <ZAxis range={[44, 44]} />
          <ReferenceLine y={0} stroke={t["--axis"]} />
          <ReferenceLine x={0} stroke={t["--axis"]} />
          <ReferenceLine y={res.spec.weeklyTargetPct} stroke={t["--s3"]} strokeWidth={1.5} label={{ value: "goal", fill: t["--muted"], fontSize: 11, position: "insideTopRight" }} />
          <Tooltip cursor={false} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const c: CycleResult = (payload[0].payload as any).c;
            return (
              <TipBox>
                <b>Week to {dateLabel(c.expiry)}</b>
                <div>Result: {pct(c.returnPct, 2, true)} ({rupees(c.netPnl)})</div>
                <div>Widest swing {pct(c.niftyRangePct, 1)} · ended {pct(c.niftyMovePct, 1, true)} · VIX {c.vixEntry.toFixed(1)}</div>
                {c.adjustments.length > 0 && <div>{c.adjustments.length} adjustment(s)</div>}
                {c.events.length > 0 && <div>{c.events.join(", ")}</div>}
              </TipBox>
            );
          }} />
          <Scatter data={calm} fill={t["--s1"]} stroke={t["--surface"]} strokeWidth={1.5} isAnimationActive={false} onClick={(p: any) => onPick?.(p.c)} />
          <Scatter data={adj} fill={t["--s2"]} stroke={t["--surface"]} strokeWidth={1.5} isAnimationActive={false} onClick={(p: any) => onPick?.(p.c)} />
        </ScatterChart>
      </ResponsiveContainer>
    </>
  );
}

/** Distribution of weekly results */
export function Histogram({ m, target }: { m: Metrics; target: number }) {
  const t = useTheme();
  const data = m.histogram.map((b, i) => ({
    ...b,
    tick: i === 0 && b.to <= -3 + 1e-9 && b.from < -3 ? "< −3%" : `${b.from.toFixed(1)}%`,
    label: i === 0 && b.from < -3 ? `Worse than −3% (worst ${b.from.toFixed(1)}%)` : `${b.from.toFixed(1)}% to ${b.to.toFixed(1)}%`,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid stroke={t["--grid"]} vertical={false} />
        <XAxis dataKey="tick" {...axisProps(t)} interval={4} />
        <YAxis {...axisProps(t)} width={36} allowDecimals={false} />
        <Tooltip cursor={{ fill: t["--grid"], opacity: 0.4 }} content={({ active, payload }) => active && payload?.length ? (
          <TipBox><b>{(payload[0].payload as any).label}</b><div>{(payload[0].payload as any).count} weeks</div></TipBox>
        ) : null} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {data.map((b, i) => <Cell key={i} fill={b.to <= 0 + 1e-9 ? t["--neg"] : b.from >= target - 1e-9 ? t["--s3"] : t["--pos"]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Month × year grid of returns */
export function MonthlyHeatmap({ m }: { m: Metrics }) {
  const years = [...new Set(m.monthly.map((x) => x.y))].sort();
  const map = new Map(m.monthly.map((x) => [`${x.y}-${x.m}`, x.pct]));
  const maxAbs = Math.max(1, ...m.monthly.map((x) => Math.abs(x.pct)));
  const bg = (v: number) => {
    const k = Math.min(1, Math.abs(v) / maxAbs);
    const tone = v >= 0 ? "var(--pos)" : "var(--neg)";
    return `color-mix(in oklab, ${tone} ${Math.round(15 + k * 70)}%, var(--mid))`;
  };
  const ink = (v: number) => (Math.abs(v) / maxAbs > 0.55 ? "#fff" : "var(--ink)");
  return (
    <div className="tscroll">
      <div className="heat" style={{ gridTemplateColumns: `52px repeat(12, minmax(44px, 1fr)) 64px`, minWidth: 720 }}>
        <div />
        {Array.from({ length: 12 }, (_, i) => <div key={i} className="hd">{monthName(i + 1)}</div>)}
        <div className="hd"><b>Year</b></div>
        {years.map((y) => {
          const tot = m.monthly.filter((x) => x.y === y).reduce((a, x) => a + x.pct, 0);
          return [
            <div key={`${y}h`} className="hd" style={{ textAlign: "left" }}>{y}</div>,
            ...Array.from({ length: 12 }, (_, i) => {
              const v = map.get(`${y}-${i + 1}`);
              return v === undefined ? <div key={`${y}-${i}`} /> : (
                <div key={`${y}-${i}`} className="c" style={{ background: bg(v), color: ink(v) }} title={`${monthName(i + 1)} ${y}: ${pct(v, 2, true)}`}>{v.toFixed(1)}</div>
              );
            }),
            <div key={`${y}t`} className="c" style={{ fontWeight: 600 }}>{pct(tot, 1, true)}</div>,
          ];
        })}
      </div>
    </div>
  );
}

/** Small diverging bar used inside regime tables */
export function DivBar({ v, max }: { v: number; max: number }) {
  const w = Math.min(50, (Math.abs(v) / (max || 1)) * 50);
  return (
    <div className="bar-cell">
      <span style={{ left: v >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: v >= 0 ? "var(--pos)" : "var(--neg)" }} />
      <span style={{ left: "50%", width: 1, background: "var(--axis)", borderRadius: 0 }} />
    </div>
  );
}
