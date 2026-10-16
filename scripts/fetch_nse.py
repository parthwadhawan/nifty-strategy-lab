"""Download NSE F&O bhavcopies + index closes for a date range and keep only what the
backtester needs (NIFTY index options for the nearest 3 expiries, Nifty 50 + India VIX OHLC).
Usage: python fetch_nse.py 2021-09-01 2026-10-16 [cache_dir]
"""
import sys, os, io, zipfile, csv, time, datetime as dt, json
from concurrent.futures import ThreadPoolExecutor
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
UDIFF_START = dt.date(2024, 7, 8)
MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]

def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            if data[:15].lstrip().lower().startswith(b"<!doctype") or data[:6].lower() == b"<html>":
                return None  # NSE returns an HTML page for missing files/holidays
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1.5 * (i + 1))
        except Exception:
            time.sleep(1.5 * (i + 1))
    return "ERR"

def fo_url(d):
    if d >= UDIFF_START:
        return f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d:%Y%m%d}_F_0000.csv.zip"
    return f"https://archives.nseindia.com/content/historical/DERIVATIVES/{d.year}/{MON[d.month-1]}/fo{d:%d}{MON[d.month-1]}{d.year}bhav.csv.zip"

def idx_url(d):
    return f"https://nsearchives.nseindia.com/content/indices/ind_close_all_{d:%d%m%Y}.csv"

def parse_fo(raw, d):
    z = zipfile.ZipFile(io.BytesIO(raw))
    text = z.read(z.namelist()[0]).decode("utf-8", "ignore")
    rows = []
    rd = csv.DictReader(io.StringIO(text))
    fut = None
    lot = None
    for r in rd:
        if d >= UDIFF_START:
            if r["TckrSymb"] != "NIFTY": continue
            tp = r["FinInstrmTp"]
            exp = r["XpryDt"]
            if tp == "IDF":
                if fut is None or exp < fut[0]: fut = (exp, float(r["ClsPric"]))
                continue
            if tp != "IDO": continue
            k = float(r["StrkPric"]); ot = r["OptnTp"]
            o, h, l, c = (float(r[x] or 0) for x in ("OpnPric","HghPric","LwPric","ClsPric"))
            s = float(r["SttlmPric"] or 0); oi = float(r["OpnIntrst"] or 0); vol = float(r["TtlTradgVol"] or 0)
            try: lot = int(float(r["NewBrdLotQty"]))
            except: pass
        else:
            if r["SYMBOL"] != "NIFTY": continue
            ins = r["INSTRUMENT"]
            exp = dt.datetime.strptime(r["EXPIRY_DT"], "%d-%b-%Y").date().isoformat()
            if ins == "FUTIDX":
                if fut is None or exp < fut[0]: fut = (exp, float(r["CLOSE"]))
                continue
            if ins != "OPTIDX": continue
            k = float(r["STRIKE_PR"]); ot = r["OPTION_TYP"]
            o, h, l, c = (float(r[x] or 0) for x in ("OPEN","HIGH","LOW","CLOSE"))
            s = float(r["SETTLE_PR"] or 0); oi = float(r["OPEN_INT"] or 0); vol = float(r["CONTRACTS"] or 0)
        rows.append((exp, k, ot, o, h, l, c, s, oi, vol))
    return rows, fut, lot

def parse_idx(raw):
    out = {}
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8", "ignore"))):
        n = r["Index Name"].strip().lower()
        if n in ("nifty 50", "india vix"):
            def f(x):
                try: return float(r[x])
                except: return 0.0
            out[n] = [f("Open Index Value"), f("High Index Value"), f("Low Index Value"), f("Closing Index Value")]
    return out

def do_day(d, cache):
    path = os.path.join(cache, f"{d.isoformat()}.json")
    if os.path.exists(path):
        return d, "cached"
    raw = get(fo_url(d))
    if raw is None: return d, "holiday"
    if raw == "ERR": return d, "error-fo"
    idx = get(idx_url(d))
    if idx in (None, "ERR"): return d, "error-idx"
    rows, fut, lot = parse_fo(raw, d)
    ind = parse_idx(idx)
    if "nifty 50" not in ind: return d, "error-noindex"
    spot = ind["nifty 50"][3]
    exps = sorted({r[0] for r in rows if r[0] >= d.isoformat()})[:3]
    keep = [r for r in rows if r[0] in exps and abs(r[1] / spot - 1) <= 0.12 and r[1] % 50 == 0]
    rec = {"d": d.isoformat(), "nifty": ind["nifty 50"], "vix": ind.get("india vix"), "fut": fut, "lot": lot,
           "opts": keep}
    with open(path, "w") as f: json.dump(rec, f, separators=(",", ":"))
    return d, f"ok {len(keep)}"

if __name__ == "__main__":
    a = dt.date.fromisoformat(sys.argv[1]); b = dt.date.fromisoformat(sys.argv[2])
    cache = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), "..", "data_cache", "days")
    os.makedirs(cache, exist_ok=True)
    days = [a + dt.timedelta(n) for n in range((b - a).days + 1)]
    days = [d for d in days if d.weekday() < 5]
    errs = 0
    with ThreadPoolExecutor(4) as ex:
        for i, (d, st) in enumerate(ex.map(lambda d: do_day(d, cache), days)):
            if st.startswith("error"): errs += 1; print(d, st, flush=True)
            if i % 50 == 0: print(i, len(days), d, st, flush=True)
    print("done, errors:", errs)
