import yfinance as yf
import pandas as pd
from typing import Dict, Any, List, Optional
from datetime import datetime
import requests

from cachetools import TTLCache
import logging
from app.services.supabase_service import supabase_service
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

# L1 In-Memory Caches
_info_cache = TTLCache(maxsize=1000, ttl=900)  # 15 minutes
_ohlcv_cache = TTLCache(maxsize=2000, ttl=900) # 15 minutes


def normalize_symbol(symbol: str) -> str:
    symbol = symbol.upper().strip()
    if not symbol:
        return symbol
    if symbol.startswith("^") or "." in symbol:
        return symbol
    return f"{symbol}.NS"

class YFinanceService:
    @staticmethod
    def get_ticker_info(symbol: str) -> Dict[str, Any]:
        """
        Fetch company profile and fundamental data for a given ticker.
        """
        normalized_symbol = normalize_symbol(symbol)
        
        # 1. Check L1 Cache
        if normalized_symbol in _info_cache:
            return _info_cache[normalized_symbol]

        # 2. Check L2 Cache (Supabase)
        try:
            if supabase_service.is_configured:
                res = supabase_service.client.table("tickers").select("*").eq("symbol", normalized_symbol).execute()
                if res.data:
                    db_ticker = res.data[0]
                    updated_at_str = db_ticker.get("updated_at")
                    if updated_at_str:
                        updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                        # Use L2 if updated within last 24 hours
                        if datetime.now(timezone.utc) - updated_at < timedelta(hours=24):
                            info_result = {
                                "symbol": db_ticker["symbol"],
                                "name": db_ticker["name"],
                                "sector": db_ticker["sector"],
                                "industry": db_ticker["industry"],
                                "market_cap": db_ticker.get("market_cap"),
                                "pe_ratio": db_ticker.get("pe_ratio"),
                                "description": db_ticker.get("description"),
                                "currency": "INR"
                            }
                            _info_cache[normalized_symbol] = info_result
                            return info_result
        except Exception as e:
            logger.error(f"L2 Cache read error for {normalized_symbol}: {e}")

        # 3. Fetch from Yahoo Finance
        try:
            ticker = yf.Ticker(normalized_symbol)
            info = ticker.info
            
            if not info or 'symbol' not in info:
                raise ValueError(f"Ticker {normalized_symbol} not found or has no info.")

            info_result = {
                "symbol": info.get("symbol", normalized_symbol).upper(),
                "name": info.get("longName") or info.get("shortName") or normalized_symbol.upper(),
                "sector": info.get("sector", "N/A"),
                "industry": info.get("industry", "N/A"),
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE") or info.get("forwardPE"),
                "description": info.get("longBusinessSummary", "No description available."),
                "currency": info.get("currency", "USD")
            }

            # Save to L1
            _info_cache[normalized_symbol] = info_result

            # Save to L2
            try:
                if supabase_service.is_configured:
                    supabase_service.upsert_ticker(info_result)
            except Exception as e:
                logger.error(f"L2 Cache write error for {normalized_symbol}: {e}")

            return info_result
        except Exception as e:
            raise ValueError(f"Failed to fetch info for {symbol}: {str(e)}")

    @staticmethod
    def get_ohlcv(symbol: str, period: str = "1y", interval: str = "1d") -> List[Dict[str, Any]]:
        """
        Fetch historical OHLCV data for a ticker.
        """
        normalized_symbol = normalize_symbol(symbol)
        cache_key = f"{normalized_symbol}_{period}_{interval}"
        
        # 1. Check L1 Cache
        if cache_key in _ohlcv_cache:
            return _ohlcv_cache[cache_key]

        # 2. Check L2 Cache for 1y/1d historical
        if period == "1y" and interval == "1d":
            try:
                if supabase_service.is_configured:
                    res = supabase_service.client.table("price_history").select("*").eq("ticker_symbol", normalized_symbol).order("date", desc=True).limit(250).execute()
                    if res.data and len(res.data) > 200:
                        # Verify freshness (is the latest date recent?)
                        latest_date_str = res.data[0]["date"]
                        latest_date = datetime.strptime(latest_date_str, "%Y-%m-%d").date()
                        if (datetime.utcnow().date() - latest_date).days <= 2:
                            # Valid cache
                            history = list(reversed(res.data))
                            _ohlcv_cache[cache_key] = history
                            return history
            except Exception as e:
                logger.error(f"L2 Cache ohlcv read error for {normalized_symbol}: {e}")

        # 3. Fetch from Yahoo Finance
        try:
            ticker = yf.Ticker(normalized_symbol)
            df = ticker.history(period=period, interval=interval)
            
            if df.empty:
                raise ValueError(f"No price history found for ticker {normalized_symbol} for period {period}.")
            
            df = df.reset_index()
            history = []
            for _, row in df.iterrows():
                dt = row['Date']
                if hasattr(dt, 'to_pydatetime'):
                    date_str = dt.to_pydatetime().strftime('%Y-%m-%d')
                elif isinstance(dt, (datetime, pd.Timestamp)):
                    date_str = dt.strftime('%Y-%m-%d')
                else:
                    date_str = str(dt)[:10]

                history.append({
                    "date": date_str,
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": int(row["Volume"])
                })
            
            # Save to L1
            _ohlcv_cache[cache_key] = history

            # Save to L2 (only 1d interval)
            if interval == "1d":
                try:
                    if supabase_service.is_configured:
                        supabase_service.upsert_price_history(normalized_symbol, history)
                except Exception as e:
                    logger.error(f"L2 Cache ohlcv write error for {normalized_symbol}: {e}")

            return history
        except Exception as e:
            raise ValueError(f"Failed to fetch price history for {symbol}: {str(e)}")

    @staticmethod
    def get_news(symbol: str) -> List[Dict[str, Any]]:
        """
        Fetch recent news articles for a ticker from Yahoo Finance.
        """
        try:
            normalized_symbol = normalize_symbol(symbol)
            ticker = yf.Ticker(normalized_symbol)
            raw_news = ticker.news
            
            news_items = []
            if raw_news:
                for item in raw_news:
                    # Deterministic hash fallback for ID if uuid is missing
                    news_id = item.get("uuid") or item.get("id")
                    if not news_id:
                        import hashlib
                        link = item.get("link") or ""
                        title = item.get("title") or ""
                        if link or title:
                            news_id = hashlib.md5((link + title).encode("utf-8")).hexdigest()
                        else:
                            import uuid
                            news_id = str(uuid.uuid4())

                    # Ensure published_at is not null
                    pub_time = item.get("providerPublishTime")
                    if pub_time:
                        published_at = datetime.utcfromtimestamp(pub_time).isoformat() + "Z"
                    else:
                        published_at = datetime.utcnow().isoformat() + "Z"

                    # Ensure title is not null
                    title = item.get("title") or "No Title"
                    
                    news_items.append({
                        "id": news_id,
                        "title": title,
                        "source": item.get("publisher") or "Unknown Source",
                        "url": item.get("link") or "",
                        "published_at": published_at,
                        "summary": item.get("summary") or ""
                    })
            return news_items
        except Exception as e:
            # Fallback to empty news list if news API fails
            return []

    @staticmethod
    def search_symbols(query: str) -> List[Dict[str, Any]]:
        """
        Query Yahoo Finance autocomplete search suggestion API.
        """
        try:
            import httpx
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            url = f"https://query2.finance.yahoo.com/v1/finance/search?q={query}"
            res = httpx.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                quotes = data.get("quotes", [])
                
                results = []
                for q in quotes:
                    quote_type = q.get("quoteType", "")
                    symbol = q.get("symbol", "").upper()
                    
                    # Filter for Indian market: symbol ends with .NS or .BO, or starts with ^ (indices)
                    is_indian = (
                        symbol.endswith(".NS") or 
                        symbol.endswith(".BO") or 
                        symbol.startswith("^NSE") or 
                        symbol.startswith("^BSESN") or 
                        symbol in ["^NSEI", "^BSESN", "^NSEBANK", "^CNXIT"]
                    )
                    
                    if (quote_type in ["EQUITY", "ETF", "INDEX"]) and is_indian:
                        results.append({
                            "symbol": symbol,
                            "name": q.get("shortname") or q.get("longname") or q.get("symbol", ""),
                            "exchange": q.get("exchDisp") or q.get("exchange") or "N/A",
                            "type": quote_type
                        })
                return results
            return []
        except Exception as e:
            print(f"Error in search_symbols: {e}")
            return []

