from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional, List
import uvicorn
import asyncio
import requests.adapters

requests.adapters.DEFAULT_POOLSIZE = 100

from app.config import settings
from app.services.yfinance_service import YFinanceService, normalize_symbol
from app.services.supabase_service import supabase_service
from app.services.indicators_service import IndicatorsService
from app.services.gemini_service import gemini_service
from app.services import screener_service
from app.services import portfolio_service
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
        "http://127.0.0.1:3001",
        "https://market-rover.pages.dev",
    ],
    allow_origin_regex=r"https://.*market-rover\..*",
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
            # Pull lightweight fundamentals from info only once
            info = {}
            try:
                info = ticker.info or {}
            except Exception:
                pass

            try:
                fi = ticker.fast_info
                price      = getattr(fi, "last_price", None)
                prev_close = getattr(fi, "previous_close", None)
                day_high   = getattr(fi, "day_high", None)
                day_low    = getattr(fi, "day_low", None)
                year_high  = getattr(fi, "year_high", None)
                year_low   = getattr(fi, "year_low", None)
                volume     = getattr(fi, "last_volume", None)
                market_cap = getattr(fi, "market_cap", None)
                # Force evaluation to trigger any internal KeyErrors
                if price is not None: _ = float(price)
            except Exception:
                # Fallback to info dict if fast_info is broken
                price      = info.get("currentPrice") or info.get("regularMarketPrice")
                prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
                day_high   = info.get("dayHigh") or info.get("regularMarketDayHigh")
                day_low    = info.get("dayLow") or info.get("regularMarketDayLow")
                year_high  = info.get("fiftyTwoWeekHigh")
                year_low   = info.get("fiftyTwoWeekLow")
                volume     = info.get("volume") or info.get("regularMarketVolume")
                market_cap = info.get("marketCap")

            change = None
            change_pct = None
            if price is not None and prev_close and prev_close != 0:
                change = round(price - prev_close, 2)
                change_pct = round((change / prev_close) * 100, 2)

            def _f(v):
                return round(float(v), 2) if v is not None else None

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
    with ThreadPoolExecutor(max_workers=min(len(normalized), 20)) as executor:
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
# INDICES — NIFTY 50, SENSEX, BANK NIFTY, INDIA VIX strip
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
        "INDIA VIX":  "^INDIAVIX",
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
    with ThreadPoolExecutor(max_workers=5) as executor:
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
# GLOBAL TICKER TAPE
# ─────────────────────────────────────────────
from cachetools import TTLCache
_ticker_tape_cache = TTLCache(maxsize=1, ttl=30)

@app.get("/api/market/ticker-tape")
def get_ticker_tape() -> Dict[str, Any]:
    """
    Returns live quotes for global indices, currencies, and commodities for the ticker tape.
    """
    if "tape" in _ticker_tape_cache:
        return _ticker_tape_cache["tape"]

    from concurrent.futures import ThreadPoolExecutor, as_completed
    import yfinance as yf

    tape_map = {
        "DOW 30": "^DJI",
        "NASDAQ": "^IXIC",
        "NIKKEI 225": "^N225",
        "HANG SENG": "^HSI",
        "USD/INR": "INR=X",
        "BRENT CRUDE": "BZ=F",
        "GOLD": "GC=F"
    }

    def fetch_item(label: str, sym: str) -> Dict[str, Any]:
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
    with ThreadPoolExecutor(max_workers=len(tape_map)) as executor:
        futures = {executor.submit(fetch_item, lbl, sym): lbl for lbl, sym in tape_map.items()}
        done = {}
        for future in as_completed(futures):
            res = future.result()
            done[res["label"]] = res
            
    for lbl in tape_map:
        results.append(done.get(lbl, {"label": lbl, "symbol": tape_map[lbl]}))

    result_dict = {"tape": results}
    _ticker_tape_cache["tape"] = result_dict
    return result_dict


