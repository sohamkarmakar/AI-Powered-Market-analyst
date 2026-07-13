from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, Optional
import uvicorn

from app.config import settings
from app.services.yfinance_service import YFinanceService
from app.services.supabase_service import supabase_service

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust as needed in production (e.g. Next.js port 3000)
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

if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
