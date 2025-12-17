#!/usr/bin/env python3
# scripts/effects-learner.py
import argparse, sys, json

def eprint(*a, **k): print(*a, file=sys.stderr, **k)

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--input", type=str, help="tidy CSV with timestamp,zoneId,rh,tempC,deviceId,duty,deviceType")
    ap.add_argument("--sensors", type=str, help="optional sensors CSV (timestamp,zoneId,rh,tempC)")
    ap.add_argument("--devices", type=str, help="optional devices CSV (timestamp,deviceId,duty,deviceType)")
    ap.add_argument("--timecol", type=str, default="timestamp")
    ap.add_argument("--min_samples", type=int, default=200)
    ap.add_argument("--alpha", type=float, default=0.1, help="ridge strength")
    return ap.parse_args()

def load_csv(path):
    import pandas as pd
    return pd.read_csv(path)

def prepare(args):
    import pandas as pd
    if args.input:
        df = load_csv(args.input)
    else:
        # merge sensors + devices on nearest timestamp (asof)
        s = load_csv(args.sensors) if args.sensors else None
        d = load_csv(args.devices) if args.devices else None
        if s is None or d is None:
            return None
        s[args.timecol] = pd.to_datetime(s[args.timecol], utc=True, errors="coerce")
        d[args.timecol] = pd.to_datetime(d[args.timecol], utc=True, errors="coerce")
        s = s.dropna(subset=[args.timecol]).sort_values(args.timecol)
        d = d.dropna(subset=[args.timecol]).sort_values(args.timecol)
        df = pd.merge_asof(d, s, on=args.timecol, direction="backward")
    if df is None or df.empty: return None

    df[args.timecol] = pd.to_datetime(df[args.timecol], utc=True, errors="coerce")
    df = df.dropna(subset=[args.timecol]).sort_values(args.timecol)
    for c in ["rh","tempC","duty"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["zoneId","deviceId","duty"])
    return df

def fit_effects(df, args):
    import numpy as np, pandas as pd
    try:
        from sklearn.linear_model import Ridge
    except Exception as e:
        eprint("[effects-learner] sklearn missing; emitting zeros."); 
        return {"H":{}, "T":{}, "confidence":{}, "units":{"H":"%RH/min@100%","T":"°C/min@100%"}}

    # Build per-zone dataset at ~minute resolution
    df = df.copy()
    df["dt_s"] = df.groupby("zoneId")[args.timecol].diff().dt.total_seconds().fillna(60)
    df["drh"]   = df.groupby("zoneId")["rh"].diff()
    df["dtemp"] = df.groupby("zoneId")["tempC"].diff()

    # instantaneous rate (%RH/min, °C/min)
    df["rh_rate"] = (df["drh"] / df["dt_s"]) * 60.0
    df["t_rate"]  = (df["dtemp"] / df["dt_s"]) * 60.0

    # Build wide matrix of duties per device at current time (or include lags if you like)
    devs = sorted(df["deviceId"].dropna().unique().tolist())
    pivot = df.pivot_table(index=[args.timecol,"zoneId"], columns="deviceId", values="duty", aggfunc="mean").fillna(0.0)
    pivot.columns.name = None
    pivot = pivot.reset_index()

    # Merge rates back
    rates = df.groupby([args.timecol,"zoneId"])[["rh_rate","t_rate"]].mean().reset_index()
    data = pivot.merge(rates, on=[args.timecol,"zoneId"], how="left").dropna(subset=["rh_rate","t_rate"])

    H, T, CONF = {}, {}, {}
    for z, sub in data.groupby("zoneId"):
        if len(sub) < args.min_samples: 
            continue
        X = sub[devs].values  # duty 0..1 per device
        y_rh = sub["rh_rate"].values
        y_t  = sub["t_rate"].values

        # Ridge (stable on collinearity). Coeff units: (rate units) per (duty unit).
        rh_model = Ridge(alpha=args.alpha, fit_intercept=True).fit(X, y_rh)
        t_model  = Ridge(alpha=args.alpha, fit_intercept=True).fit(X, y_t)

        H[z] = { devs[i]: float(max(0.0, -rh_model.coef_[i])) for i in range(len(devs)) }
        T[z] = { devs[i]: float(t_model.coef_[i]) for i in range(len(devs)) }

        # Simple confidence: 1 - normalized residual variance (not true R^2 but bounded)
        import numpy as np
        def conf(mdl, X, y):
            yp = mdl.predict(X)
            num = np.var(y - yp)
            den = np.var(y) + 1e-9
            c = max(0.0, 1.0 - float(num/den))
            return round(c, 3)
        CONF[z] = { devs[i]: min(1.0, max(0.0, (conf(rh_model,X,y_rh) + conf(t_model,X,y_t))/2.0)) for i in range(len(devs)) }

    return {"H": H, "T": T, "confidence": CONF, "units": {"H":"%RH/min@100%","T":"°C/min@100%"}}

if __name__ == "__main__":
    args = parse_args()
    try:
        import pandas as pd
    except Exception:
        print(json.dumps({"H":{}, "T":{}, "confidence":{}, "units":{"H":"%RH/min@100%","T":"°C/min@100%"}}))
        sys.exit(0)

    try:
        df = prepare(args)
        if df is None or df.empty:
            print(json.dumps({"H":{}, "T":{}, "confidence":{}, "units":{"H":"%RH/min@100%","T":"°C/min@100%"}}))
            sys.exit(0)
        out = fit_effects(df, args)
        out["ok"] = True
        out["updatedAt"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        eprint("[effects-learner] error:", repr(e))
        print(json.dumps({"ok":False, "error":"exception", "message":str(e)}))
        sys.exit(1)