# ─────────────────────────────────────────────
# SECTOR HEATMAP CONSTITUENT AGGREGATION
# ─────────────────────────────────────────────
SECTOR_CONSTITUENTS = {
    "IT & Software": ["TCS.NS","INFY.NS","WIPRO.NS","HCLTECH.NS","LTIM.NS","TECHM.NS"],
    "Financial Services": ["HDFCBANK.NS","ICICIBANK.NS","SBIN.NS","AXISBANK.NS","KOTAKBANK.NS","INDUSINDBK.NS"],
    "Healthcare & Pharma": ["SUNPHARMA.NS","DRREDDY.NS","CIPLA.NS","DIVISLAB.NS","APOLLOHOSP.NS"],
    "Automobile": ["MARUTI.NS","TATAMOTORS.NS","M&M.NS","BAJAJ-AUTO.NS","HEROMOTOCO.NS"],
    "FMCG": ["HINDUNILVR.NS","ITC.NS","NESTLEIND.NS","DABUR.NS","MARICO.NS"],
    "Energy & Power": ["RELIANCE.NS","ONGC.NS","BPCL.NS","IOC.NS","COALINDIA.NS"],
    "Metals & Mining": ["TATASTEEL.NS","JSWSTEEL.NS","HINDALCO.NS","VEDL.NS","SAIL.NS"],
    "Infrastructure": ["LT.NS", "ADANIPORTS.NS", "ULTRACEMCO.NS", "NTPC.NS", "POWERGRID.NS"],
    "Real Estate": ["DLF.NS","GODREJPROP.NS","PRESTIGE.NS","OBEROIRLTY.NS"]
}

SECTOR_INDEX_MAP = {
    "IT & Software": "^CNXIT",
    "Financial Services": "^CNXFIN",
    "Healthcare & Pharma": "^CNXPHARMA",
    "Automobile": "^CNXAUTO",
    "FMCG": "^CNXFMCG",
    "Energy & Power": "^CNXENERGY",
    "Metals & Mining": "^CNXMETAL",
    "Infrastructure": "^CNXINFRA",
    "Real Estate": "^CNXREALTY"
}



@app.get("/api/market/sectors/constituents")
def get_sector_constituents() -> Dict[str, List[str]]:
    return SECTOR_CONSTITUENTS

_NIFTY_50 = [
    "ADANIENT.NS", "ADANIPORTS.NS", "APOLLOHOSP.NS", "ASIANPAINT.NS", "AXISBANK.NS",
    "BAJAJ-AUTO.NS", "BAJFINANCE.NS", "BAJAJFINSV.NS", "BPCL.NS", "BHARTIARTL.NS",
    "BRITANNIA.NS", "CIPLA.NS", "COALINDIA.NS", "DIVISLAB.NS", "DRREDDY.NS",
    "EICHERMOT.NS", "GRASIM.NS", "HCLTECH.NS", "HDFCBANK.NS", "HDFCLIFE.NS",
    "HEROMOTOCO.NS", "HINDALCO.NS", "HINDUNILVR.NS", "ICICIBANK.NS", "ITC.NS",
    "INDUSINDBK.NS", "INFY.NS", "JSWSTEEL.NS", "KOTAKBANK.NS", "LTIM.NS",
    "LT.NS", "M&M.NS", "MARUTI.NS", "NTPC.NS", "NESTLEIND.NS",
    "ONGC.NS", "POWERGRID.NS", "RELIANCE.NS", "SBILIFE.NS", "SHREECEM.NS",
    "SBIN.NS", "SUNPHARMA.NS", "TCS.NS", "TATACONSUM.NS", "TATAMOTORS.NS",
    "TATASTEEL.NS", "TECHM.NS", "TITAN.NS", "ULTRACEMCO.NS", "WIPRO.NS"
]

_NIFTY_NEXT_50 = [
    "ABB.NS", "AMBUJACEM.NS", "AUROPHARMA.NS", "DMART.NS", "BAJAJHLDNG.NS",
    "BANKBARODA.NS", "BEL.NS", "BOSCHLTD.NS", "CANBK.NS", "CHOLAFIN.NS",
    "COLPAL.NS", "DLF.NS", "DABUR.NS", "GAIL.NS", "GODREJCP.NS",
    "HDFCAMC.NS", "HAVELLS.NS", "HAL.NS", "ICICIGI.NS", "ICICIPRULI.NS",
    "IOC.NS", "IRCTC.NS", "IRFC.NS", "INDIGO.NS", "JINDALSTEL.NS",
    "JIOFIN.NS", "KALYANKJIL.NS", "LICI.NS", "LODHA.NS", "MARICO.NS",
    "MUTHOOTFIN.NS", "NHPC.NS", "PIDILITIND.NS", "PFC.NS", "PNB.NS",
    "RECLTD.NS", "SBICARD.NS", "SRF.NS", "MOTHERSON.NS", "SHRIRAMFIN.NS",
    "SIEMENS.NS", "TVSMOTOR.NS", "TRENT.NS", "TORNTPHARM.NS", "TORNTPOWER.NS",
    "UBL.NS", "MCDOWELL-N.NS", "VBL.NS", "VEDL.NS", "ZOMATO.NS"
]

