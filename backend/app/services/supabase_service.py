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

    # ─────────────────────────────────────────────────────────────
    # PORTFOLIO METHODS
    # ─────────────────────────────────────────────────────────────

    def create_portfolio(self, name: str, broker_source: Optional[str] = None) -> Dict[str, Any]:
        if not self.client:
            logger.warning("Supabase not configured. Returning mock portfolio.")
            import uuid
            return {"id": str(uuid.uuid4()), "name": name, "broker_source": broker_source}
        try:
            data = {"name": name, "broker_source": broker_source}
            res = self.client.table("portfolios").insert(data).execute()
            return res.data[0] if res.data else data
        except Exception as e:
            logger.error(f"Supabase create_portfolio error: {str(e)}")
            raise e

    def list_portfolios(self) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        try:
            res = self.client.table("portfolios").select("*").order("created_at", desc=True).execute()
            return res.data or []
        except Exception as e:
            logger.error(f"Supabase list_portfolios error: {str(e)}")
            return []

    def get_portfolio(self, portfolio_id: str) -> Optional[Dict[str, Any]]:
        if not self.client:
            return None
        try:
            res = self.client.table("portfolios").select("*").eq("id", portfolio_id).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Supabase get_portfolio error: {str(e)}")
            return None

    def update_portfolio(self, portfolio_id: str, name: str) -> Optional[Dict[str, Any]]:
        if not self.client:
            return None
        try:
            res = self.client.table("portfolios").update({"name": name}).eq("id", portfolio_id).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Supabase update_portfolio error: {str(e)}")
            raise e

    def delete_portfolio(self, portfolio_id: str) -> bool:
        if not self.client:
            return False
        try:
            self.client.table("portfolios").delete().eq("id", portfolio_id).execute()
            return True
        except Exception as e:
            logger.error(f"Supabase delete_portfolio error: {str(e)}")
            raise e

    def bulk_insert_holdings(self, portfolio_id: str, holdings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not self.client:
            logger.warning("Supabase not configured. Skipping bulk_insert_holdings.")
            return holdings
        try:
            records = []
            for h in holdings:
                records.append({
                    "portfolio_id": portfolio_id,
                    "symbol":       h.get("symbol") or h.get("resolved_symbol"),
                    "isin":         h.get("isin"),
                    "company_name": h.get("company_name") or h.get("resolved_name"),
                    "quantity":     float(h["quantity"]),
                    "avg_price":    float(h["avg_price"]),
                    "buy_date":     h.get("buy_date"),
                    "entry_source": h.get("entry_source", "upload"),
                    "broker_source": h.get("broker_source"),
                })
            res = self.client.table("holdings").insert(records).execute()
            return res.data or []
        except Exception as e:
            logger.error(f"Supabase bulk_insert_holdings error: {str(e)}")
            raise e

    def list_holdings(self, portfolio_id: str) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        try:
            res = self.client.table("holdings").select("*").eq("portfolio_id", portfolio_id).order("created_at").execute()
            return res.data or []
        except Exception as e:
            logger.error(f"Supabase list_holdings error: {str(e)}")
            return []

    def insert_holding(self, portfolio_id: str, holding: Dict[str, Any]) -> Dict[str, Any]:
        if not self.client:
            import uuid
            return {"id": str(uuid.uuid4()), **holding}
        try:
            record = {
                "portfolio_id": portfolio_id,
                "symbol":       holding.get("symbol"),
                "isin":         holding.get("isin"),
                "company_name": holding.get("company_name"),
                "quantity":     float(holding["quantity"]),
                "avg_price":    float(holding["avg_price"]),
                "buy_date":     holding.get("buy_date"),
                "entry_source": holding.get("entry_source", "manual"),
                "broker_source": holding.get("broker_source"),
            }
            res = self.client.table("holdings").insert(record).execute()
            return res.data[0] if res.data else record
        except Exception as e:
            logger.error(f"Supabase insert_holding error: {str(e)}")
            raise e

    def update_holding(self, holding_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.client:
            return None
        try:
            allowed = {k: updates[k] for k in ["quantity", "avg_price", "buy_date", "symbol", "company_name"] if k in updates}
            if "quantity" in allowed:
                allowed["quantity"] = float(allowed["quantity"])
            if "avg_price" in allowed:
                allowed["avg_price"] = float(allowed["avg_price"])
            res = self.client.table("holdings").update(allowed).eq("id", holding_id).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Supabase update_holding error: {str(e)}")
            raise e

    def delete_holding(self, holding_id: str) -> bool:
        if not self.client:
            return False
        try:
            self.client.table("holdings").delete().eq("id", holding_id).execute()
            return True
        except Exception as e:
            logger.error(f"Supabase delete_holding error: {str(e)}")
            raise e

    def upsert_portfolio_narrative(self, portfolio_id: str, narrative: Dict[str, Any]) -> Dict[str, Any]:
        if not self.client:
            return {"portfolio_id": portfolio_id, "narrative": narrative}
        try:
            record = {"portfolio_id": portfolio_id, "narrative": narrative}
            res = self.client.table("portfolio_ai_narratives").insert(record).execute()
            return res.data[0] if res.data else record
        except Exception as e:
            logger.error(f"Supabase upsert_portfolio_narrative error: {str(e)}")
            raise e

    def get_latest_portfolio_narrative(self, portfolio_id: str) -> Optional[Dict[str, Any]]:
        if not self.client:
            return None
        try:
            res = (self.client.table("portfolio_ai_narratives")
                   .select("*")
                   .eq("portfolio_id", portfolio_id)
                   .order("generated_at", desc=True)
                   .limit(1)
                   .execute())
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Supabase get_latest_portfolio_narrative error: {str(e)}")
            return None


supabase_service = SupabaseService()
