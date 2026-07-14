import yfinance as yf
import pandas as pd
from typing import Dict, Any, List, Optional
from datetime import datetime

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
        try:
            normalized_symbol = normalize_symbol(symbol)
            ticker = yf.Ticker(normalized_symbol)
            info = ticker.info
            
            if not info or 'symbol' not in info:
                # If yfinance returned empty dict or invalid ticker
                raise ValueError(f"Ticker {normalized_symbol} not found or has no info.")

            # Map yfinance info keys to our expected structure
            # Handle float conversions and defaults
            return {
                "symbol": info.get("symbol", normalized_symbol).upper(),
                "name": info.get("longName") or info.get("shortName") or normalized_symbol.upper(),
                "sector": info.get("sector", "N/A"),
                "industry": info.get("industry", "N/A"),
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE") or info.get("forwardPE"),
                "description": info.get("longBusinessSummary", "No description available."),
                "currency": info.get("currency", "USD")
            }
        except Exception as e:
            raise ValueError(f"Failed to fetch info for {symbol}: {str(e)}")

    @staticmethod
    def get_ohlcv(symbol: str, period: str = "1y", interval: str = "1d") -> List[Dict[str, Any]]:
        """
        Fetch historical OHLCV data for a ticker.
        Periods: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
        Intervals: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
        """
        try:
            normalized_symbol = normalize_symbol(symbol)
            ticker = yf.Ticker(normalized_symbol)
            df = ticker.history(period=period, interval=interval)
            
            if df.empty:
                raise ValueError(f"No price history found for ticker {normalized_symbol} for period {period}.")
            
            # Reset index to make Date a column
            df = df.reset_index()
            
            # Convert date to ISO string
            history = []
            for _, row in df.iterrows():
                # Handle different datetime/date types in pandas index
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

