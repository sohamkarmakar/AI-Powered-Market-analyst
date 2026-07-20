"""
screener_service.py
===================
Intraday Screener backend logic for Market Rover.

Three responsibilities:
1. Batch OHLCV Fetcher   — pulls intraday candles for a list of symbols with caching + concurrency limit
2. Indicator Engine      — RSI, Supertrend, MACD, VWAP, MA, ADX, BB, % change, Volume
3. Condition Evaluator   — applies AND/OR conditions against computed indicator values

All indicator functions are pure (OHLCV list → value dict) so they can be
reused by the Ticker Deep-Dive page without duplication.
"""

from app.services.yfinance_service import yf_session
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import yfinance as yf

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# OHLCV CACHE — in-process, keyed by (symbol, interval)
# ─────────────────────────────────────────────────────────────────────────────
_ohlcv_cache: Dict[str, Dict] = {}   # key: "SYMBOL|interval"  value: {candles, fetched_at}

CACHE_TTL: Dict[str, int] = {
    "1m":  30,
    "5m":  60,
    "15m": 90,
    "1h":  180,
    "1d":  300,
}

# ─────────────────────────────────────────────────────────────────────────────
# UNIVERSE LOADER
# ─────────────────────────────────────────────────────────────────────────────

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "universes")

_universe_cache: Dict[str, List[str]] = {}

def load_universe(name: str) -> List[str]:
    """Load symbols from a universe JSON file. Results are cached in-process."""
    if name in _universe_cache:
        return _universe_cache[name]
    path = os.path.join(_DATA_DIR, f"{name}.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Universe '{name}' not found at {path}")
    with open(path, "r") as f:
        symbols = json.load(f)
    _universe_cache[name] = symbols
    return symbols


def list_universes() -> Dict[str, int]:
    """Returns available universe names and their symbol counts."""
    result = {}
    if not os.path.exists(_DATA_DIR):
        return result
    for fname in os.listdir(_DATA_DIR):
        if fname.endswith(".json"):
            name = fname[:-5]
            try:
                syms = load_universe(name)
                result[name] = len(syms)
            except Exception:
                pass
    return result


# ─────────────────────────────────────────────────────────────────────────────
# BATCH OHLCV FETCHER
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_one_ohlcv(symbol: str, interval: str, period: str) -> Tuple[str, Optional[List[Dict]]]:
    """Fetch OHLCV candles for a single symbol. Returns (symbol, candles_or_None)."""
    cache_key = f"{symbol}|{interval}"
    ttl = CACHE_TTL.get(interval, 60)
    cached = _ohlcv_cache.get(cache_key)
    if cached and (time.time() - cached["fetched_at"]) < ttl:
        return symbol, cached["candles"]

    try:
        ticker = yf.Ticker(symbol, session=yf_session)
        df = ticker.history(period=period, interval=interval)
        if df.empty:
            return symbol, None

        df = df.reset_index()
        candles = []
        for _, row in df.iterrows():
            dt = row.get("Datetime") or row.get("Date")
            if dt is None:
                continue
            ts = dt.to_pydatetime().isoformat() if hasattr(dt, "to_pydatetime") else str(dt)
            candles.append({
                "t": ts,
                "o": round(float(row["Open"]), 4),
                "h": round(float(row["High"]), 4),
                "l": round(float(row["Low"]), 4),
                "c": round(float(row["Close"]), 4),
                "v": int(row["Volume"]),
            })

        _ohlcv_cache[cache_key] = {"candles": candles, "fetched_at": time.time()}
        return symbol, candles
    except Exception as e:
        logger.warning(f"OHLCV fetch failed for {symbol}: {e}")
        # Return stale cache if available
        if cached:
            return symbol, cached["candles"]
        return symbol, None