_NIFTY_MIDCAP_100 = [
    "AARTIIND.NS", "ABBOTINDIA.NS", "ALKEM.NS", "ASHOKLEY.NS", "AUBANK.NS",
    "BANDHANBNK.NS", "BANKINDIA.NS", "BATAINDIA.NS", "BHARATFORG.NS", "BHEL.NS",
    "BIOCON.NS", "CGPOWER.NS", "COFORGE.NS", "CONCOR.NS", "CROMPTON.NS",
    "CUMMINSIND.NS", "DALBHARAT.NS", "DEEPAKNTR.NS", "DIXON.NS", "ESCORTS.NS",
    "FEDERALBNK.NS", "FORTIS.NS", "GMRINFRA.NS", "GLENMARK.NS", "GUJGASLTD.NS",
    "HINDPETRO.NS", "IDBI.NS", "IDFCFIRSTB.NS", "IGL.NS", "INDHOTEL.NS",
    "INDUSTOWER.NS", "IPCALAB.NS", "JUBLFOOD.NS", "L&TFH.NS", "LICHSGFIN.NS",
    "LUPIN.NS", "MRF.NS", "MGL.NS", "MAXHEALTH.NS", "MFSL.NS",
    "MPHASIS.NS", "NMDC.NS", "NAUKRI.NS", "NAVINFLUOR.NS", "OBEROIRLTY.NS",
    "OFSS.NS", "OIL.NS", "PIIND.NS", "PAGEIND.NS", "PATANJALI.NS",
    "PERSISTENT.NS", "PETRONET.NS", "POLYCAB.NS", "PRESTIGE.NS", "RAMCOCEM.NS",
    "SAIL.NS", "STARHEALTH.NS", "SUPREMEIND.NS", "SYNGENE.NS", "TATACHEM.NS",
    "TATACOMM.NS", "TATAELXSI.NS", "UPL.NS", "VOLTAS.NS", "YESBANK.NS", "ZEEL.NS"
]

_NIFTY_MIDCAP_150 = list(set(_NIFTY_MIDCAP_100 + [
    "ASTRAL.NS", "ABCAPITAL.NS", "APOLLOTYRE.NS", "BALKRISIND.NS", "CANFINHOME.NS",
    "CHAMBLFERT.NS", "CITYUNION.NS", "COROMANDEL.NS", "CUB.NS", "DEVYANI.NS"
]))

_NIFTY_SMALLCAP_100 = [
    "ALOKINDS.NS", "ANGELONE.NS", "APARINDS.NS", "BSE.NS", "BLS.NS",
    "CASTROLIND.NS", "CDSL.NS", "CENTRALBK.NS", "CESC.NS", "CHALET.NS",
    "CHENNPETRO.NS", "CIEINDIA.NS", "CITYUNION.NS", "COCHINSHIP.NS", "CREDITACC.NS",
    "CYIENT.NS", "DATAPATTNS.NS", "EQUITASBNK.NS", "FSL.NS", "GLENMARK.NS",
    "GRANULES.NS", "HFCL.NS", "HGS.NS", "HUDCO.NS", "INDIACEM.NS",
    "INDIAMART.NS", "IOB.NS", "IRB.NS", "JBCHEPHARM.NS", "JSL.NS",
    "KARURVYSYA.NS", "KEC.NS", "KPITTECH.NS", "LATENTVIEW.NS", "MAHABANK.NS",
    "MANAPPURAM.NS", "MRPL.NS", "NATCOPHARM.NS", "NBCC.NS", "NCC.NS",
    "POONAWALLA.NS", "PVRINOX.NS", "RBLBANK.NS", "RENUKA.NS", "ROUTE.NS",
    "SONACOMS.NS", "SUZLON.NS", "TRIDENT.NS", "UCOBANK.NS", "UTIAMC.NS", "WELSPUNIND.NS"
]

