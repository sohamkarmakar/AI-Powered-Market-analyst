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
        import yfinance as yf
        info    = YFinanceService.get_ticker_info(symbol_upper)
        history = YFinanceService.get_ohlcv(symbol_upper, period=period, interval=interval)
        news    = YFinanceService.get_news(symbol_upper)

        # ── Enrich info with live fast_info fields ─────────────────────────
        try:
            t  = yf.Ticker(symbol_upper)
            fi = t.fast_info
            raw_info = t.info or {}

            def _f(v):
                try:
                    f = float(v)
                    return None if (f != f) else round(f, 2)
                except Exception:
                    return None

            price     = getattr(fi, "last_price", None)
            prev      = getattr(fi, "previous_close", None) or raw_info.get("previousClose")
            chg       = round(float(price) - float(prev), 2) if price and prev else None
            chg_pct   = round(chg / float(prev) * 100, 2)    if chg  and prev else None

            info.update({
                "current_price":  _f(price),
                "open":           _f(getattr(fi, "open", None)) or _f(raw_info.get("open")),
                "prev_close":     _f(prev),
                "change":         chg,
                "change_pct":     chg_pct,
                "day_high":       _f(getattr(fi, "day_high", None)),
                "day_low":        _f(getattr(fi, "day_low",  None)),
                "year_high":      _f(getattr(fi, "year_high", None)),
                "year_low":       _f(getattr(fi, "year_low",  None)),
                "volume":         int(getattr(fi, "last_volume", 0) or 0) or None,
                "avg_volume":     raw_info.get("averageVolume") or raw_info.get("averageDailyVolume10Day"),
                "market_cap":     info.get("market_cap") or (int(getattr(fi, "market_cap", 0) or 0) or None),
                "beta":           _f(raw_info.get("beta")),
                "market_state":   raw_info.get("marketState", "REGULAR"),
                "fifty_day_avg":  _f(raw_info.get("fiftyDayAverage")),
                "two_hundred_day_avg": _f(raw_info.get("twoHundredDayAverage")),
            })
        except Exception:
            pass  # fast_info enrichment is best-effort

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

