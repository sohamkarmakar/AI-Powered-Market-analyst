from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional, List
import uvicorn
import asyncio

from app.config import settings
from app.services.yfinance_service import YFinanceService, normalize_symbol
from app.services.supabase_service import supabase_service
from app.services.indicators_service import IndicatorsService
from app.services.gemini_service import gemini_service

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────

@app.get("/health")
def health_check() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "supabase_connected": supabase_service.is_configured
    }

# ─────────────────────────────────────────────
# LIVE QUOTE — Single symbol, full data
# ─────────────────────────────────────────────

@app.get("/api/ticker/{symbol}/quote")
def get_live_quote(symbol: str) -> Dict[str, Any]:
    """
    Full live quote for a single symbol. Returns price, OHLC, volume,
    52W high/low, fundamentals, sector, market state — all from Yahoo Finance.
    Uses fast_info for price-critical fields + .info for fundamentals.
    """
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol_upper)
        fi = ticker.fast_info
        info = {}
        try:
            info = ticker.info or {}
        except Exception:
            pass

        price      = getattr(fi, "last_price", None)
        prev_close = getattr(fi, "previous_close", None)
        open_      = getattr(fi, "open", None) or info.get("open") or info.get("regularMarketOpen")
        day_high   = getattr(fi, "day_high", None)
        day_low    = getattr(fi, "day_low", None)
        year_high  = getattr(fi, "year_high", None)
        year_low   = getattr(fi, "year_low", None)
        volume     = getattr(fi, "last_volume", None)
        market_cap = getattr(fi, "market_cap", None)

        change = None
        change_pct = None
        if price is not None and prev_close and prev_close != 0:
            change = round(price - prev_close, 2)
            change_pct = round((change / prev_close) * 100, 2)

        def _f(v):
            return round(float(v), 2) if v is not None else None

        return {
            "symbol":           symbol_upper,
            "name":             info.get("longName") or info.get("shortName") or symbol_upper,
            "sector":           info.get("sector", "N/A"),
            "industry":         info.get("industry", "N/A"),
            "exchange":         info.get("exchange") or getattr(fi, "exchange", "NSE"),
            "market_state":     info.get("marketState", "REGULAR"),
            "currency":         info.get("currency", "INR"),
            # Price
            "price":            _f(price),
            "open":             _f(open_),
            "prev_close":       _f(prev_close),
            "change":           change,
            "change_pct":       change_pct,
            "day_high":         _f(day_high),
            "day_low":          _f(day_low),
            "year_high":        _f(year_high),
            "year_low":         _f(year_low),
            # Volume
            "volume":           int(volume) if volume is not None else None,
            "avg_volume":       info.get("averageVolume") or info.get("averageDailyVolume10Day"),
            "avg_volume_3m":    info.get("averageVolume3Month"),
            # Fundamentals
            "market_cap":       int(market_cap) if market_cap is not None else info.get("marketCap"),
            "pe_ratio":         info.get("trailingPE"),
            "forward_pe":       info.get("forwardPE"),
            "peg_ratio":        info.get("pegRatio"),
            "beta":             info.get("beta"),
            "eps":              info.get("trailingEps"),
            "book_value":       info.get("bookValue"),
            "price_to_book":    info.get("priceToBook"),
            "dividend_yield":   info.get("dividendYield"),
            "dividend_rate":    info.get("dividendRate"),
            "ex_dividend_date": info.get("exDividendDate"),
            "roe":              info.get("returnOnEquity"),
            "revenue_growth":   info.get("revenueGrowth"),
            "earnings_growth":  info.get("earningsGrowth"),
            "debt_to_equity":   info.get("debtToEquity"),
            "current_ratio":    info.get("currentRatio"),
            "profit_margins":   info.get("profitMargins"),
            "gross_margins":    info.get("grossMargins"),
            "float_shares":     info.get("floatShares"),
            "shares_short":     info.get("sharesShort"),
            "short_ratio":      info.get("shortRatio"),
            "target_high":      info.get("targetHighPrice"),
            "target_low":       info.get("targetLowPrice"),
            "target_mean":      info.get("targetMeanPrice"),
            "recommendation":   info.get("recommendationKey"),
            "analyst_count":    info.get("numberOfAnalystOpinions"),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────
# BATCH QUOTES — Multiple symbols in one call
# ─────────────────────────────────────────────

@app.get("/api/quotes/batch")
def get_batch_quotes(symbols: str = Query(..., description="Comma-separated symbols, e.g. RELIANCE,TCS,INFY")) -> Dict[str, Any]:
    """
    Fetch live quotes for multiple Indian symbols in one parallel call.
    Returns a dict keyed by normalized symbol. Use this as the polling endpoint
    for the watchlist terminal — one request refreshes all rows.
    """
    import yfinance as yf
    from concurrent.futures import ThreadPoolExecutor, as_completed

    raw_list = [s.strip() for s in symbols.split(",") if s.strip()]
    normalized = [normalize_symbol(s.upper()) for s in raw_list]

    def fetch_one(sym: str) -> Dict[str, Any]:
        try:
            ticker = yf.Ticker(sym)
            fi = ticker.fast_info

            price      = getattr(fi, "last_price", None)
            prev_close = getattr(fi, "previous_close", None)
            day_high   = getattr(fi, "day_high", None)
            day_low    = getattr(fi, "day_low", None)
            year_high  = getattr(fi, "year_high", None)
            year_low   = getattr(fi, "year_low", None)
            volume     = getattr(fi, "last_volume", None)
            market_cap = getattr(fi, "market_cap", None)

            change = None
            change_pct = None
            if price is not None and prev_close and prev_close != 0:
                change = round(price - prev_close, 2)
                change_pct = round((change / prev_close) * 100, 2)

            def _f(v):
                return round(float(v), 2) if v is not None else None

            # Pull lightweight fundamentals from info only once
            info = {}
            try:
                info = ticker.info or {}
            except Exception:
                pass

            return {
                "symbol":       sym,
                "name":         info.get("longName") or info.get("shortName") or sym,
                "sector":       info.get("sector", "N/A"),
                "market_state": info.get("marketState", "REGULAR"),
                "price":        _f(price),
                "open":         _f(getattr(fi, "open", None) or info.get("regularMarketOpen")),
                "prev_close":   _f(prev_close),
                "change":       change,
                "change_pct":   change_pct,
                "day_high":     _f(day_high),
                "day_low":      _f(day_low),
                "year_high":    _f(year_high),
                "year_low":     _f(year_low),
                "volume":       int(volume) if volume is not None else None,
                "avg_volume":   info.get("averageVolume") or info.get("averageDailyVolume10Day"),
                "market_cap":   int(market_cap) if market_cap is not None else info.get("marketCap"),
                "pe_ratio":     info.get("trailingPE"),
                "forward_pe":   info.get("forwardPE"),
                "beta":         info.get("beta"),
                "eps":          info.get("trailingEps"),
                "book_value":   info.get("bookValue"),
                "dividend_yield": info.get("dividendYield"),
                "roe":          info.get("returnOnEquity"),
                "profit_margins": info.get("profitMargins"),
                "debt_to_equity": info.get("debtToEquity"),
                "target_mean":  info.get("targetMeanPrice"),
                "recommendation": info.get("recommendationKey"),
            }
        except Exception as ex:
            return {"symbol": sym, "error": str(ex)}

    results = {}
    with ThreadPoolExecutor(max_workers=min(len(normalized), 10)) as executor:
        future_to_sym = {executor.submit(fetch_one, sym): sym for sym in normalized}
        for future in as_completed(future_to_sym):
            sym = future_to_sym[future]
            try:
                results[sym] = future.result()
            except Exception as ex:
                results[sym] = {"symbol": sym, "error": str(ex)}

    return {"quotes": results, "count": len(results)}


# ─────────────────────────────────────────────
# INTRADAY — 5-min candles for sparkline chart
# ─────────────────────────────────────────────

@app.get("/api/ticker/{symbol}/intraday")
def get_intraday(symbol: str, period: str = "5d") -> Dict[str, Any]:
    """
    Returns 5-minute OHLCV candles for the given symbol.
    Used for the intraday sparkline chart in the watchlist detail panel.
    period: 1d, 5d (default)
    """
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        import pandas as pd
        ticker = yf.Ticker(symbol_upper)
        df = ticker.history(period=period, interval="5m")
        if df.empty:
            return {"symbol": symbol_upper, "candles": []}
        df = df.reset_index()
        candles = []
        for _, row in df.iterrows():
            dt = row.get("Datetime") or row.get("Date")
            if dt is None:
                continue
            if hasattr(dt, "to_pydatetime"):
                ts = dt.to_pydatetime().isoformat()
            else:
                ts = str(dt)
            candles.append({
                "t":  ts,
                "o":  round(float(row["Open"]), 2),
                "h":  round(float(row["High"]), 2),
                "l":  round(float(row["Low"]), 2),
                "c":  round(float(row["Close"]), 2),
                "v":  int(row["Volume"]),
            })
        return {"symbol": symbol_upper, "candles": candles}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────
# INDICES — NIFTY 50, SENSEX, BANK NIFTY strip
# ─────────────────────────────────────────────

@app.get("/api/indices")
def get_indices() -> Dict[str, Any]:
    """
    Returns live quotes for major Indian indices for the top bar strip.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import yfinance as yf

    index_map = {
        "NIFTY 50":   "^NSEI",
        "SENSEX":     "^BSESN",
        "BANK NIFTY": "^NSEBANK",
        "NIFTY IT":   "^CNXIT",
    }

    def fetch_index(label: str, sym: str) -> Dict[str, Any]:
        try:
            t = yf.Ticker(sym)
            fi = t.fast_info
            price = getattr(fi, "last_price", None)
            prev  = getattr(fi, "previous_close", None)
            change = round(price - prev, 2) if price and prev else None
            change_pct = round((change / prev) * 100, 2) if change and prev else None
            return {
                "label": label,
                "symbol": sym,
                "price": round(float(price), 2) if price else None,
                "change": change,
                "change_pct": change_pct,
            }
        except Exception as ex:
            return {"label": label, "symbol": sym, "error": str(ex)}

    results = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_index, lbl, sym): lbl for lbl, sym in index_map.items()}
        done = {}
        for future in as_completed(futures):
            res = future.result()
            done[res["label"]] = res
    # Return in original order
    for lbl in index_map:
        results.append(done.get(lbl, {"label": lbl, "symbol": index_map[lbl]}))

    return {"indices": results}


# ─────────────────────────────────────────────
# EXISTING ENDPOINTS (unchanged)
# ─────────────────────────────────────────────

@app.get("/api/ticker/{symbol}")
def get_ticker_data(symbol: str, period: str = "1y", interval: str = "1d") -> Dict[str, Any]:
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        info    = YFinanceService.get_ticker_info(symbol_upper)
        history = YFinanceService.get_ohlcv(symbol_upper, period=period, interval=interval)
        news    = YFinanceService.get_news(symbol_upper)
        return {"symbol": symbol_upper, "info": info, "price_history": history, "news": news}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/ticker/{symbol}/sync")
def sync_ticker_to_db(symbol: str, period: str = "1y") -> Dict[str, Any]:
    if not supabase_service.is_configured:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        info    = YFinanceService.get_ticker_info(symbol_upper)
        history = YFinanceService.get_ohlcv(symbol_upper, period=period)
        news    = YFinanceService.get_news(symbol_upper)
        upserted_info    = supabase_service.upsert_ticker(info)
        upserted_history = supabase_service.upsert_price_history(symbol_upper, history)
        upserted_news    = supabase_service.upsert_news(symbol_upper, news)
        return {
            "status": "success",
            "message": f"Synced {symbol_upper}",
            "records": {"ticker": upserted_info, "price_history_count": len(upserted_history), "news_count": len(upserted_news)}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/db/ticker/{symbol}")
def get_db_ticker_data(symbol: str) -> Dict[str, Any]:
    if not supabase_service.is_configured:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        data = supabase_service.get_ticker_with_data(symbol_upper)
        if not data or not data.get("ticker"):
            raise HTTPException(status_code=404, detail=f"{symbol_upper} not in database.")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ticker/{symbol}/indicators")
def get_technical_indicators(symbol: str, period: str = "1y") -> Dict[str, Any]:
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        history    = YFinanceService.get_ohlcv(symbol_upper, period=period)
        indicators = IndicatorsService.calculate_technical_indicators(history)
        orb_signal = IndicatorsService.get_orb_signal(symbol_upper)
        return {"symbol": symbol_upper, "indicators": indicators, "orb_signal": orb_signal}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/ticker/{symbol}/analysis")
def get_cached_analysis(symbol: str) -> Dict[str, Any]:
    if not supabase_service.is_configured:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        analysis = supabase_service.get_ticker_analysis(symbol_upper)
        if not analysis:
            raise HTTPException(status_code=404, detail=f"No analysis for {symbol_upper}.")
        return analysis
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/market/pulse")
def get_market_pulse() -> Dict[str, Any]:
    if not supabase_service.is_configured:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    try:
        pulse = supabase_service.get_latest_market_pulse()
        if not pulse:
            raise HTTPException(status_code=404, detail="No market pulse yet.")
        return pulse
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ticker/{symbol}/analysis/generate")
def generate_and_cache_analysis(symbol: str) -> Dict[str, Any]:
    symbol_upper = normalize_symbol(symbol.upper())
    try:
        info          = YFinanceService.get_ticker_info(symbol_upper)
        price_history = YFinanceService.get_ohlcv(symbol_upper, period="3mo")
        news          = YFinanceService.get_news(symbol_upper)
        news_summary  = gemini_service.summarize_news(symbol_upper, news)
        research_note = gemini_service.generate_research_note(info, price_history, news_summary)
        if supabase_service.is_configured:
            supabase_service.upsert_ticker(info)
            supabase_service.upsert_ticker_analysis(symbol_upper, news_summary, research_note)
        return {"symbol": symbol_upper, "news_summary": news_summary, "research_note": research_note}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tickers")
def get_all_tracked_tickers() -> Dict[str, Any]:
    if not supabase_service.is_configured:
        return {"status": "success", "tickers": []}
    try:
        tickers = supabase_service.get_all_tickers()
        return {"status": "success", "tickers": tickers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
def search_tickers(q: str = Query(...)) -> Dict[str, Any]:
    try:
        results = YFinanceService.search_symbols(q)
        return {"status": "success", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