def fetch_universe_ohlcv(
    symbols: List[str],
    interval: str = "5m",
    period: str = "1d",
    max_workers: int = 10,
) -> Dict[str, Optional[List[Dict]]]:
    """
    Batch-fetch intraday OHLCV for a list of symbols.
    Returns dict: symbol → candles list (or None on failure).
    """
    result: Dict[str, Optional[List[Dict]]] = {}
    with ThreadPoolExecutor(max_workers=min(max_workers, len(symbols))) as executor:
        futures = {executor.submit(_fetch_one_ohlcv, sym, interval, period): sym for sym in symbols}
        for future in as_completed(futures):
            sym, candles = future.result()
            result[sym] = candles
    return result


def get_cache_ages(symbols: List[str], interval: str) -> Dict[str, Optional[float]]:
    """Return age in seconds of cached OHLCV data per symbol, or None if not cached."""
    now = time.time()
    return {
        sym: (now - _ohlcv_cache[f"{sym}|{interval}"]["fetched_at"])
        if f"{sym}|{interval}" in _ohlcv_cache else None
        for sym in symbols
    }


# ─────────────────────────────────────────────────────────────────────────────
# INDICATOR ENGINE — pure functions on OHLCV candle lists
# ─────────────────────────────────────────────────────────────────────────────

