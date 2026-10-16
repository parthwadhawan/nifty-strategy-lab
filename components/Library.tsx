"use client";
import { useRef } from "react";
import type { StrategySpec } from "@/lib/types";
import { dateLabel, pct, rupees } from "@/lib/format";

export interface SavedStrategy {
  id: string;
  savedAt: string;
  text: string;
  spec: StrategySpec;
  summary?: { cagr: number; maxDD: number; worstWeek: number; goalHit: number; totalPnl: number; period: string; grade?: string };
}

const KEY = "nifty-lab-library-v1";

export function loadLibrary(): SavedStrategy[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
export function saveLibrary(list: SavedStrategy[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export default function Library(props: {
  items: SavedStrategy[];
  setItems: (l: SavedStrategy[]) => void;
  onOpen: (s: SavedStrategy) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const del = (id: string) => {
    const l = props.items.filter((x) => x.id !== id);
    props.setItems(l);
    saveLibrary(l);
  };
  const exportAll = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(props.items, null, 1)], { type: "application/json" }));
    a.download = "my-strategies.json";
    a.click();
  };
  const importFile = async (f: File) => {
    try {
      const incoming: SavedStrategy[] = JSON.parse(await f.text());
      const ids = new Set(props.items.map((x) => x.id));
      const l = [...props.items, ...incoming.filter((x) => x.spec && !ids.has(x.id))];
      props.setItems(l);
      saveLibrary(l);
    } catch {
      alert("That file doesn't look like a strategy export.");
    }
  };

  return (
    <div className="card">
      <div className="row">
        <div>
          <h2>My strategies</h2>
          <p className="sub" style={{ margin: 0 }}>Saved on this device. Export a file to move them to another phone or laptop.</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={exportAll} disabled={!props.items.length}>Export</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      </div>
      {props.items.length === 0 ? (
        <div className="empty">Nothing saved yet. Run a backtest and press <b>Save to library</b>.</div>
      ) : (
        <div className="tscroll" style={{ marginTop: 14 }}>
          <table className="t">
            <thead><tr><th>Strategy</th><th>Saved</th><th className="n">Yearly</th><th className="n">Biggest fall</th><th className="n">Worst week</th><th className="n">Goal-weeks</th><th className="n">Profit</th><th /></tr></thead>
            <tbody>
              {[...props.items].reverse().map((s) => (
                <tr key={s.id}>
                  <td><b>{s.spec.name}</b>{s.summary?.grade && <span className="tag">Grade {s.summary.grade}</span>}<div className="small muted">{s.summary?.period}</div></td>
                  <td>{dateLabel(s.savedAt.slice(0, 10))}</td>
                  <td className="n">{s.summary ? pct(s.summary.cagr, 1) : "–"}</td>
                  <td className="n neg">{s.summary ? pct(s.summary.maxDD, 1) : "–"}</td>
                  <td className="n neg">{s.summary ? pct(s.summary.worstWeek, 2) : "–"}</td>
                  <td className="n">{s.summary ? pct(s.summary.goalHit, 0) : "–"}</td>
                  <td className="n">{s.summary ? rupees(s.summary.totalPnl, true) : "–"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ghost" onClick={() => props.onOpen(s)}>Open &amp; run</button>
                    <button className="btn ghost" style={{ color: "var(--neg)" }} onClick={() => del(s.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