# ─────────────────────────────────────────────────────────────────────────────
# FUNDAMENTALS — 30+ valuation, profitability, financial-health metrics
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/ticker/{symbol}/fundamentals")
def get_fundamentals(symbol: str) -> Dict[str, Any]:
    sym = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        t = yf.Ticker(sym)
        fi = t.fast_info
        info = t.info or {}

        def _v(key: str):
            v = info.get(key)
            if v is None or (isinstance(v, float) and (v != v)):  # NaN check
                return None
            return v

        return {
            "symbol": sym,
            "name": info.get("longName") or info.get("shortName") or sym,
            "sector": _v("sector"), "industry": _v("industry"),
            "country": _v("country"), "website": _v("website"),
            "description": _v("longBusinessSummary"),
            "employees": _v("fullTimeEmployees"),
            # Valuation
            "pe_ttm": _v("trailingPE"), "pe_forward": _v("forwardPE"),
            "pb_ratio": _v("priceToBook"), "ps_ratio": _v("priceToSalesTrailing12Months"),
            "peg_ratio": _v("pegRatio"), "ev_ebitda": _v("enterpriseToEbitda"),
            "ev_revenue": _v("enterpriseToRevenue"), "enterprise_value": _v("enterpriseValue"),
            # Per-share
            "eps_ttm": _v("trailingEps"), "eps_forward": _v("forwardEps"),
            "book_value": _v("bookValue"),
            # Dividends
            "dividend_yield": _v("dividendYield"), "dividend_rate": _v("dividendRate"),
            "payout_ratio": _v("payoutRatio"), "five_year_avg_yield": _v("fiveYearAvgDividendYield"),
            # Profitability
            "roe": _v("returnOnEquity"), "roa": _v("returnOnAssets"),
            "gross_margins": _v("grossMargins"), "operating_margins": _v("operatingMargins"),
            "profit_margins": _v("profitMargins"), "ebitda_margins": _v("ebitdaMargins"),
            # Financial health
            "debt_to_equity": _v("debtToEquity"), "current_ratio": _v("currentRatio"),
            "quick_ratio": _v("quickRatio"), "total_debt": _v("totalDebt"),
            "total_cash": _v("totalCash"), "free_cashflow": _v("freeCashflow"),
            "operating_cashflow": _v("operatingCashflow"),
            # Revenue/Growth
            "revenue": _v("totalRevenue"), "revenue_growth": _v("revenueGrowth"),
            "earnings_growth": _v("earningsGrowth"), "ebitda": _v("ebitda"),
            "gross_profit": _v("grossProfits"),
            # Shares
            "shares_outstanding": _v("sharesOutstanding"), "float_shares": _v("floatShares"),
            "short_ratio": _v("shortRatio"),
            # Price reference
            "fifty_two_week_high": _v("fiftyTwoWeekHigh") or getattr(fi, "year_high", None),
            "fifty_two_week_low":  _v("fiftyTwoWeekLow")  or getattr(fi, "year_low",  None),
            "fifty_day_avg": _v("fiftyDayAverage"), "two_hundred_day_avg": _v("twoHundredDayAverage"),
            "beta": _v("beta"),
            "market_cap": _v("marketCap") or getattr(fi, "market_cap", None),
            # Analyst
            "target_high": _v("targetHighPrice"), "target_low": _v("targetLowPrice"),
            "target_mean": _v("targetMeanPrice"), "target_median": _v("targetMedianPrice"),
            "recommendation_key": _v("recommendationKey"),
            "analyst_count": _v("numberOfAnalystOpinions"),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# EARNINGS / FINANCIALS — quarterly & annual financials + EPS history
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/ticker/{symbol}/earnings")
def get_earnings(symbol: str) -> Dict[str, Any]:
    sym = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        import pandas as pd
        t = yf.Ticker(sym)

        def _safe_float(val):
            try:
                f = float(val)
                return None if (f != f) else f   # NaN → None
            except Exception:
                return None

        # Quarterly financials
        quarterly: List[Dict] = []
        try:
            qf = t.quarterly_financials
            if qf is not None and not qf.empty:
                for col in list(qf.columns)[:8]:
                    period_str = col.strftime("%b %Y") if hasattr(col, "strftime") else str(col)
                    def g(row):
                        if row in qf.index:
                            return _safe_float(qf.loc[row, col])
                        return None
                    quarterly.append({
                        "period": period_str,
                        "revenue": g("Total Revenue"),
                        "net_income": g("Net Income"),
                        "gross_profit": g("Gross Profit"),
                        "ebitda": g("EBITDA"),
                        "operating_income": g("Operating Income"),
                    })
        except Exception:
            pass

        # Annual financials
        annual: List[Dict] = []
        try:
            af = t.financials
            if af is not None and not af.empty:
                for col in list(af.columns)[:5]:
                    period_str = col.strftime("%Y") if hasattr(col, "strftime") else str(col)
                    def ga(row):
                        if row in af.index:
                            return _safe_float(af.loc[row, col])
                        return None
                    annual.append({
                        "period": period_str,
                        "revenue": ga("Total Revenue"),
                        "net_income": ga("Net Income"),
                        "gross_profit": ga("Gross Profit"),
                        "ebitda": ga("EBITDA"),
                    })
        except Exception:
            pass

        # EPS surprise history
        eps_history: List[Dict] = []
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for _, row in eh.tail(8).iterrows():
                    eps_history.append({
                        "period": str(row.name)[:10] if hasattr(row, "name") else "",
                        "eps_estimate": _safe_float(row.get("epsEstimate")),
                        "eps_actual": _safe_float(row.get("epsActual")),
                        "surprise_pct": _safe_float(row.get("epsDifference")),
                    })
        except Exception:
            pass

        # Next earnings date
        next_earnings = None
        try:
            cal = t.calendar
            if cal is not None:
                raw = cal.get("Earnings Date") if isinstance(cal, dict) else None
                if raw:
                    vals = list(raw) if hasattr(raw, "__iter__") and not isinstance(raw, str) else [raw]
                    next_earnings = str(vals[0])[:10] if vals else None
        except Exception:
            pass

        return {
            "symbol": sym, "quarterly": quarterly, "annual": annual,
            "eps_history": eps_history, "next_earnings_date": next_earnings,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# HOLDERS — major + institutional shareholders
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/ticker/{symbol}/holders")
def get_holders(symbol: str) -> Dict[str, Any]:
    sym = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        import pandas as pd
        t = yf.Ticker(sym)
        info = t.info or {}

        major: List[Dict] = []
        try:
            mh = t.major_holders
            if mh is not None and not mh.empty:
                for _, row in mh.iterrows():
                    pct_raw = str(row.iloc[0]).replace("%", "").strip()
                    try:
                        pct = float(pct_raw)
                    except Exception:
                        pct = None
                    major.append({"label": str(row.iloc[1]), "pct": pct})
        except Exception:
            pass

        institutional: List[Dict] = []
        try:
            ih = t.institutional_holders
            if ih is not None and not ih.empty:
                for _, row in ih.head(15).iterrows():
                    def _sf(k):
                        v = row.get(k)
                        try:
                            f = float(v)
                            return None if f != f else f
                        except Exception:
                            return None
                    institutional.append({
                        "holder": str(row.get("Holder", "N/A")),
                        "shares": _sf("Shares"),
                        "value": _sf("Value"),
                        "pct_held": _sf("% Out"),
                        "date": str(row.get("Date Reported", ""))[:10] if pd.notna(row.get("Date Reported")) else None,
                    })
        except Exception:
            pass

        return {
            "symbol": sym, "major_holders": major, "institutional_holders": institutional,
            "insider_pct": info.get("heldPercentInsiders"),
            "institution_pct": info.get("heldPercentInstitutions"),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# RECOMMENDATIONS — analyst consensus + individual ratings
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/ticker/{symbol}/recommendations")
def get_recommendations(symbol: str) -> Dict[str, Any]:
    sym = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        t = yf.Ticker(sym)
        info = t.info or {}

        trend = {"strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0}
        # yfinance recommendations DataFrame has columns: period, strongBuy, buy, hold, sell, strongSell
        # (no per-firm data for Indian stocks)
        try:
            rs = t.recommendations
            if rs is not None and not rs.empty:
                row = rs.iloc[0]   # most recent period ("0m")
                trend = {
                    "strong_buy":  int(row["strongBuy"])  if "strongBuy"  in rs.columns else 0,
                    "buy":         int(row["buy"])         if "buy"         in rs.columns else 0,
                    "hold":        int(row["hold"])        if "hold"        in rs.columns else 0,
                    "sell":        int(row["sell"])        if "sell"        in rs.columns else 0,
                    "strong_sell": int(row["strongSell"]) if "strongSell" in rs.columns else 0,
                }
        except Exception:
            pass

        return {
            "symbol": sym, "trend": trend,
            "target_high":   info.get("targetHighPrice"),
            "target_low":    info.get("targetLowPrice"),
            "target_mean":   info.get("targetMeanPrice"),
            "target_median": info.get("targetMedianPrice"),
            "recommendation_key": info.get("recommendationKey"),
            "analyst_count": info.get("numberOfAnalystOpinions"),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# NEWS — recent headlines directly from Yahoo Finance
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/ticker/{symbol}/news")
def get_ticker_news(symbol: str) -> Dict[str, Any]:
    sym = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        t = yf.Ticker(sym)
        raw_news = t.news or []
        articles = []
        for item in raw_news[:20]:
            # yfinance >= 0.2.x uses nested 'content' dict
            content = item.get("content") or {}
            if content:
                # New format
                click_url = content.get("clickThroughUrl") or {}
                provider  = content.get("provider") or {}
                thumb     = content.get("thumbnail") or {}
                resolutions = thumb.get("resolutions") or []
                thumb_url   = resolutions[0].get("url") if resolutions else None
                # pubDate is ISO string e.g. "2025-07-14T10:00:00Z"
                pub_str = content.get("pubDate") or ""
                pub_ts  = 0
                try:
                    from datetime import datetime, timezone
                    pub_ts = int(datetime.fromisoformat(pub_str.replace("Z","+00:00")).timestamp()) if pub_str else 0
                except Exception:
                    pass
                articles.append({
                    "title":        content.get("title", ""),
                    "publisher":    provider.get("displayName") or provider.get("name", ""),
                    "link":         click_url.get("url") or content.get("canonicalUrl", {}).get("url", ""),
                    "published_at": pub_ts,
                    "type":         content.get("contentType", "STORY"),
                    "thumbnail":    thumb_url,
                    "summary":      content.get("summary", ""),
                })
            else:
                # Old format (yfinance < 0.2)
                articles.append({
                    "title":        item.get("title", ""),
                    "publisher":    item.get("publisher", ""),
                    "link":         item.get("link", ""),
                    "published_at": item.get("providerPublishTime", 0),
                    "type":         item.get("type", "STORY"),
                    "thumbnail":    (item.get("thumbnail") or {}).get("resolutions", [{}])[0].get("url") if item.get("thumbnail") else None,
                    "summary":      "",
                })
        return {"symbol": sym, "news": articles}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# PEERS — same-sector peers with key metrics
# ─────────────────────────────────────────────────────────────────────────────
SECTOR_PEERS: Dict[str, List[str]] = {
    "Technology":             ["TCS.NS","INFY.NS","WIPRO.NS","HCLTECH.NS","LTIM.NS","TECHM.NS"],
    "Financial Services":     ["HDFCBANK.NS","ICICIBANK.NS","SBIN.NS","AXISBANK.NS","KOTAKBANK.NS","INDUSINDBK.NS"],
    "Energy":                 ["RELIANCE.NS","ONGC.NS","BPCL.NS","IOC.NS","COALINDIA.NS"],
    "Consumer Defensive":     ["HINDUNILVR.NS","ITC.NS","NESTLEIND.NS","DABUR.NS","MARICO.NS"],
    "Consumer Cyclical":      ["MARUTI.NS","TATAMOTORS.NS","M&M.NS","BAJAJ-AUTO.NS","HEROMOTOCO.NS"],
    "Healthcare":             ["SUNPHARMA.NS","DRREDDY.NS","CIPLA.NS","DIVISLAB.NS","APOLLOHOSP.NS"],
    "Basic Materials":        ["TATASTEEL.NS","JSWSTEEL.NS","HINDALCO.NS","VEDL.NS","SAIL.NS"],
    "Communication Services": ["BHARTIARTL.NS","INDUSTOWER.NS","TATACOMM.NS"],
    "Utilities":              ["NTPC.NS","POWERGRID.NS","TATAPOWER.NS"],
    "Real Estate":            ["DLF.NS","GODREJPROP.NS","PRESTIGE.NS","OBEROIRLTY.NS"],
}

@app.get("/api/ticker/{symbol}/peers")
def get_peers(symbol: str) -> Dict[str, Any]:
    from concurrent.futures import ThreadPoolExecutor, as_completed
    sym = normalize_symbol(symbol.upper())
    try:
        import yfinance as yf
        t = yf.Ticker(sym)
        info = t.info or {}
        sector = info.get("sector", "")

        candidates = [p for p in SECTOR_PEERS.get(sector, []) if p != sym][:5]
        if not candidates:
            return {"symbol": sym, "sector": sector, "peers": []}

        def fetch_peer(s: str) -> Dict[str, Any]:
            try:
                pt = yf.Ticker(s)
                fi = pt.fast_info
                pi = pt.info or {}
                price = getattr(fi, "last_price", None)
                prev  = getattr(fi, "previous_close", None)
                change_pct = round((price - prev) / prev * 100, 2) if price and prev and prev != 0 else None
                return {
                    "symbol": s.replace(".NS","").replace(".BO",""),
                    "name": pi.get("shortName") or s,
                    "price": round(float(price), 2) if price else None,
                    "change_pct": change_pct,
                    "market_cap": getattr(fi, "market_cap", None) or pi.get("marketCap"),
                    "pe_ratio": pi.get("trailingPE"),
                    "pb_ratio": pi.get("priceToBook"),
                    "roe": pi.get("returnOnEquity"),
                    "profit_margin": pi.get("profitMargins"),
                    "revenue": pi.get("totalRevenue"),
                }
            except Exception:
                return {}

        peers_data: List[Dict] = []
        with ThreadPoolExecutor(max_workers=5) as ex:
            futures = {ex.submit(fetch_peer, s): s for s in candidates}
            for f in as_completed(futures):
                r = f.result()
                if r.get("symbol"):
                    peers_data.append(r)

        return {"symbol": sym, "sector": sector, "peers": sorted(peers_data, key=lambda x: x.get("market_cap") or 0, reverse=True)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
