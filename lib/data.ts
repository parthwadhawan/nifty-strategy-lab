import type { Dataset, DayData } from "./types";

let cache: Promise<Dataset> | null = null;

export function loadDataset(onProgress?: (done: number, total: number) => void): Promise<Dataset> {
  if (cache) return cache;
  cache = (async () => {
    const meta = await (await fetch("/data/meta.json")).json();
    let done = 0;
    const parts: DayData[][] = await Promise.all(
      meta.years.map(async (y: string) => {
        const r = await fetch(`/data/days-${y}.json`);
        const j = await r.json();
        onProgress?.(++done, meta.years.length);
        return j;
      }),
    );
    return { meta, days: parts.flat() };
  })();
  cache.catch(() => (cache = null));
  return cache;
}

/** add freshly fetched days (from /api/latest) to the in-memory dataset */
export function extendDataset(ds: Dataset, extra: DayData[]): Dataset {
  const have = new Set(ds.days.map((d) => d.d));
  const add = extra.filter((d) => !have.has(d.d));
  if (!add.length) return ds;
  const days = [...ds.days, ...add].sort((a, b) => a.d.localeCompare(b.d));
  return { meta: { ...ds.meta, end: days[days.length - 1].d }, days };
}
