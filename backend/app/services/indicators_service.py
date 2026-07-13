import pandas as pd
import numpy as np
import yfinance as yf
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class IndicatorsService:
    @staticmethod
    def calculate_technical_indicators(prices_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Compute EMA20, EMA50, RSI (14), and VWAP for a list of daily price history records.
        Each price record must contain: date, open, high, low, close, volume.
        """
        if not prices_list or len(prices_list) < 2:
            return prices_list

        # Convert to pandas DataFrame
        df = pd.DataFrame(prices_list)
        
        # Sort chronologically by date
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values('date').reset_index(drop=True)

        # 1. EMA 20 & EMA 50
        df['ema20'] = df['close'].ewm(span=20, adjust=False).mean()
        df['ema50'] = df['close'].ewm(span=50, adjust=False).mean()

        # 2. RSI (14) using Welles Wilder's smoothing technique
        delta = df['close'].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        
        avg_gain = gain.ewm(alpha=1/14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/14, adjust=False).mean()
        
        # Avoid division by zero
        rs = avg_gain / np.where(avg_loss == 0, 1.e-9, avg_loss)
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # The first 14 periods will have unreliable RSI values, but we return whatever was calculated,
        # capping index 0 as None or NaN.
        df.loc[:13, 'rsi'] = np.nan

        # 3. VWAP (Volume Weighted Average Price)
        # For daily data, VWAP is calculated cumulatively over the series
        typical_price = (df['high'] + df['low'] + df['close']) / 3
        df['vwap'] = (typical_price * df['volume']).cumsum() / np.where(df['volume'].cumsum() == 0, 1, df['volume'].cumsum())

        # Replace NaN/inf with None for clean JSON serialization
        df = df.replace({np.nan: None, np.inf: None, -np.inf: None})

        # Convert back to list of dicts
        computed_records = []
        for _, row in df.iterrows():
            computed_records.append({
                "date": row['date'].strftime('%Y-%m-%d'),
                "open": row['open'],
                "high": row['high'],
                "low": row['low'],
                "close": row['close'],
                "volume": row['volume'],
                "ema20": row['ema20'],
                "ema50": row['ema50'],
                "rsi": row['rsi'],
                "vwap": row['vwap']
            })
            
        return computed_records

    @staticmethod
    def get_orb_signal(symbol: str) -> Dict[str, Any]:
        """
        Fetch intraday 5m data for the latest active trading session and determine the 30-min Opening Range Breakout (ORB).
        Opening period: 9:30 AM - 10:00 AM EST.
        Returns: signal (BULLISH_BREAKOUT, BEARISH_BREAKOUT, NO_BREAKOUT, UNKNOWN), bounds, and current price.
        """
        default_response = {
            "signal": "UNKNOWN",
            "opening_high": None,
            "opening_low": None,
            "latest_price": None,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "reason": "No intraday data available"
        }
        
        try:
            ticker = yf.Ticker(symbol)
            # Fetch 5 days of 5m data to ensure we capture the latest complete session (handles weekends/holidays)
            df = ticker.history(period="5d", interval="5m")
            
            if df.empty:
                return default_response
            
            # Convert DatetimeIndex to Eastern Time
            df.index = df.index.tz_convert('US/Eastern')
            
            # Identify the latest date with data
            latest_date = df.index.date[-1]
            latest_day_df = df[df.index.date == latest_date].copy()
            
            if latest_day_df.empty:
                return default_response

            # Find opening range (9:30 AM to 10:00 AM Eastern)
            opening_range = latest_day_df.between_time('09:30', '10:00')
            
            # If standard exchange times are different or data missing, use first 6 bars (30 mins of 5m intervals)
            if opening_range.empty:
                opening_range = latest_day_df.head(6)

            if opening_range.empty:
                return {
                    **default_response,
                    "reason": f"Could not establish opening range for {latest_date}"
                }
                
            opening_high = float(opening_range['High'].max())
            opening_low = float(opening_range['Low'].min())
            
            # Get latest available close price
            latest_price = float(latest_day_df['Close'].iloc[-1])
            latest_time = latest_day_df.index[-1].isoformat()

            # Filter data post 10:00 AM to calculate signal
            # However, standard ORB is active throughout the day.
            # We can check if the *latest* price has broken out, or if there was any breakout.
            # Usually, checking the latest current price's state is standard.
            if latest_price > opening_high:
                signal = "BULLISH_BREAKOUT"
            elif latest_price < opening_low:
                signal = "BEARISH_BREAKOUT"
            else:
                signal = "NO_BREAKOUT"

            return {
                "signal": signal,
                "opening_high": opening_high,
                "opening_low": opening_low,
                "latest_price": latest_price,
                "latest_time": latest_time,
                "date": latest_date.strftime('%Y-%m-%d'),
                "reason": f"Evaluated latest price against range on {latest_date}"
            }
            
        except Exception as e:
            logger.error(f"Error calculating ORB signal for {symbol}: {str(e)}")
            return {
                **default_response,
                "reason": f"Error during calculation: {str(e)}"
            }
