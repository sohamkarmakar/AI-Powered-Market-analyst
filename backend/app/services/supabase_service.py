import logging
from typing import Dict, Any, List, Optional
from supabase import create_client, Client
from app.config import settings

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SupabaseService:
    def __init__(self):
        self.client: Optional[Client] = None
        if settings.supabase_url and settings.supabase_key and \
           settings.supabase_url != "your_supabase_project_url" and \
           settings.supabase_key != "your_supabase_anon_or_service_role_key":
            try:
                self.client = create_client(settings.supabase_url, settings.supabase_key)
                logger.info("Supabase client successfully initialized.")
            except Exception as e:
                logger.error(f"Failed to initialize Supabase client: {str(e)}")
        else:
            logger.warning(
                "Supabase URL or Key not set or default. "
                "Database services will run in mock/passthrough mode or raise errors."
            )

    @property
    def is_configured(self) -> bool:
        return self.client is not None

    def upsert_ticker(self, ticker_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Upsert a ticker's fundamental details into the tickers table.
        """
        if not self.client:
            logger.warning("Supabase client not configured. Skipping upsert_ticker.")
            return [ticker_data]
        try:
            # Map frontend keys if necessary, or assume it matches db fields:
            # symbol, name, sector, industry, market_cap, pe_ratio, description
            db_data = {
                "symbol": ticker_data["symbol"].upper(),
                "name": ticker_data["name"],
                "sector": ticker_data["sector"],
                "industry": ticker_data["industry"],
                "market_cap": ticker_data.get("market_cap"),
                "pe_ratio": ticker_data.get("pe_ratio"),
                "description": ticker_data.get("description"),
                "updated_at": "now()"
            }
            res = self.client.table("tickers").upsert(db_data).execute()
            return res.data
        except Exception as e:
            logger.error(f"Supabase upsert_ticker error: {str(e)}")
            raise e

    def upsert_price_history(self, ticker_symbol: str, prices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Upsert price history records. Each record should contain:
        ticker_symbol, date, open, high, low, close, volume.
        """
        if not self.client:
            logger.warning("Supabase client not configured. Skipping upsert_price_history.")
            return prices
        if not prices:
            return []
        try:
            db_records = []
            for price in prices:
                db_records.append({
                    "ticker_symbol": ticker_symbol.upper(),
                    "date": price["date"],
                    "open": price["open"],
                    "high": price["high"],
                    "low": price["low"],
                    "close": price["close"],
                    "volume": price["volume"]
                })
            
            # Chunk operations if too large (Supabase limits size, but yfinance 1y is 252 rows which is fine)
            res = self.client.table("price_history").upsert(db_records, on_conflict="ticker_symbol,date").execute()
            return res.data
        except Exception as e:
            logger.error(f"Supabase upsert_price_history error: {str(e)}")
            raise e

    def upsert_news(self, ticker_symbol: str, news_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Upsert news articles for a ticker.
        """
        if not self.client:
            logger.warning("Supabase client not configured. Skipping upsert_news.")
            return news_list
        if not news_list:
            return []
        try:
            db_records = []
            for news in news_list:
                db_records.append({
                    "id": news["id"],
                    "ticker_symbol": ticker_symbol.upper(),
                    "title": news["title"],
                    "source": news["source"],
                    "url": news["url"],
                    "published_at": news["published_at"],
                    "summary": news.get("summary", "")
                })
            res = self.client.table("news").upsert(db_records).execute()
            return res.data
        except Exception as e:
            logger.error(f"Supabase upsert_news error: {str(e)}")
            raise e

    def get_ticker_with_data(self, symbol: str) -> Dict[str, Any]:
        """
        Get ticker metadata, price history, and news from database.
        """
        if not self.client:
            raise RuntimeError("Supabase client not configured.")
        
        symbol_upper = symbol.upper()
        ticker_res = self.client.table("tickers").select("*").eq("symbol", symbol_upper).execute()
        
        if not ticker_res.data:
            return {}
            
        prices_res = self.client.table("price_history").select("*").eq("ticker_symbol", symbol_upper).order("date", desc=True).limit(250).execute()
        news_res = self.client.table("news").select("*").eq("ticker_symbol", symbol_upper).order("published_at", desc=True).limit(10).execute()
        
        return {
            "ticker": ticker_res.data[0],
            "price_history": list(reversed(prices_res.data)), # Order chronologically for graphs
            "news": news_res.data
        }

    def upsert_ticker_analysis(self, symbol: str, news_summary: Dict[str, Any], research_note: Dict[str, Any]) -> Dict[str, Any]:
        """
        Upsert AI research notes and news summaries for a ticker.
        """
        if not self.client:
            logger.warning("Supabase client not configured. Skipping upsert_ticker_analysis.")
            return {"ticker_symbol": symbol, "news_summary": news_summary, "research_note": research_note}
        try:
            db_data = {
                "ticker_symbol": symbol.upper(),
                "news_summary": news_summary,
                "research_note": research_note,
                "updated_at": "now()"
            }
            res = self.client.table("ticker_analysis").upsert(db_data).execute()
            return res.data[0] if res.data else db_data
        except Exception as e:
            logger.error(f"Supabase upsert_ticker_analysis error: {str(e)}")
            raise e

    def insert_market_pulse(self, pulse_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Insert a new global market pulse record.
        """
        if not self.client:
            logger.warning("Supabase client not configured. Skipping insert_market_pulse.")
            return {"pulse_data": pulse_data}
        try:
            db_data = {
                "pulse_data": pulse_data,
                "created_at": "now()"
            }
            res = self.client.table("market_pulse").insert(db_data).execute()
            return res.data[0] if res.data else db_data
        except Exception as e:
            logger.error(f"Supabase insert_market_pulse error: {str(e)}")
            raise e

    def get_ticker_analysis(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Fetch cached AI analysis for a specific ticker.
        """
        if not self.client:
            raise RuntimeError("Supabase client not configured.")
        try:
            res = self.client.table("ticker_analysis").select("*").eq("ticker_symbol", symbol.upper()).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Supabase get_ticker_analysis error: {str(e)}")
            raise e

    def get_latest_market_pulse(self) -> Optional[Dict[str, Any]]:
        """
        Fetch the most recent cached global market pulse.
        """
        if not self.client:
            raise RuntimeError("Supabase client not configured.")
        try:
            res = self.client.table("market_pulse").select("*").order("created_at", desc=True).limit(1).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Supabase get_latest_market_pulse error: {str(e)}")
            raise e

    def get_all_tickers(self) -> List[Dict[str, Any]]:
        """
        Fetch all tracked tickers from the database.
        """
        if not self.client:
            raise RuntimeError("Supabase client not configured.")
        try:
            res = self.client.table("tickers").select("*").execute()
            return res.data
        except Exception as e:
            logger.error(f"Supabase get_all_tickers error: {str(e)}")
            raise e

supabase_service = SupabaseService()
