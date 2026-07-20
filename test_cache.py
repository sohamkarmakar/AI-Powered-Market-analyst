import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.services.yfinance_service import YFinanceService

def main():
    print("Fetching NIFTY 50 info...")
    start = time.time()
    info1 = YFinanceService.get_ticker_info("^NSEI")
    time1 = time.time() - start
    print(f"Call 1 took {time1:.4f}s")
    
    start = time.time()
    info2 = YFinanceService.get_ticker_info("^NSEI")
    time2 = time.time() - start
    print(f"Call 2 took {time2:.4f}s")
    
    print("Fetching OHLCV...")
    start = time.time()
    ohlcv1 = YFinanceService.get_ohlcv("RELIANCE.NS", period="1y", interval="1d")
    time1 = time.time() - start
    print(f"Call 1 took {time1:.4f}s")
    
    start = time.time()
    ohlcv2 = YFinanceService.get_ohlcv("RELIANCE.NS", period="1y", interval="1d")
    time2 = time.time() - start
    print(f"Call 2 took {time2:.4f}s")

if __name__ == "__main__":
    main()
