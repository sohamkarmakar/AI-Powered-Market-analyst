import yfinance as yf
import pandas as pd
from typing import Dict, Any, List, Optional
from datetime import datetime

class YFinanceService:
    @staticmethod
    def get_ticker_info(symbol: str) -> Dict[str, Any]:
        """
        Fetch company profile and fundamental data for a given ticker.
        """
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if not info or 'symbol' not in info:
                # If yfinance returned empty dict or invalid ticker
                raise ValueError(f"Ticker {symbol} not found or has no info.")

            # Map yfinance info keys to our expected structure
            # Handle float conversions and defaults
            return {
                "symbol": info.get("symbol", symbol).upper(),
                "name": info.get("longName") or info.get("shortName") or symbol.upper(),
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
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval=interval)
            
            if df.empty:
                raise ValueError(f"No price history found for ticker {symbol} for period {period}.")
            
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
            ticker = yf.Ticker(symbol)
            raw_news = ticker.news
            
            news_items = []
            if raw_news:
                for item in raw_news:
                    # Convert timestamp (seconds since epoch) to ISO format
                    pub_time = item.get("providerPublishTime")
                    published_at = datetime.utcfromtimestamp(pub_time).isoformat() + "Z" if pub_time else None
                    
                    news_items.append({
                        "id": item.get("uuid"),
                        "title": item.get("title"),
                        "source": item.get("publisher"),
                        "url": item.get("link"),
                        "published_at": published_at,
                        "summary": item.get("summary", "")
                    })
            return news_items
        except Exception as e:
            # Fallback to empty news list if news API fails
            return []