_NIFTY_SMALLCAP_250 = list(set(_NIFTY_SMALLCAP_100 + [
    "AETHER.NS", "AHLUCONT.NS", "AJANTPHARM.NS", "AKZOINDIA.NS", "ALEMBICLTD.NS",
    "ALLCARGO.NS", "ALKYLAMINE.NS", "AMARAJABAT.NS", "AMBER.NS", "ANANDRATHI.NS",
    "ANANTRAJ.NS", "ANURAS.NS", "ANUSHKA.NS", "ANZENALOY.NS", "APC.NS", "APEX.NS", "APEXFROZEN.NS",
    "APEXMOTORS.NS", "APLAB.NS", "APOLLOEXP.NS", "APPOLLO.NS", "APPOLLOHOS.NS",
    "APPOTEX.NS", "APTECHT.NS", "APTINJECT.NS", "APW.NS", "ARENTERP.NS",
    "AREV.NS", "AREX.NS", "ARFIN.NS", "ARGH.NS", "ARGONINDS.NS",
    "ARIHANTCAP.NS", "ARIHANTMNT.NS", "ARIMPEX.NS", "ARJUNMASON.NS", "ARMAN.NS",
    "ARMMAN.NS", "AROHAN.NS", "AROGYA.NS", "AROT.NS", "ARROWHEAD.NS",
    "ARSHIYA.NS", "ARTSON.NS", "ARUNA.NS", "ARUNAHTEL.NS", "ARVINDSMRT.NS",
    "ARVSMART.NS", "ARYAMAN.NS", "ARYAN.NS", "ASB.NS", "ASCL.NS",
    "ASHAPURI.NS", "ASHCO.NS", "ASHIANA.NS", "ASHIRVAD.NS", "ASIANTILES.NS",
    "ASIANSTARS.NS", "ASMAN.NS", "ASMS.NS", "ASMTEC.NS", "ASPIRE.NS",
    "ASREPS.NS", "ASSEMBLAGE.NS", "ASSETGUARD.NS", "ASSETWORKS.NS", "ATAM.NS",
]))
_NIFTY_LARGEMIDCAP_250 = list(set(_NIFTY_50 + _NIFTY_NEXT_50 + _NIFTY_MIDCAP_150))

UNIVERSE_CONSTITUENTS: Dict[str, List[str]] = {
    "Nifty 50":            _NIFTY_50,
    "Nifty Next 50":       _NIFTY_NEXT_50,
    "Nifty 100":           list(set(_NIFTY_50 + _NIFTY_NEXT_50)),
    "Nifty 200":           list(set(_NIFTY_50 + _NIFTY_NEXT_50 + _NIFTY_MIDCAP_100)),
    "Nifty Midcap 100":    _NIFTY_MIDCAP_100,
    "Nifty Midcap 150":    _NIFTY_MIDCAP_150,
    "Nifty Smallcap 100":  _NIFTY_SMALLCAP_100,
    "Nifty Smallcap 250":  _NIFTY_SMALLCAP_250,
    "Nifty LargeMidcap 250": _NIFTY_LARGEMIDCAP_250,
    "Nifty MidSmallcap 400": list(set(_NIFTY_MIDCAP_150 + _NIFTY_SMALLCAP_250)),
}

@app.get("/api/universes")
def list_universes() -> Dict[str, Any]:
    return {
        "universes": [
            {"name": k, "count": len(v)}
            for k, v in UNIVERSE_CONSTITUENTS.items()
        ]
    }

@app.get("/api/universes/{name}/constituents")
def get_universe_constituents(name: str) -> Dict[str, Any]:
    decoded = name.replace("%20", " ").replace("+", " ")
    if decoded not in UNIVERSE_CONSTITUENTS:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Universe '{decoded}' not found")
    symbols = UNIVERSE_CONSTITUENTS[decoded]
    return {"name": decoded, "count": len(symbols), "symbols": symbols}

_sectors_cache = TTLCache(maxsize=1, ttl=30)

@app.get("/api/market/sectors")
def get_sector_heatmap() -> Dict[str, Any]:
    if "sectors" in _sectors_cache:
        return _sectors_cache["sectors"]

    from concurrent.futures import ThreadPoolExecutor, as_completed
    import yfinance as yf

    # 1. Fetch all stock quotes to aggregate sector changes
    all_stocks = set()
    for constituents in SECTOR_CONSTITUENTS.values():
        all_stocks.update(constituents)
    all_stocks = list(all_stocks)

    stock_quotes = {}
    def fetch_stock_quote(sym: str):
        try:
            t = yf.Ticker(sym)
            fi = t.fast_info
            price = getattr(fi, "last_price", None)
            prev = getattr(fi, "previous_close", None)
            vol = getattr(fi, "last_volume", None)
            
            change_pct = 0.0
            if price and prev and prev != 0:
                change_pct = ((price - prev) / prev) * 100
            return sym, {"price": price, "prev_close": prev, "change_pct": change_pct, "volume": vol}
        except Exception:
            return sym, {"price": None, "prev_close": None, "change_pct": 0.0, "volume": 0}

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(fetch_stock_quote, sym) for sym in all_stocks]
        for f in as_completed(futures):
            sym, quote = f.result()
            stock_quotes[sym] = quote

    # 2. Fetch intraday history (sparklines) for the 9 sector indices
    sector_sparklines = {}
    def fetch_sparkline(sector_name: str, index_sym: str):
        try:
            t = yf.Ticker(index_sym)
            df = t.history(period="1d", interval="5m")
            if df.empty:
                df = t.history(period="5d", interval="15m")
            if not df.empty:
                prices = [round(float(p), 2) for p in df["Close"].dropna().tolist()]
                return sector_name, prices
            return sector_name, []
        except Exception:
            return sector_name, []

    with ThreadPoolExecutor(max_workers=9) as executor:
        futures = [executor.submit(fetch_sparkline, name, sym) for name, sym in SECTOR_INDEX_MAP.items()]
        for f in as_completed(futures):
            name, prices = f.result()
            sector_sparklines[name] = prices

    # 3. Aggregate sector metrics
    sectors_result = []
    for sector_name, constituents in SECTOR_CONSTITUENTS.items():
        changes = []
        for s in constituents:
            q = stock_quotes.get(s)
            if q and q["price"] is not None:
                changes.append(q["change_pct"])
        
        avg_change = sum(changes) / len(changes) if changes else 0.0
        
        if avg_change > 0.5:
            sentiment = "BULLISH"
        elif avg_change < -0.5:
            sentiment = "BEARISH"
        else:
            sentiment = "NEUTRAL"

        sectors_result.append({
            "name": sector_name,
            "change": round(avg_change, 2),
            "sentiment": sentiment,
            "count": len(constituents),
            "sparkline": sector_sparklines.get(sector_name, [])
        })

    result_dict = {"sectors": sectors_result}
    _sectors_cache["sectors"] = result_dict
    return result_dict


