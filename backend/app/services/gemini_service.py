import os
import json
import logging
from typing import Dict, Any, List, Optional
import google.generativeai as genai
from pydantic import BaseModel, Field

from app.config import settings

# Setup logging
logger = logging.getLogger(__name__)

# --- Response Schemas (Pydantic Models for Structured Output) ---

class NewsSummarySchema(BaseModel):
    overall_sentiment: str = Field(description="Overall sentiment: BULLISH, BEARISH, or NEUTRAL")
    sentiment_score: float = Field(description="Numeric score representing sentiment from -1.0 (most bearish) to 1.0 (most bullish)")
    key_themes: List[str] = Field(description="Core themes identified in the news articles")
    summary_points: List[str] = Field(description="Key takeaway bullet points summarizing the news")

class ResearchNoteSchema(BaseModel):
    recommendation: str = Field(description="Investment recommendation: BUY, HOLD, or SELL")
    target_price: float = Field(description="Estimated 12-month target price")
    investment_thesis: str = Field(description="Detailed explanation of the investment thesis")
    key_catalysts: List[str] = Field(description="Key events or catalysts that could drive the stock price")
    key_risks: List[str] = Field(description="Key risks to the investment thesis")
    valuation_summary: str = Field(description="Brief valuation modeling summary")

class SectorOutlookSchema(BaseModel):
    sector: str = Field(description="Name of the sector")
    performance: str = Field(description="Short-term performance summary (e.g. Strong, Weak, Stable)")
    outlook: str = Field(description="Brief outlook summary")

class MarketPulseSchema(BaseModel):
    market_condition: str = Field(description="Overall market condition: BULLISH, BEARISH, or SIDEWAYS")
    pulse_summary: str = Field(description="High-level narrative summarizing current market trends and conditions")
    top_sectors: List[SectorOutlookSchema] = Field(description="Outlook for key market sectors")
    market_drivers: List[str] = Field(description="Core macroeconomic or technical factors driving the market")
    macro_trends: List[str] = Field(description="Macro economic trends to watch")

class PortfolioNarrativeSchema(BaseModel):
    health_summary: str = Field(description="Plain-English 2-3 sentence portfolio health overview, 80-120 words")
    key_observations: List[str] = Field(description="3-5 specific, actionable observations about this portfolio (allocation, risk, performance)")
    concentration_warnings: List[str] = Field(description="Specific warnings about over-concentration in individual stocks or sectors (empty list if none)")
    top_opportunities: List[str] = Field(description="2-3 holdings that look technically or fundamentally strong based on the data")
    watch_list: List[str] = Field(description="2-3 holdings to watch — underperforming, overbought, or near 52-week lows")
    sentiment: str = Field(description="Overall portfolio sentiment: STRONG, BALANCED, CAUTIOUS, or AT_RISK")

# --- Gemini Service Implementation ---

