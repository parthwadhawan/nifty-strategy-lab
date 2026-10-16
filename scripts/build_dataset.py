"""Turn the per-day cache from fetch_nse.py into the compact files the web app loads.
Writes public/data/days-<year>.json and public/data/meta.json"""
import json, os, glob, datetime as dt
ROOT = os.path.join(os.path.dirname(__file__), "..")
CACHE = os.path.join(ROOT, "data_cache", "days")
OUT = os.path.join(ROOT, "public", "data")
BAND = 0.09   # keep strikes within ±9% of Nifty
N_EXP = 2

def r2(x):
    return round(x, 2) if x else 0

def main():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(CACHE, "*.json")))
    # start from the days already published, so a small update only needs the newest raw files
    existing = {}
    for f in glob.glob(os.path.join(OUT, "days-*.json")):
        for day in json.load(open(f)):
            existing[day["d"]] = day
    for f in files:
        rec = json.load(open(f))
        d = rec["d"]
        spot = rec["nifty"][3]
        if not spot:
            continue
        exps = sorted({o[0] for o in rec["opts"] if o[0] >= d})[:N_EXP]
        chains = []
        for e in exps:
            rows = [o for o in rec["opts"] if o[0] == e and abs(o[1] / spot - 1) <= BAND]
            if not rows:
                continue
            ks = sorted({o[1] for o in rows})
            k0, k1 = ks[0], ks[-1]
            n = int(round((k1 - k0) / 50)) + 1
            ce = [None] * n; pe = [None] * n
            for (_, k, ot, o, h, l, c, s, oi, vol) in rows:
                i = int(round((k - k0) / 50))
                close = c if c else s
                if vol == 0:
                    q = [0, 0, 0, r2(close)]
                else:
                    q = [r2(o), r2(h), r2(l), r2(c or close)]
                if not q[3] and not q[0]:
                    continue
                (ce if ot == "CE" else pe)[i] = q
            chains.append({"e": e, "k0": int(k0), "st": 50, "ce": ce, "pe": pe})
        if not chains:
            continue
        day = {"d": d, "n": [r2(x) for x in rec["nifty"]], "v": [round(x, 2) for x in rec["vix"]] if rec.get("vix") else None, "x": chains}
        existing[d] = day
    by_year = {}
    for d in sorted(existing):
        by_year.setdefault(d[:4], []).append(existing[d])
    years = sorted(by_year)
    for y in years:
        with open(os.path.join(OUT, f"days-{y}.json"), "w") as fh:
            json.dump(by_year[y], fh, separators=(",", ":"))
    alld = [x["d"] for y in years for x in by_year[y]]
    meta = {"start": alld[0], "end": alld[-1], "years": years, "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "NSE F&O bhavcopy + NSE index closing values (daily)", "days": len(alld)}
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
    print(meta)

if __name__ == "__main__":
    main()