# ─────────────────────────────────────────────
# TOP GAINERS / LOSERS / ACTIVE
# ─────────────────────────────────────────────
_gainers_losers_cache = TTLCache(maxsize=1, ttl=300)

@app.get("/api/market/gainers-losers")
def get_gainers_losers() -> Dict[str, Any]:
    if "data" in _gainers_losers_cache:
        return _gainers_losers_cache["data"]

    from concurrent.futures import ThreadPoolExecutor, as_completed
    import yfinance as yf

    all_stocks = set()
    for constituents in SECTOR_CONSTITUENTS.values():
        all_stocks.update(constituents)
    all_stocks = list(all_stocks)

    stocks_data = []
    def fetch_stock_full(sym: str):
        try:
            t = yf.Ticker(sym)
            fi = t.fast_info
            name = sym.replace(".NS", "")
            price = getattr(fi, "last_price", None)
            prev = getattr(fi, "previous_close", None)
            volume = getattr(fi, "last_volume", None)
            
            change = 0.0
            change_pct = 0.0
            if price and prev:
                change = price - prev
                if prev != 0:
                    change_pct = (change / prev) * 100
            return {
                "symbol": sym.replace(".NS", ""),
                "name": name,
                "price": round(float(price), 2) if price else None,
                "change": round(float(change), 2) if change else 0.0,
                "change_pct": round(float(change_pct), 2) if change_pct else 0.0,
                "volume": int(volume) if volume else 0
            }
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(fetch_stock_full, sym) for sym in all_stocks]
        for f in as_completed(futures):
            res = f.result()
            if res and res["price"] is not None:
                stocks_data.append(res)

    gainers = sorted([s for s in stocks_data if s["change_pct"] > 0], key=lambda x: x["change_pct"], reverse=True)[:5]
    losers = sorted([s for s in stocks_data if s["change_pct"] < 0], key=lambda x: x["change_pct"])[:5]
    active = sorted(stocks_data, key=lambda x: x["volume"], reverse=True)[:5]

    result_dict = {
        "gainers": gainers,
        "losers": losers,
        "active": active
    }
    _gainers_losers_cache["data"] = result_dict
    return result_dict


# ─────────────────────────────────────────────
# MANUAL AI PULSE REGENERATION
# ─────────────────────────────────────────────
@app.post("/api/market/pulse/generate")
def generate_market_pulse_endpoint() -> Dict[str, Any]:
    if not supabase_service.is_configured:
        raise HTTPException(status_code=503, detail="Supabase not configured.")
    try:
        # 1. Fetch indices
        indices_res = get_indices()
        indices_data = indices_res.get("indices", [])
        
        # Get VIX
        vix_val = None
        for idx in indices_data:
            if idx["symbol"] == "^INDIAVIX":
                vix_val = idx["price"]

        # 2. Fetch sectors heatmap
        sectors_res = get_sector_heatmap()
        sectors_data = sectors_res.get("sectors", [])

        # 3. Fetch gainers and losers
        gl_res = get_gainers_losers()
        gainers = gl_res.get("gainers", [])
        losers = gl_res.get("losers", [])
        active = gl_res.get("active", [])

        # 4. Invoke Gemini
        market_pulse = gemini_service.generate_rich_market_pulse(
            indices_data=indices_data,
            sector_data=sectors_data,
            gainers=gainers,
            losers=losers,
            active=active,
            vix_level=vix_val
        )

        # 5. Save to Supabase
        supabase_service.insert_market_pulse(market_pulse)
        
        return {"status": "success", "pulse_data": market_pulse}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

