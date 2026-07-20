from app.services.yfinance_service import yf_session
import sys
import os
import logging
from datetime import datetime

# Adjust sys.path to find 'app' from backend root
backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(backend_dir)

from app.services.supabase_service import supabase_service
from app.services.yfinance_service import YFinanceService
from app.services.gemini_service import gemini_service

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("daily_analysis_cron")

def run_daily_analysis():
    logger.info("Starting Daily AI Equity Analysis job...")
    
    if not supabase_service.is_configured:
        logger.error("Supabase is not configured. Daily analysis requires Supabase caching. Exiting.")
        return
        
    try:
        # 1. Fetch all tracked tickers from the database
        tickers = supabase_service.get_all_tickers()
        logger.info(f"Retrieved {len(tickers)} tickers from the database.")
        
        if not tickers:
            logger.warning("No tickers found in the database. Please sync a ticker first to add it to the tracked portfolio.")
            return

        ticker_data_for_pulse = []

        # 2. Iterate through each ticker, update historical data, and run AI analysis
        for ticker_obj in tickers:
            symbol = ticker_obj["symbol"]
            logger.info(f"Processing analysis for {symbol}...")
            
            try:
                # A. Download fresh data from yfinance
                info = YFinanceService.get_ticker_info(symbol)
                price_history = YFinanceService.get_ohlcv(symbol, period="3mo")
                news = YFinanceService.get_news(symbol)

                # B. Update/sync fresh data in Supabase tables
                supabase_service.upsert_ticker(info)
                supabase_service.upsert_price_history(symbol, price_history)
                supabase_service.upsert_news(symbol, news)
                
                # C. Run news summarization & sentiment analysis via Gemini
                logger.info(f"Generating news summary for {symbol}...")
                news_summary = gemini_service.summarize_news(symbol, news)

                # D. Generate research note via Gemini
                logger.info(f"Generating research note for {symbol}...")
                research_note = gemini_service.generate_research_note(info, price_history, news_summary)

                # E. Cache AI results in Supabase
                supabase_service.upsert_ticker_analysis(symbol, news_summary, research_note)
                logger.info(f"Successfully cached analysis for {symbol}.")
                
                # Store aggregated information for global market pulse
                ticker_data_for_pulse.append({
                    "symbol": symbol,
                    "name": info.get("name"),
                    "sector": info.get("sector"),
                    "market_cap": info.get("market_cap"),
                    "pe_ratio": info.get("pe_ratio"),
                    "sentiment": news_summary.get("overall_sentiment"),
                    "recommendation": research_note.get("recommendation")
                })
                
            except Exception as e:
                logger.error(f"Failed to process ticker {symbol}: {str(e)}")
                # Continue with the next ticker so that one failure doesn't halt the whole job
                continue

        # 3. Generate global market pulse analysis using rich metrics
        logger.info("Generating global market pulse report...")
        try:
            import yfinance as yf
            from app.main import get_sector_heatmap, get_gainers_losers

            # Fetch Indices
            indices_data = []
            index_map = {
                "NIFTY 50": "^NSEI",
                "SENSEX": "^BSESN",
                "BANK NIFTY": "^NSEBANK",
                "NIFTY IT": "^CNXIT",
                "INDIA VIX": "^INDIAVIX",
            }
            vix_val = None
            for lbl, sym in index_map.items():
                try:
                    t = yf.Ticker(sym, session=yf_session)
                    fi = t.fast_info
                    p = getattr(fi, "last_price", None)
                    prev = getattr(fi, "previous_close", None)
                    chg = round(p - prev, 2) if p and prev else 0.0
                    chg_pct = round((chg / prev) * 100, 2) if prev else 0.0
                    indices_data.append({
                        "label": lbl, "symbol": sym, "price": p, "change": chg, "change_pct": chg_pct
                    })
                    if sym == "^INDIAVIX":
                        vix_val = p
                except Exception:
                    pass

            sectors_res = get_sector_heatmap()
            sectors_data = sectors_res.get("sectors", [])

            gl_res = get_gainers_losers()
            gainers = gl_res.get("gainers", [])
            losers = gl_res.get("losers", [])
            active = gl_res.get("active", [])

            market_pulse = gemini_service.generate_rich_market_pulse(
                indices_data=indices_data,
                sector_data=sectors_data,
                gainers=gainers,
                losers=losers,
                active=active,
                vix_level=vix_val
            )
            supabase_service.insert_market_pulse(market_pulse)
            logger.info("Successfully generated and cached market pulse report.")
        except Exception as e:
            logger.error(f"Failed to generate market pulse: {str(e)}")
        else:
            logger.warning("No ticker data was successfully processed; skipping market pulse.")

        logger.info("Daily AI Equity Analysis job completed successfully.")
        
    except Exception as e:
        logger.error(f"Global daily analysis cron job error: {str(e)}")

if __name__ == "__main__":
    run_daily_analysis()
