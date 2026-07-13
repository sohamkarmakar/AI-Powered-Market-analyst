from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional
import uvicorn

from app.config import settings
from app.services.yfinance_service import YFinanceService
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

@app.get("/health")
def health_check() -> Dict[str, Any]:
    """
    Check the health of the application and integrations.
    """
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "supabase_connected": supabase_service.is_configured
    }

@app.get("/api/ticker/{symbol}")
def get_ticker_data(symbol: str, period: str = "1y", interval: str = "1d") -> Dict[str, Any]:
    """
    Retrieve live OHLCV, fundamentals, and news data from Yahoo Finance directly.
    """
    symbol_upper = symbol.upper()
    try:
        # 1. Fetch info
        info = YFinanceService.get_ticker_info(symbol_upper)
        
        # 2. Fetch price history
        history = YFinanceService.get_ohlcv(symbol_upper, period=period, interval=interval)
        
        # 3. Fetch news
        news = YFinanceService.get_news(symbol_upper)
        
        return {
            "symbol": symbol_upper,
            "info": info,
            "price_history": history,
            "news": news
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/ticker/{symbol}/sync")
def sync_ticker_to_db(symbol: str, period: str = "1y") -> Dict[str, Any]:
    """
    Fetch live data from yfinance and upsert it into the Supabase database.
    """
    if not supabase_service.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Supabase integration is not configured. Set SUPABASE_URL and SUPABASE_KEY."
        )
    
    symbol_upper = symbol.upper()
    try:
        # 1. Fetch live data
        info = YFinanceService.get_ticker_info(symbol_upper)
        history = YFinanceService.get_ohlcv(symbol_upper, period=period)
        news = YFinanceService.get_news(symbol_upper)
        
        # 2. Upsert to Supabase
        upserted_info = supabase_service.upsert_ticker(info)
        upserted_history = supabase_service.upsert_price_history(symbol_upper, history)
        upserted_news = supabase_service.upsert_news(symbol_upper, news)
        
        return {
            "status": "success",
            "message": f"Successfully synced data for {symbol_upper} to Supabase",
            "records": {
                "ticker": upserted_info,
                "price_history_count": len(upserted_history),
                "news_count": len(upserted_news)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/db/ticker/{symbol}")
def get_db_ticker_data(symbol: str) -> Dict[str, Any]:
    """
    Retrieve cached ticker data, price history, and news directly from the Supabase database.
    """
    if not supabase_service.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Supabase integration is not configured. Set SUPABASE_URL and SUPABASE_KEY."
        )
    
    try:
        data = supabase_service.get_ticker_with_data(symbol)
        if not data or not data.get("ticker"):
            raise HTTPException(
                status_code=404, 
                detail=f"Ticker {symbol.upper()} not found in database. Run sync endpoint first."
            )
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ticker/{symbol}/indicators")
def get_technical_indicators(symbol: str, period: str = "1y") -> Dict[str, Any]:
    """
    Calculate and return daily technical indicators (EMA20, EMA50, RSI, VWAP)
    along with the latest intraday ORB (Opening Range Breakout) signal.
    """
    symbol_upper = symbol.upper()
    try:
        # 1. Fetch daily historical prices (for indicator curves)
        # We need at least 50+ periods for EMA50 and RSI14 to stabilize
        history = YFinanceService.get_ohlcv(symbol_upper, period=period)
        
        # 2. Compute technical indicators
        indicators = IndicatorsService.calculate_technical_indicators(history)
        
        # 3. Compute opening range breakout signal
        orb_signal = IndicatorsService.get_orb_signal(symbol_upper)
        
        return {
            "symbol": symbol_upper,
            "indicators": indicators,
            "orb_signal": orb_signal
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/ticker/{symbol}/analysis")
def get_cached_analysis(symbol: str) -> Dict[str, Any]:
    """
    Fetch cached AI news summary and research note from Supabase.
    """
    if not supabase_service.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Supabase integration is not configured."
        )
    try:
        analysis = supabase_service.get_ticker_analysis(symbol)
        if not analysis:
            raise HTTPException(
                status_code=404, 
                detail=f"No cached analysis found for {symbol.upper()}. Run generate endpoint first."
            )
        return analysis
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/market/pulse")
def get_market_pulse() -> Dict[str, Any]:
    """
    Fetch the latest cached global market pulse from Supabase.
    """
    if not supabase_service.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Supabase integration is not configured."
        )
    try:
        pulse = supabase_service.get_latest_market_pulse()
        if not pulse:
            raise HTTPException(
                status_code=404, 
                detail="No market pulse generated yet. Run scheduler script first."
            )
        return pulse
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ticker/{symbol}/analysis/generate")
def generate_and_cache_analysis(symbol: str) -> Dict[str, Any]:
    """
    Run Gemini models to generate news summary and research note, and cache them in Supabase.
    """
    symbol_upper = symbol.upper()
    try:
        # 1. Fetch live data
        info = YFinanceService.get_ticker_info(symbol_upper)
        price_history = YFinanceService.get_ohlcv(symbol_upper, period="3mo")
        news = YFinanceService.get_news(symbol_upper)
        
        # 2. Call Gemini Service
        news_summary = gemini_service.summarize_news(symbol_upper, news)
        research_note = gemini_service.generate_research_note(info, price_history, news_summary)
        
        # 3. Cache in Supabase if configured
        if supabase_service.is_configured:
            # Ensure ticker details exist in tickers table first
            supabase_service.upsert_ticker(info)
            supabase_service.upsert_ticker_analysis(symbol_upper, news_summary, research_note)
            
        return {
            "symbol": symbol_upper,
            "news_summary": news_summary,
            "research_note": research_note
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tickers")
def get_all_tracked_tickers() -> Dict[str, Any]:
    """
    Get all tracked ticker symbols from the database.
    """
    if not supabase_service.is_configured:
        return {
            "status": "success",
            "tickers": []
        }
    try:
        tickers = supabase_service.get_all_tickers()
        return {
            "status": "success",
            "tickers": tickers
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
def search_tickers(q: str = Query(...)) -> Dict[str, Any]:
    """
    Search symbols and suggest matches using yfinance.
    """
    try:
        results = YFinanceService.search_symbols(q)
        return {
            "status": "success",
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)