# ─────────────────────────────────────────────────────────────────────────────
# INTRADAY SCREENER ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

from pydantic import BaseModel
from typing import Literal
import uuid
import time as _time

# In-memory saved scans store (no Supabase dependency for Phase 1)
_saved_scans: List[Dict[str, Any]] = []


class ScreenerCondition(BaseModel):
    indicator: str                                              # rsi, supertrend, macd, vwap, sma20, ema50, price_change, volume, adx, bb
    op: str                                                     # gt, lt, gte, lte, eq, crosses_above, crosses_below, flips_to_buy, flips_to_sell, bullish_crossover, bearish_crossover, above_vwap, below_vwap
    value: Optional[float] = None                               # threshold (not needed for event-based ops)
    bars: Optional[int]    = 1                                  # for price_change: how many bars back


class ScreenerQuery(BaseModel):
    universe:   str                                             # nifty50, banknifty, niftyit, niftyfmcg
    timeframe:  str = "5m"                                      # 1m, 5m, 15m, 1h, 1d
    conditions: List[ScreenerCondition]
    logic:      Literal["AND", "OR"] = "AND"


class SaveScanRequest(BaseModel):
    name:  str
    query: ScreenerQuery

@app.get("/api/screener/universes")
def get_screener_universes() -> Dict[str, Any]:
    """
    Returns available universe names and their symbol counts.
    Also returns the full symbol list for each universe.
    """
    try:
        result = {}
        names = screener_service.list_universes()
        for name, count in names.items():
            syms = screener_service.load_universe(name)
            result[name] = {"count": count, "symbols": syms}
        return {"universes": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/screener/presets")
def get_screener_presets() -> Dict[str, Any]:
    """Returns the list of built-in preset scan queries."""
    return {"presets": screener_service.PRESETS}


@app.post("/api/screener/run")
def run_screener(query: ScreenerQuery) -> Dict[str, Any]:
    """
    Execute a screener scan.
    Fetches intraday OHLCV for the selected universe, computes indicators,
    evaluates conditions, and returns matched symbols.
    """
    t0 = _time.time()

    # Map timeframe → yfinance period string
    period_map = {"1m": "1d", "5m": "1d", "15m": "5d", "1h": "5d", "1d": "1mo"}
    interval = query.timeframe
    period   = period_map.get(interval, "1d")

    try:
        symbols = screener_service.load_universe(query.universe)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Batch fetch OHLCV
    universe_ohlcv = screener_service.fetch_universe_ohlcv(
        symbols=symbols,
        interval=interval,
        period=period,
        max_workers=10,
    )

    # Convert Pydantic conditions to plain dicts for the evaluator
    conditions_dicts = [c.model_dump() for c in query.conditions]

    query_dict = {
        "universe":   query.universe,
        "timeframe":  query.timeframe,
        "conditions": conditions_dicts,
        "logic":      query.logic,
    }

    matches = screener_service.evaluate_query(query_dict, universe_ohlcv)

    # Check data freshness
    ages = screener_service.get_cache_ages(symbols, interval)
    max_age = max((v for v in ages.values() if v is not None), default=None)
    ttl = screener_service.CACHE_TTL.get(interval, 60)
    is_stale = max_age is not None and max_age > ttl * 2

    scan_ms = round((_time.time() - t0) * 1000, 0)

    return {
        "matches":       matches,
        "match_count":   len(matches),
        "total_scanned": len([v for v in universe_ohlcv.values() if v]),
        "scan_time_ms":  scan_ms,
        "is_stale":      is_stale,
        "fetched_at":    _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
        "universe":      query.universe,
        "timeframe":     query.timeframe,
        "symbol_count":  len(symbols),
    }


@app.post("/api/screener/save")
def save_screener_scan(req: SaveScanRequest) -> Dict[str, Any]:
    """Persist a named scan query for later re-use."""
    scan = {
        "id":         str(uuid.uuid4())[:8],
        "name":       req.name,
        "query":      req.query.model_dump(),
        "created_at": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
    }
    _saved_scans.insert(0, scan)
    return {"status": "saved", "scan": scan}


@app.get("/api/screener/saved")
def get_saved_scans() -> Dict[str, Any]:
    """Returns all user-saved scan queries."""
    return {"scans": _saved_scans}


@app.delete("/api/screener/saved/{scan_id}")
def delete_saved_scan(scan_id: str) -> Dict[str, Any]:
    """Delete a saved scan by ID."""
    global _saved_scans
    before = len(_saved_scans)
    _saved_scans = [s for s in _saved_scans if s["id"] != scan_id]
    if len(_saved_scans) == before:
        raise HTTPException(status_code=404, detail=f"Scan '{scan_id}' not found")
    return {"status": "deleted", "id": scan_id}


# ─────────────────────────────────────────────────────────────────────────────
# PORTFOLIO ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import UploadFile, File


class CreatePortfolioRequest(BaseModel):
    name: str
    broker_source: Optional[str] = None


class ManualHoldingRequest(BaseModel):
    symbol: str
    company_name: Optional[str] = None
    isin: Optional[str] = None
    quantity: float
    avg_price: float
    buy_date: Optional[str] = None  # ISO date string YYYY-MM-DD


class ConfirmHoldingsRequest(BaseModel):
    portfolio_id: str
    holdings: List[Dict[str, Any]]
    broker_source: Optional[str] = None


class UpdateHoldingRequest(BaseModel):
    quantity: Optional[float] = None
    avg_price: Optional[float] = None
    buy_date: Optional[str] = None


@app.get("/api/portfolio")
def list_portfolios() -> Dict[str, Any]:
    """List all saved portfolios."""
    try:
        portfolios = supabase_service.list_portfolios()
        return {"portfolios": portfolios, "count": len(portfolios)}
    except Exception as e:
        err = str(e)
        # Detect 'relation does not exist' — schema not yet created
        if "does not exist" in err or "relation" in err.lower():
            raise HTTPException(
                status_code=503,
                detail="Portfolio tables not found. Run backend/schema_portfolio.sql in your Supabase SQL Editor first."
            )
        raise HTTPException(status_code=500, detail=err)


@app.post("/api/portfolio")
def create_portfolio(req: CreatePortfolioRequest) -> Dict[str, Any]:
    """Create a new empty portfolio."""
    try:
        port = supabase_service.create_portfolio(
            name=req.name,
            broker_source=req.broker_source,
        )
        return {"status": "created", "portfolio": port}
    except Exception as e:
        err = str(e)
        if "does not exist" in err or "relation" in err.lower():
            raise HTTPException(
                status_code=503,
                detail="Portfolio tables not found. Run backend/schema_portfolio.sql in your Supabase SQL Editor first."
            )
        raise HTTPException(status_code=500, detail=err)


@app.delete("/api/portfolio/{portfolio_id}")
def delete_portfolio(portfolio_id: str) -> Dict[str, Any]:
    """Delete a portfolio and all its holdings."""
    try:
        supabase_service.delete_portfolio(portfolio_id)
        return {"status": "deleted", "id": portfolio_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/portfolio/symbol-search")
def symbol_search(q: str = Query("", description="Search query")) -> Dict[str, Any]:
    """Autocomplete stock search for manual entry form."""
    results = portfolio_service.search_symbols(q, limit=10)
    return {"query": q, "results": results}


@app.post("/api/portfolio/upload")
async def upload_holdings_file(
    file: UploadFile = File(...),
    field_map: Optional[str] = Query(None, description="JSON-encoded column mapping for unknown broker files"),
) -> Dict[str, Any]:
    """
    Parse a broker holdings CSV/XLSX file.
    Returns a preview of parsed + resolved rows — does NOT persist anything.
    """
    import json as _json

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    allowed_exts = (".csv", ".xlsx", ".xls")
    if not any(file.filename.lower().endswith(ext) for ext in allowed_exts):
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload CSV or XLSX.")

    try:
        file_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {str(e)}")

    parsed_field_map = None
    if field_map:
        try:
            parsed_field_map = _json.loads(field_map)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid field_map JSON")

    result = portfolio_service.parse_uploaded_file(file_bytes, file.filename, parsed_field_map)

    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])

    if result.get("requires_column_mapping"):
        return result

    resolved_rows = portfolio_service.resolve_parsed_rows(result["parsed_rows"])
    result["resolved_rows"] = resolved_rows
    result["unresolved_count"] = sum(1 for r in resolved_rows if r.get("is_unresolved"))

    return result