class GeminiService:
    def __init__(self):
        self.is_configured = False
        api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")
        
        if api_key and api_key != "your_gemini_api_key":
            try:
                genai.configure(api_key=api_key)
                self.is_configured = True
                # Using gemini-3.1-flash-lite as the default model
                self.model_name = "gemini-3.1-flash-lite"
                logger.info(f"Gemini service initialized using model {self.model_name}.")
            except Exception as e:
                logger.error(f"Failed to initialize Gemini: {str(e)}")
        else:
            logger.warning("GEMINI_API_KEY not configured. Running Gemini in mock mode.")

    def _call_gemini(self, prompt: str, schema_class: Any) -> Dict[str, Any]:
        """
        Helper method to request structured JSON from Gemini.
        Falls back to mock responses if not configured.
        """
        if not self.is_configured:
            return self._generate_mock_data(schema_class)
            
        try:
            model = genai.GenerativeModel(self.model_name)
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=schema_class,
                    temperature=0.2
                )
            )
            return json.loads(response.text)
        except Exception as e:
            logger.error(f"Gemini API call failed: {str(e)}. Falling back to mock data.")
            return self._generate_mock_data(schema_class)

    def summarize_news(self, symbol: str, news_items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generate a structured news summary and sentiment analysis for a given ticker's news.
        """
        if not news_items:
            return {
                "overall_sentiment": "NEUTRAL",
                "sentiment_score": 0.0,
                "key_themes": ["No recent news available"],
                "summary_points": ["No news updates were found to summarize."]
            }
            
        formatted_news = "\n\n".join([
            f"Title: {item['title']}\nSource: {item['source']}\nSummary: {item['summary']}"
            for item in news_items
        ])
        
        prompt = f"""
        Analyze the following news articles for {symbol}. 
        Provide a structured JSON news summary containing:
        - Overall market sentiment towards the stock (BULLISH, BEARISH, NEUTRAL).
        - Sentiment score from -1.0 (very negative) to 1.0 (very positive).
        - The core themes identified in the articles.
        - bullet points highlighting key events, product launches, financial updates, or regulatory notices.

        News articles:
        {formatted_news}
        """
        return self._call_gemini(prompt, NewsSummarySchema)

    def generate_research_note(self, ticker_info: Dict[str, Any], price_history: List[Dict[str, Any]], news_summary: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate a structured equity research note combining fundamentals, technical action, and news sentiment.
        """
        # Format fundamentals
        fundamentals = f"""
        Company Name: {ticker_info.get('name')}
        Sector: {ticker_info.get('sector')}
        Industry: {ticker_info.get('industry')}
        Market Cap: {ticker_info.get('market_cap')}
        P/E Ratio: {ticker_info.get('pe_ratio')}
        Description: {ticker_info.get('description')[:500]}...
        """
        
        # Format recent prices (take last 5 days to keep it concise)
        recent_prices = "\n".join([
            f"Date: {p['date']} | Close: {p['close']} | Volume: {p['volume']}"
            for p in price_history[-5:]
        ]) if price_history else "No price history available"

        # News summary format
        news_sentiment = f"""
        Sentiment: {news_summary.get('overall_sentiment')} (Score: {news_summary.get('sentiment_score')})
        Key Takeaways: {', '.join(news_summary.get('summary_points', []))}
        """

        prompt = f"""
        You are a senior equity research analyst. Generate a structured JSON research note for {ticker_info.get('symbol')}.
        Incorporate the following information:
        
        [Fundamentals]
        {fundamentals}

        [Recent Technical Actions]
        {recent_prices}

        [News Sentiment]
        {news_sentiment}

        Your research note must include:
        1. An overall investment recommendation: BUY, HOLD, or SELL.
        2. A target price (estimate a reasonable 12-month target based on recent close prices and fundamentals).
        3. A solid investment thesis justifying the recommendation.
        4. Core short/medium term catalysts.
        5. Crucial investment risks.
        6. A valuation summary narrative.
        """
        return self._call_gemini(prompt, ResearchNoteSchema)

    def generate_market_pulse(self, tickers_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generate a global market pulse report based on aggregate data from all tracked tickers.
        """
        if not tickers_data:
            return self._generate_mock_data(MarketPulseSchema)

        portfolio_summary = "\n\n".join([
            f"Symbol: {t['symbol']}\nName: {t['name']}\nSector: {t['sector']}\nMarket Cap: {t.get('market_cap')}\nP/E: {t.get('pe_ratio')}\n"
            for t in tickers_data
        ])

        prompt = f"""
        Analyze the overall market condition based on the following tracked equity portfolio metrics:
        
        {portfolio_summary}

        Generate a structured JSON market pulse analysis report including:
        - Overall market condition (BULLISH, BEARISH, SIDEWAYS).
        - A general narrative summary of market trends, risks, and developments.
        - Outlook and performance trends for key sectors present in the data.
        - Top market drivers (macro or portfolio-specific factors).
        - Notable macro-economic trends to watch.
        """
        return self._call_gemini(prompt, MarketPulseSchema)

    def generate_rich_market_pulse(
        self,
        indices_data: List[Dict[str, Any]],
        sector_data: List[Dict[str, Any]],
        gainers: List[Dict[str, Any]],
        losers: List[Dict[str, Any]],
        active: List[Dict[str, Any]],
        vix_level: Optional[float]
    ) -> Dict[str, Any]:
        """
        Generate a global market pulse report based on rich live data including indices, sectors, VIX, gainers and losers.
        """
        if not indices_data and not sector_data:
            return self._generate_mock_data(MarketPulseSchema)

        indices_str = "\n".join([
            f"- {idx['label']} ({idx['symbol']}): Price: {idx.get('price')}, Change: {idx.get('change')} ({idx.get('change_pct')}%)"
            for idx in indices_data if 'label' in idx
        ])
        
        sectors_str = "\n".join([
            f"- {sec['name']}: Change: {sec['change']:.2f}%, Sentiment: {sec['sentiment']} (from {sec['count']} constituents)"
            for sec in sector_data
        ])

        gainers_str = ", ".join([
            f"{g['symbol']} (+{g['change_pct']:.2f}%)" for g in gainers
        ]) if gainers else "N/A"

        losers_str = ", ".join([
            f"{l['symbol']} ({l['change_pct']:.2f}%)" for l in losers
        ]) if losers else "N/A"

        active_str = ", ".join([
            f"{a['symbol']} (Vol: {a['volume']:,})" for a in active
        ]) if active else "N/A"

        prompt = f"""
        You are a senior market analyst generating a concise daily briefing for Indian equities.
        Given the following live market data, generate a structured JSON market pulse analysis report.
        
        [Major Indian Indices]
        {indices_str}
        
        [India VIX (Fear Gauge)]
        VIX Level: {vix_level or "N/A"}
        
        [Sector Performance Heatmap (Constituent-aggregated momentum)]
        {sectors_str}
        
        [Top Market Gainers]
        {gainers_str}
        
        [Top Market Losers]
        {losers_str}
        
        [Most Active Stocks by Volume]
        {active_str}
        
        Output MUST be a valid JSON matching this schema:
        - market_condition: Overall market tone ("BULLISH" | "BEARISH" | "SIDEWAYS").
        - pulse_summary: 2-3 sentence overview of market tone and core drivers.
        - top_sectors: A list of 3 sectors of interest with outlook. Each item must have:
            - sector: Sector name.
            - performance: "Strong" | "Stable" | "Weak" (short-term performance summary matching the sector's move).
            - outlook: Brief forward-looking narrative notes on the sector.
        - market_drivers: 3 bullet reasons for today's price movements (e.g., sector rotation, VIX levels, global cue flow).
        - macro_trends: 2-3 broader structural observations about the Indian economy or corporate sectors.
        """
        return self._call_gemini(prompt, MarketPulseSchema)

    def _generate_mock_data(self, schema_class: Any) -> Dict[str, Any]:
        """
        Returns mock JSON data matching the requested schema for testing without an API key.
        """
        if schema_class == NewsSummarySchema:
            return {
                "overall_sentiment": "BULLISH",
                "sentiment_score": 0.65,
                "key_themes": ["Strong demand", "AI Product updates"],
                "summary_points": [
                    "Recent news shows highly positive consumer feedback on new features.",
                    "Earnings expectations remain stable with minor upward revisions.",
                    "Expanded partnerships in the cloud infrastructure division."
                ]
            }
        elif schema_class == ResearchNoteSchema:
            return {
                "recommendation": "BUY",
                "target_price": 345.0,
                "investment_thesis": "The company continues to expand its high-margin services division while defending its core hardware margins, indicating strong cash flow generation.",
                "key_catalysts": [
                    "Upcoming product hardware launch in Q3.",
                    "Sustained double-digit growth in cloud services revenues."
                ],
                "key_risks": [
                    "Heightened global antitrust regulatory scrutiny.",
                    "Supply chain bottlenecks in semiconductor modules."
                ],
                "valuation_summary": "Trading at a discount to historical multiples relative to long-term secular growth rate."
            }
        elif schema_class == MarketPulseSchema:
            return {
                "market_condition": "BULLISH",
                "pulse_summary": "The broader market indices display robust momentum, led by mega-cap technology and healthcare stocks, supported by positive macroeconomic indicators.",
                "top_sectors": [
                    {
                        "sector": "Technology",
                        "performance": "Strong",
                        "outlook": "Sustained secular growth driven by enterprise software and AI investments."
                    },
                    {
                        "sector": "Consumer Discretionary",
                        "performance": "Stable",
                        "outlook": "Resilient consumer spend patterns supporting standard retail valuations."
                    }
                ],
                "market_drivers": [
                    "Cooling inflation reports bolstering monetary easing sentiment.",
                    "Strong corporate earnings season surpassing consensus beats."
                ],
                "macro_trends": [
                    "Evolving global supply routing policies.",
                    "Adoption of deep learning automation across traditional industries."
                ]
            }
        elif schema_class == PortfolioNarrativeSchema:
            return {
                "health_summary": "Your portfolio is broadly diversified across 8 sectors with 15 holdings. The IT & Software sector carries the heaviest weight at 32%, driven primarily by TCS and Infosys. Overall unrealised P&L is positive. No critical concentration alerts at this time.",
                "key_observations": [
                    "IT & Software is your largest sector allocation at 32% — consider monitoring for sector rotation risks.",
                    "Three holdings (TCS, INFY, RELIANCE) together account for over 45% of total portfolio value.",
                    "Financial Services sector provides healthy diversification at 22% with a mix of banks and NBFCs.",
                    "Small-cap exposure is limited to under 5%, reducing volatility risk."
                ],
                "concentration_warnings": [
                    "TCS alone accounts for 18% of the portfolio — above the recommended 15% single-stock threshold."
                ],
                "top_opportunities": [
                    "HDFCBANK: RSI at 45 — technically neutral, fundamentally strong with improving NIMs.",
                    "SUNPHARMA: Near 52-week high with positive earnings momentum in US generics."
                ],
                "watch_list": [
                    "WIPRO: RSI approaching overbought territory at 68, monitor for potential pullback.",
                    "INDUSINDBK: Trading near 52-week low — watch for signs of reversal or further weakness."
                ],
                "sentiment": "BALANCED"
            }
        return {}

    def generate_portfolio_narrative(self, analysis_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate a plain-English AI narrative summary for a portfolio.
        Uses the same cached pattern as generate_rich_market_pulse.
        """
        summary = analysis_data.get("summary", {})
        holdings = analysis_data.get("holdings", [])[:10]  # Top 10 by weight
        sector_alloc = analysis_data.get("sector_allocation", [])
        conc_flags = analysis_data.get("concentration_flags", [])
        div_score = analysis_data.get("diversification_score", "N/A")

        # Build concise holdings table for the prompt
        holdings_text = "\n".join([
            f"  - {h.get('name', h.get('symbol'))}: weight {h.get('weight_pct', 0):.1f}%, "
            f"P&L {h.get('pnl_pct', 'N/A')}%, RSI {h.get('rsi', 'N/A')}, "
            f"sector: {h.get('sector', 'N/A')}"
            for h in holdings
        ])

        sector_text = "\n".join([
            f"  - {s['sector']}: {s['weight_pct']:.1f}%"
            for s in sector_alloc[:6]
        ])

        conc_text = "\n".join([
            f"  - {c['type'].upper()}: {c['label']} at {c['weight']:.1f}% (threshold: {c['threshold']}%)"
            for c in conc_flags
        ]) or "  None detected."

        prompt = f"""
You are a portfolio analyst reviewing an Indian equity portfolio for a retail investor.
Provide a structured JSON analysis based on the data below.

PORTFOLIO SUMMARY:
- Total invested: ₹{summary.get('total_invested', 0):,.0f}
- Current value:  ₹{summary.get('total_current', 0):,.0f}
- Total P&L:      ₹{summary.get('total_pnl_abs', 0):,.0f} ({summary.get('total_pnl_pct', 0):.2f}%)
- Holdings count: {summary.get('num_holdings', 0)}
- Sectors:        {summary.get('num_sectors', 0)}
- Diversification score: {div_score}/100 (higher = more diversified)

TOP HOLDINGS (by weight):
{holdings_text}

SECTOR ALLOCATION:
{sector_text}

CONCENTRATION ALERTS:
{conc_text}

Write in plain, conversational English suitable for a retail investor.
Be specific — mention actual stock names and percentages from the data.
Keep health_summary to 80-120 words.
Do NOT fabricate data not present above.
"""
        return self._call_gemini(prompt, PortfolioNarrativeSchema)


gemini_service = GeminiService()