def _arrays(candles: List[Dict]) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Unpack candles into (opens, highs, lows, closes, volumes) numpy arrays."""
    o = np.array([c["o"] for c in candles], dtype=float)
    h = np.array([c["h"] for c in candles], dtype=float)
    l = np.array([c["l"] for c in candles], dtype=float)
    c = np.array([c["c"] for c in candles], dtype=float)
    v = np.array([c["v"] for c in candles], dtype=float)
    return o, h, l, c, v


def _wilder_ema(data: np.ndarray, period: int) -> np.ndarray:
    result = np.zeros(len(data))
    if len(data) < period:
        return result
    result[period - 1] = np.mean(data[:period])
    for i in range(period, len(data)):
        result[i] = (result[i - 1] * (period - 1) + data[i]) / period
    return result


def _ema(data: np.ndarray, period: int) -> np.ndarray:
    result = np.zeros(len(data))
    if len(data) < period:
        return result
    k = 2 / (period + 1)
    result[period - 1] = np.mean(data[:period])
    for i in range(period, len(data)):
        result[i] = data[i] * k + result[i - 1] * (1 - k)
    return result


def compute_rsi(candles: List[Dict], period: int = 14) -> Dict[str, Any]:
    """Returns latest RSI and previous RSI."""
    _, _, _, closes, _ = _arrays(candles)
    if len(closes) < period + 2:
        return {"value": None, "prev": None}

    delta = np.diff(closes)
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)

    avg_gain = _wilder_ema(gain, period)
    avg_loss = _wilder_ema(loss, period)

    with np.errstate(divide="ignore", invalid="ignore"):
        rs = np.where(avg_loss == 0, np.inf, avg_gain / avg_loss)
        rsi_vals = np.where(avg_loss == 0, 100.0, 100.0 - 100.0 / (1.0 + rs))

    # rsi_vals is len(closes)-1 because of np.diff
    if len(rsi_vals) < 2:
        return {"value": None, "prev": None}

    return {
        "value": round(float(rsi_vals[-1]), 2),
        "prev":  round(float(rsi_vals[-2]), 2),
    }


def compute_supertrend(candles: List[Dict], period: int = 10, multiplier: float = 3.0) -> Dict[str, Any]:
    """
    Returns current Supertrend direction ('up'/'down') and whether it flipped this bar.
    'up'   → price is above Supertrend → bullish
    'down' → price is below Supertrend → bearish
    """
    _, h, l, c, _ = _arrays(candles)
    n = len(c)
    if n < period + 2:
        return {"direction": None, "prev_direction": None, "flipped": False, "value": None}

    # ATR (Wilder)
    tr = np.zeros(n)
    tr[0] = h[0] - l[0]
    for i in range(1, n):
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    atr = _wilder_ema(tr, period)

    # Basic bands
    hl2 = (h + l) / 2
    basic_upper = hl2 + multiplier * atr
    basic_lower = hl2 - multiplier * atr

    final_upper = np.zeros(n)
    final_lower = np.zeros(n)
    trend = np.zeros(n, dtype=int)  # 1 = up (bullish), -1 = down (bearish)

    final_upper[0] = basic_upper[0]
    final_lower[0] = basic_lower[0]
    trend[0] = 1

    for i in range(1, n):
        # Upper band
        final_upper[i] = basic_upper[i] if (
            basic_upper[i] < final_upper[i - 1] or c[i - 1] > final_upper[i - 1]
        ) else final_upper[i - 1]

        # Lower band
        final_lower[i] = basic_lower[i] if (
            basic_lower[i] > final_lower[i - 1] or c[i - 1] < final_lower[i - 1]
        ) else final_lower[i - 1]

        # Trend direction
        if trend[i - 1] == -1 and c[i] > final_upper[i]:
            trend[i] = 1
        elif trend[i - 1] == 1 and c[i] < final_lower[i]:
            trend[i] = -1
        else:
            trend[i] = trend[i - 1]

    cur_dir = "up" if trend[-1] == 1 else "down"
    prev_dir = "up" if trend[-2] == 1 else "down"
    flipped = cur_dir != prev_dir
    st_value = round(float(final_lower[-1]) if trend[-1] == 1 else float(final_upper[-1]), 2)

    return {
        "direction": cur_dir,
        "prev_direction": prev_dir,
        "flipped": flipped,
        "value": st_value,
    }


def compute_macd(
    candles: List[Dict], fast: int = 12, slow: int = 26, signal: int = 9
) -> Dict[str, Any]:
    """Returns MACD line, signal line, histogram + crossover flag."""
    _, _, _, closes, _ = _arrays(candles)
    if len(closes) < slow + signal:
        return {"macd": None, "signal": None, "histogram": None, "crossover": None}

    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    macd_line = ema_fast - ema_slow

    sig_line = _ema(macd_line[slow - 1:], signal)
    full_sig = np.zeros(len(closes))
    full_sig[slow - 1 + signal - 1:] = sig_line[signal - 1:]

    hist = macd_line - full_sig

    cur_macd = round(float(macd_line[-1]), 4)
    cur_sig  = round(float(full_sig[-1]), 4)
    cur_hist = round(float(hist[-1]), 4)

    # Crossover: bullish if macd crossed above signal this bar
    prev_macd = float(macd_line[-2]) if len(macd_line) >= 2 else None
    prev_sig  = float(full_sig[-2])  if len(full_sig)  >= 2 else None
    crossover = None
    if prev_macd is not None and prev_sig is not None:
        if prev_macd <= prev_sig and cur_macd > cur_sig:
            crossover = "bullish"
        elif prev_macd >= prev_sig and cur_macd < cur_sig:
            crossover = "bearish"

    return {
        "macd": cur_macd,
        "signal": cur_sig,
        "histogram": cur_hist,
        "crossover": crossover,
    }


def compute_vwap(candles: List[Dict]) -> Dict[str, Any]:
    """Intraday VWAP — cumulative from first bar of the day."""
    _, h, l, c, v = _arrays(candles)
    typical = (h + l + c) / 3
    cum_vol = np.cumsum(v)
    with np.errstate(divide="ignore", invalid="ignore"):
        vwap_vals = np.where(cum_vol == 0, typical, np.cumsum(typical * v) / cum_vol)
    return {"value": round(float(vwap_vals[-1]), 2)}


def compute_ma(candles: List[Dict], period: int = 20, kind: str = "sma") -> Dict[str, Any]:
    """SMA or EMA of closes."""
    _, _, _, closes, _ = _arrays(candles)
    if len(closes) < period:
        return {"value": None}
    if kind == "ema":
        vals = _ema(closes, period)
    else:
        vals = np.convolve(closes, np.ones(period) / period, mode="valid")
        # Pad to match length
        pad = np.full(period - 1, np.nan)
        vals = np.concatenate([pad, vals])
    return {"value": round(float(vals[-1]), 2) if not np.isnan(vals[-1]) else None}


def compute_adx(candles: List[Dict], period: int = 14) -> Dict[str, Any]:
    """Average Directional Index."""
    _, h, l, c, _ = _arrays(candles)
    n = len(c)
    if n < period * 2:
        return {"value": None}

    tr = np.zeros(n)
    dm_plus = np.zeros(n)
    dm_minus = np.zeros(n)

    for i in range(1, n):
        h_diff = h[i] - h[i - 1]
        l_diff = l[i - 1] - l[i]
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
        dm_plus[i]  = h_diff if h_diff > l_diff and h_diff > 0 else 0
        dm_minus[i] = l_diff if l_diff > h_diff and l_diff > 0 else 0

    atr_w   = _wilder_ema(tr[1:], period)
    dmp_w   = _wilder_ema(dm_plus[1:], period)
    dmn_w   = _wilder_ema(dm_minus[1:], period)

    with np.errstate(divide="ignore", invalid="ignore"):
        di_plus  = np.where(atr_w == 0, 0, 100 * dmp_w / atr_w)
        di_minus = np.where(atr_w == 0, 0, 100 * dmn_w / atr_w)
        dx = np.where((di_plus + di_minus) == 0, 0,
                      100 * np.abs(di_plus - di_minus) / (di_plus + di_minus))

    adx_vals = _wilder_ema(dx, period)
    return {"value": round(float(adx_vals[-1]), 2)}


def compute_bb(candles: List[Dict], period: int = 20, mult: float = 2.0) -> Dict[str, Any]:
    """Bollinger Bands — returns upper, middle, lower, and %b."""
    _, _, _, closes, _ = _arrays(candles)
    if len(closes) < period:
        return {"upper": None, "middle": None, "lower": None, "pct_b": None}

    mid = np.convolve(closes, np.ones(period) / period, mode="valid")
    std = np.array([np.std(closes[i:i + period]) for i in range(len(closes) - period + 1)])

    upper = mid + mult * std
    lower = mid - mult * std
    cur_close = closes[-1]
    pct_b = (cur_close - lower[-1]) / (upper[-1] - lower[-1]) if (upper[-1] - lower[-1]) != 0 else 0.5

    return {
        "upper":  round(float(upper[-1]), 2),
        "middle": round(float(mid[-1]), 2),
        "lower":  round(float(lower[-1]), 2),
        "pct_b":  round(float(pct_b), 4),
    }


def compute_price_change(candles: List[Dict], bars: int = 1) -> Dict[str, Any]:
    """% price change over the last N bars."""
    if len(candles) < bars + 1:
        return {"pct": None, "abs": None}
    cur = candles[-1]["c"]
    ref = candles[-(bars + 1)]["c"]
    if ref == 0:
        return {"pct": None, "abs": None}
    return {
        "pct": round((cur - ref) / ref * 100, 4),
        "abs": round(cur - ref, 4),
    }


def compute_volume_ratio(candles: List[Dict], lookback: int = 20) -> Dict[str, Any]:
    """Current bar volume vs average volume over last N bars."""
    if len(candles) < 2:
        return {"ratio": None, "current": None, "avg": None}
    cur_vol = candles[-1]["v"]
    history = candles[-(lookback + 1):-1]
    if not history:
        return {"ratio": None, "current": int(cur_vol), "avg": None}
    avg_vol = np.mean([c["v"] for c in history])
    ratio = round(cur_vol / avg_vol, 2) if avg_vol > 0 else None
    return {"ratio": ratio, "current": int(cur_vol), "avg": round(float(avg_vol), 0)}


def compute_all_indicators(candles: List[Dict]) -> Dict[str, Any]:
    """Compute all indicators for a symbol's candle list. Used by the condition evaluator."""
    if not candles or len(candles) < 5:
        return {}
    return {
        "rsi":          compute_rsi(candles),
        "supertrend":   compute_supertrend(candles),
        "macd":         compute_macd(candles),
        "vwap":         compute_vwap(candles),
        "sma20":        compute_ma(candles, 20, "sma"),
        "sma50":        compute_ma(candles, 50, "sma"),
        "ema20":        compute_ma(candles, 20, "ema"),
        "ema50":        compute_ma(candles, 50, "ema"),
        "adx":          compute_adx(candles),
        "bb":           compute_bb(candles),
        "price_change_1bar":  compute_price_change(candles, 1),
        "price_change_3bar":  compute_price_change(candles, 3),
        "price_change_6bar":  compute_price_change(candles, 6),
        "price_change_12bar": compute_price_change(candles, 12),
        "volume_ratio": compute_volume_ratio(candles),
        "ltp":   candles[-1]["c"],
        "open":  candles[0]["c"],   # first bar of the day (approx)
        "high":  max(c["h"] for c in candles),
        "low":   min(c["l"] for c in candles),
        "volume": candles[-1]["v"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# CONDITION EVALUATOR
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_indicator_value(indicators: Dict[str, Any], condition: Dict[str, Any]) -> Optional[float]:
    """
    Extract the relevant numeric value from indicators dict based on condition indicator name.
    Returns None if the value is not available.
    """
    ind = condition.get("indicator", "").lower()
    op  = condition.get("op", "").lower()

    # RSI
    if ind == "rsi":
        return indicators.get("rsi", {}).get("value")

    # Supertrend
    if ind == "supertrend":
        st = indicators.get("supertrend", {})
        if op in ("flips_to_buy", "flips_to_sell"):
            return 1.0 if st.get("flipped") else 0.0
        # numeric: return 1 if up, 0 if down
        return 1.0 if st.get("direction") == "up" else 0.0

    # MACD
    if ind == "macd":
        m = indicators.get("macd", {})
        if op in ("bullish_crossover", "bearish_crossover"):
            cross = m.get("crossover")
            if op == "bullish_crossover":
                return 1.0 if cross == "bullish" else 0.0
            return 1.0 if cross == "bearish" else 0.0
        return m.get("macd")

    if ind == "macd_histogram":
        return indicators.get("macd", {}).get("histogram")

    # VWAP
    if ind == "vwap":
        # Return current price relative to vwap as a special case
        vwap = indicators.get("vwap", {}).get("value")
        ltp  = indicators.get("ltp")
        if vwap and ltp:
            return ltp - vwap   # positive → above VWAP, negative → below
        return None

    # Moving Averages
    if ind == "sma20": return indicators.get("sma20", {}).get("value")
    if ind == "sma50": return indicators.get("sma50", {}).get("value")
    if ind == "ema20": return indicators.get("ema20", {}).get("value")
    if ind == "ema50": return indicators.get("ema50", {}).get("value")

    # ADX
    if ind == "adx": return indicators.get("adx", {}).get("value")

    # Bollinger %b
    if ind in ("bb", "bollinger", "bb_pctb"):
        return indicators.get("bb", {}).get("pct_b")

    # % Price change — value field in condition specifies timeframe:
    # "1bar"/"3bar"/"6bar"/"12bar" via condition's "bars" sub-field
    if ind in ("price_change", "pct_change", "change_pct"):
        bars = condition.get("bars", 1)
        key  = f"price_change_{bars}bar"
        return indicators.get(key, indicators.get("price_change_1bar", {})).get("pct")

    # Volume ratio
    if ind in ("volume", "volume_ratio"):
        return indicators.get("volume_ratio", {}).get("ratio")

    # LTP / price
    if ind in ("ltp", "price"):
        return indicators.get("ltp")

    return None


def _get_display_value(indicators: Dict[str, Any], condition: Dict[str, Any]) -> str:
    """Human-readable triggering value for the results table."""
    ind = condition.get("indicator", "").lower()
    op  = condition.get("op", "").lower()

    if ind == "rsi":
        v = indicators.get("rsi", {}).get("value")
        return f"RSI {round(v, 1)}" if v is not None else "RSI N/A"

    if ind == "supertrend":
        st = indicators.get("supertrend", {})
        d = st.get("direction", "?")
        return f"ST {d.upper()} {'(FLIP)' if st.get('flipped') else ''}"

    if ind == "macd":
        m = indicators.get("macd", {})
        if m.get("crossover"):
            return f"MACD {m['crossover'].upper()} X"
        v = m.get("macd")
        return f"MACD {round(v, 4)}" if v is not None else "MACD N/A"

    if ind in ("price_change", "pct_change", "change_pct"):
        bars = condition.get("bars", 1)
        key  = f"price_change_{bars}bar"
        v    = indicators.get(key, indicators.get("price_change_1bar", {})).get("pct")
        return f"Δ {round(v, 2)}%" if v is not None else "Δ N/A"

    if ind in ("volume", "volume_ratio"):
        r = indicators.get("volume_ratio", {}).get("ratio")
        return f"Vol {round(r, 1)}x" if r is not None else "Vol N/A"

    if ind == "adx":
        v = indicators.get("adx", {}).get("value")
        return f"ADX {round(v, 1)}" if v is not None else "ADX N/A"

    if ind in ("bb", "bollinger", "bb_pctb"):
        v = indicators.get("bb", {}).get("pct_b")
        return f"BB%b {round(v * 100, 1)}%" if v is not None else "BB N/A"

    val = _resolve_indicator_value(indicators, condition)
    return f"{round(val, 2)}" if val is not None else "N/A"


def _evaluate_condition(
    indicators: Dict[str, Any],
    condition: Dict[str, Any],
) -> bool:
    """Evaluate a single condition against pre-computed indicators. Returns True if matched."""
    op    = condition.get("op", "").lower()
    value = condition.get("value")

    # Special event-based operators (return True/False directly from indicator flags)
    if op in ("flips_to_buy",):
        st = indicators.get("supertrend", {})
        return bool(st.get("flipped") and st.get("direction") == "up")

    if op in ("flips_to_sell",):
        st = indicators.get("supertrend", {})
        return bool(st.get("flipped") and st.get("direction") == "down")

    if op == "bullish_crossover":
        return indicators.get("macd", {}).get("crossover") == "bullish"

    if op == "bearish_crossover":
        return indicators.get("macd", {}).get("crossover") == "bearish"

    if op == "above_vwap":
        vwap = indicators.get("vwap", {}).get("value")
        ltp  = indicators.get("ltp")
        return bool(vwap and ltp and ltp > vwap)

    if op == "below_vwap":
        vwap = indicators.get("vwap", {}).get("value")
        ltp  = indicators.get("ltp")
        return bool(vwap and ltp and ltp < vwap)

    # Numeric comparisons
    ind_val = _resolve_indicator_value(indicators, condition)
    if ind_val is None or value is None:
        return False

    try:
        threshold = float(value)
    except (ValueError, TypeError):
        return False

    if op in ("gt", ">"):   return ind_val > threshold
    if op in ("lt", "<"):   return ind_val < threshold
    if op in ("gte", ">="): return ind_val >= threshold
    if op in ("lte", "<="): return ind_val <= threshold
    if op in ("eq", "=="):  return abs(ind_val - threshold) < 0.0001

    # RSI-specific shorthand crossovers
    if op == "crosses_above":
        rsi_data = indicators.get("rsi", {})
        prev = rsi_data.get("prev")
        cur  = rsi_data.get("value")
        if prev is not None and cur is not None:
            return prev < threshold <= cur
        return False

    if op == "crosses_below":
        rsi_data = indicators.get("rsi", {})
        prev = rsi_data.get("prev")
        cur  = rsi_data.get("value")
        if prev is not None and cur is not None:
            return prev > threshold >= cur
        return False

    # MACD line crosses its signal line
    if op == "macd_crosses_above":
        m = indicators.get("macd", {})
        return m.get("crossover") == "bullish"

    if op == "macd_crosses_below":
        m = indicators.get("macd", {})
        return m.get("crossover") == "bearish"

    return False


def evaluate_query(
    query: Dict[str, Any],
    universe_ohlcv: Dict[str, Optional[List[Dict]]],
) -> List[Dict[str, Any]]:
    """
    Evaluate a screener query against pre-fetched OHLCV data.

    query schema:
    {
        "universe":   "nifty50",
        "timeframe":  "5m",
        "conditions": [
            {"indicator": "rsi", "op": "gt", "value": 70},
            {"indicator": "supertrend", "op": "flips_to_buy"}
        ],
        "logic": "AND"   # "AND" or "OR"
    }

    Returns list of match dicts with symbol, ltp, pct_change, signal_value, etc.
    """
    conditions = query.get("conditions", [])
    logic      = query.get("logic", "AND").upper()
    matches    = []

    for symbol, candles in universe_ohlcv.items():
        if not candles or len(candles) < 5:
            continue

        indicators = compute_all_indicators(candles)

        if not conditions:
            # No conditions → return all symbols (useful for universe listing)
            continue

        results = [_evaluate_condition(indicators, cond) for cond in conditions]

        matched = all(results) if logic == "AND" else any(results)

        if matched:
            # Find the first triggering condition for display
            triggering_idx = next((i for i, r in enumerate(results) if r), 0)
            triggering_cond = conditions[triggering_idx]
            signal_value = _get_display_value(indicators, triggering_cond)

            # % change from prev close using first bar as proxy for open
            ltp     = indicators.get("ltp", 0)
            day_open = candles[0]["c"] if candles else ltp
            change_pct = round((ltp - day_open) / day_open * 100, 2) if day_open else 0

            matches.append({
                "symbol":        symbol,
                "ltp":           round(ltp, 2),
                "change_pct":    change_pct,
                "signal_value":  signal_value,
                "signal_time":   candles[-1]["t"] if candles else None,
                "volume":        candles[-1]["v"] if candles else 0,
                "indicators":    {
                    "rsi":           indicators.get("rsi", {}).get("value"),
                    "supertrend":    indicators.get("supertrend", {}).get("direction"),
                    "macd":          indicators.get("macd", {}).get("macd"),
                    "macd_hist":     indicators.get("macd", {}).get("histogram"),
                    "vwap":          indicators.get("vwap", {}).get("value"),
                    "adx":           indicators.get("adx", {}).get("value"),
                    "volume_ratio":  indicators.get("volume_ratio", {}).get("ratio"),
                },
                "sparkline":     [c["c"] for c in candles[-24:]],   # last 2h of 5m bars
            })

    # Sort by absolute % change (biggest movers first)
    matches.sort(key=lambda x: abs(x.get("change_pct", 0)), reverse=True)
    return matches


# ─────────────────────────────────────────────────────────────────────────────
# PRESET SCANS
# ─────────────────────────────────────────────────────────────────────────────

PRESETS = [
    {
        "id": "rsi_overbought_n50",
        "name": "RSI Overbought",
        "description": "RSI above 70 — potentially over-extended, watch for reversal",
        "emoji": "🔴",
        "query": {
            "universe": "nifty50",
            "timeframe": "5m",
            "conditions": [{"indicator": "rsi", "op": "gt", "value": 70}],
            "logic": "AND",
        },
    },
    {
        "id": "rsi_oversold_n50",
        "name": "RSI Oversold",
        "description": "RSI below 30 — potential bounce candidates in Nifty 50",
        "emoji": "🟢",
        "query": {
            "universe": "nifty50",
            "timeframe": "5m",
            "conditions": [{"indicator": "rsi", "op": "lt", "value": 30}],
            "logic": "AND",
        },
    },
    {
        "id": "supertrend_buy_flip",
        "name": "Supertrend Buy Flip",
        "description": "Supertrend just flipped bullish — trend reversal signal",
        "emoji": "📈",
        "query": {
            "universe": "nifty50",
            "timeframe": "15m",
            "conditions": [{"indicator": "supertrend", "op": "flips_to_buy"}],
            "logic": "AND",
        },
    },
    {
        "id": "supertrend_sell_flip",
        "name": "Supertrend Sell Flip",
        "description": "Supertrend just flipped bearish — trend reversal to downside",
        "emoji": "📉",
        "query": {
            "universe": "nifty50",
            "timeframe": "15m",
            "conditions": [{"indicator": "supertrend", "op": "flips_to_sell"}],
            "logic": "AND",
        },
    },
    {
        "id": "gainers_5min",
        "name": "5-min Gainers >1%",
        "description": "Strong momentum: up more than 1% in the last 5-min bar",
        "emoji": "⚡",
        "query": {
            "universe": "nifty50",
            "timeframe": "5m",
            "conditions": [{"indicator": "price_change", "op": "gt", "value": 1, "bars": 1}],
            "logic": "AND",
        },
    },
    {
        "id": "volume_spike_2x",
        "name": "Volume Spike 2×",
        "description": "Current volume is more than 2× the 20-bar average",
        "emoji": "📊",
        "query": {
            "universe": "nifty50",
            "timeframe": "5m",
            "conditions": [{"indicator": "volume", "op": "gt", "value": 2}],
            "logic": "AND",
        },
    },
    {
        "id": "macd_bullish_cross",
        "name": "MACD Bullish Cross",
        "description": "MACD line just crossed above signal — bullish momentum shift",
        "emoji": "🎯",
        "query": {
            "universe": "nifty50",
            "timeframe": "15m",
            "conditions": [{"indicator": "macd", "op": "bullish_crossover"}],
            "logic": "AND",
        },
    },
    {
        "id": "rsi_oversold_vwap",
        "name": "Oversold + Above VWAP",
        "description": "RSI < 35 AND price above VWAP — oversold bounce within intraday trend",
        "emoji": "💡",
        "query": {
            "universe": "nifty50",
            "timeframe": "5m",
            "conditions": [
                {"indicator": "rsi", "op": "lt", "value": 35},
                {"indicator": "vwap", "op": "above_vwap"},
            ],
            "logic": "AND",
        },
    },
    {
        "id": "strong_trend_adx",
        "name": "Strong Trend (ADX>25)",
        "description": "ADX above 25 — trending market, not ranging",
        "emoji": "🔥",
        "query": {
            "universe": "nifty50",
            "timeframe": "15m",
            "conditions": [{"indicator": "adx", "op": "gt", "value": 25}],
            "logic": "AND",
        },
    },
    {
        "id": "banknifty_volume_spike",
        "name": "BankNifty Volume Spike",
        "description": "Bank Nifty stocks with 2× average volume",
        "emoji": "🏦",
        "query": {
            "universe": "banknifty",
            "timeframe": "5m",
            "conditions": [{"indicator": "volume", "op": "gt", "value": 2}],
            "logic": "AND",
        },
    },
    {
        "id": "it_rsi_oversold",
        "name": "Nifty IT Oversold",
        "description": "IT sector stocks with RSI below 35",
        "emoji": "💻",
        "query": {
            "universe": "niftyit",
            "timeframe": "15m",
            "conditions": [{"indicator": "rsi", "op": "lt", "value": 35}],
            "logic": "AND",
        },
    },
]