@app.post("/api/portfolio/{portfolio_id}/holdings/confirm")
def confirm_holdings(
    portfolio_id: str,
    req: ConfirmHoldingsRequest,
) -> Dict[str, Any]:
    """Persist confirmed (post-preview) holdings to the database."""
    if not req.holdings:
        raise HTTPException(status_code=400, detail="No holdings provided")

    for h in req.holdings:
        if req.broker_source:
            h["broker_source"] = req.broker_source
        h["entry_source"] = "upload"

    try:
        saved = supabase_service.bulk_insert_holdings(portfolio_id, req.holdings)
        return {
            "status": "confirmed",
            "portfolio_id": portfolio_id,
            "holdings_saved": len(saved),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/portfolio/{portfolio_id}/holdings")
def get_holdings(portfolio_id: str) -> Dict[str, Any]:
    """List all holdings for a portfolio."""
    try:
        holdings = supabase_service.list_holdings(portfolio_id)
        return {"portfolio_id": portfolio_id, "holdings": holdings, "count": len(holdings)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/portfolio/{portfolio_id}/holdings/manual")
def add_manual_holding(
    portfolio_id: str,
    holdings: List[ManualHoldingRequest],
) -> Dict[str, Any]:
    """Add one or more holdings manually."""
    saved = []
    for req in holdings:
        sym = req.symbol.strip().upper()
        if "." not in sym:
            sym = sym + ".NS"

        holding_data = {
            "symbol":       sym,
            "company_name": req.company_name or sym.replace(".NS", ""),
            "isin":         req.isin,
            "quantity":     req.quantity,
            "avg_price":    req.avg_price,
            "buy_date":     req.buy_date,
            "entry_source": "manual",
        }
        try:
            saved_holding = supabase_service.insert_holding(portfolio_id, holding_data)
            saved.append(saved_holding)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "added",
        "portfolio_id": portfolio_id,
        "holdings_added": len(saved),
        "holdings": saved,
    }


@app.put("/api/portfolio/{portfolio_id}/holdings/{holding_id}")
def update_holding(
    portfolio_id: str,
    holding_id: str,
    req: UpdateHoldingRequest,
) -> Dict[str, Any]:
    """Inline-edit a holding's quantity, avg price, or buy date."""
    updates = req.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    try:
        updated = supabase_service.update_holding(holding_id, updates)
        return {"status": "updated", "holding": updated}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/portfolio/{portfolio_id}/holdings/{holding_id}")
def delete_holding(portfolio_id: str, holding_id: str) -> Dict[str, Any]:
    """Delete a single holding."""
    try:
        supabase_service.delete_holding(holding_id)
        return {"status": "deleted", "id": holding_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# In-process analysis cache keyed by portfolio_id
_portfolio_analysis_cache: Dict[str, Dict] = {}
_PORTFOLIO_CACHE_TTL = 60  # seconds


@app.get("/api/portfolio/{portfolio_id}/analysis")
def get_portfolio_analysis(portfolio_id: str, refresh: bool = False) -> Dict[str, Any]:
    """
    Compute and return full portfolio analysis.
    Caches results for 60 seconds to avoid hammering Yahoo Finance.
    """
    import time as _t

    cached = _portfolio_analysis_cache.get(portfolio_id)
    if cached and not refresh and (_t.time() - cached["fetched_at"]) < _PORTFOLIO_CACHE_TTL:
        return cached["result"]

    holdings = supabase_service.list_holdings(portfolio_id)
    if not holdings:
        raise HTTPException(
            status_code=404,
            detail=f"No holdings found for portfolio '{portfolio_id}'. Upload or add holdings first.",
        )

    try:
        analysis = portfolio_service.compute_portfolio_analysis(holdings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

    result = {"portfolio_id": portfolio_id, **analysis}
    _portfolio_analysis_cache[portfolio_id] = {"result": result, "fetched_at": _t.time()}
    return result


@app.post("/api/portfolio/{portfolio_id}/narrative/generate")
def generate_portfolio_narrative(portfolio_id: str) -> Dict[str, Any]:
    """Generate an AI narrative for the portfolio and cache it in Supabase."""
    holdings = supabase_service.list_holdings(portfolio_id)
    if not holdings:
        raise HTTPException(status_code=404, detail="No holdings found for this portfolio.")

    try:
        analysis = portfolio_service.compute_portfolio_analysis(holdings)
        narrative = gemini_service.generate_portfolio_narrative(analysis)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Narrative generation failed: {str(e)}")

    try:
        supabase_service.upsert_portfolio_narrative(portfolio_id, narrative)
    except Exception:
        pass  # Don't fail the request if DB save fails

    return {"status": "generated", "portfolio_id": portfolio_id, "narrative": narrative}


@app.get("/api/portfolio/{portfolio_id}/narrative")
def get_portfolio_narrative(portfolio_id: str) -> Dict[str, Any]:
    """Fetch the latest cached AI narrative for a portfolio."""
    row = supabase_service.get_latest_portfolio_narrative(portfolio_id)
    if not row:
        raise HTTPException(
            status_code=404,
            detail="No narrative found. Call POST /narrative/generate first.",
        )
    return row
