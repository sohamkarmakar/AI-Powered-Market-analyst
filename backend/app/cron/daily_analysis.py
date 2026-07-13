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

        # 3. Generate global market pulse analysis using all ticker metrics
        if ticker_data_for_pulse:
            logger.info("Generating global market pulse report...")
            try:
                market_pulse = gemini_service.generate_market_pulse(ticker_data_for_pulse)
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
