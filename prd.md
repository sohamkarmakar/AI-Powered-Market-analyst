# Product Requirements Document (PRD)

## 1. Product Vision
**Market Rover: AI Equity Hub** is an advanced, AI-powered web application designed for retail investors, day traders, and financial enthusiasts. The platform provides real-time market data, deep-dive ticker analysis, intraday screening, and intelligent portfolio management—all enriched by AI-driven narratives and insights.

## 2. Target Audience
- **Retail Investors:** Users looking for an easy way to track their portfolios and receive AI-generated insights on diversification and risk.
- **Day Traders:** Users relying on live, auto-refreshing market data, intraday screeners, and active alert feeds to capture market opportunities.
- **Financial Analysts:** Users who need quick, AI-summarized research notes on specific equities based on current news and historical price action.

## 3. Core Features

### 3.1. Market Overview
- **Indices Tracking:** Live tracking of major indices (NIFTY 50, SENSEX, BANK NIFTY).
- **Market Status:** Clear indicators for market phases (Pre-Open, Open, Closed).
- **Broad Market AI Pulse:** Daily AI-generated summaries covering macroeconomic events, sector performance, and market sentiment.

### 3.2. Portfolio Management
- **Dashboard:** Visual summary of invested value, current value, total P&L, and today's change.
- **Holdings Analysis:** Detailed breakdown of individual equity holdings, sector allocation, and market cap distribution via Recharts.
- **AI Portfolio Pulse:** An intelligent evaluation of the portfolio's concentration risk and diversification score, generating actionable insights.
- **Data Entry:** Support for manual ticker entry and CSV/XLSX broker uploads.

### 3.3. Ticker Deep-Dive
- **Comprehensive Data:** View real-time price, day high/low, 52-week metrics, volume, market cap, P/E ratio, and beta for individual tickers.
- **Interactive Charting:** Visual representation of historical price action.
- **AI Research Notes:** Dynamic, on-demand AI summaries fusing recent news and technical data to provide a holistic view of the equity.

### 3.4. Screener & Watchlist
- **Intraday Screener:** A live, auto-refreshing table (updates every 10s) tracking user-selected tickers for intraday momentum.
- **Custom Watchlists:** Create, save, and manage lists of interesting stocks.
- **Sparklines:** Mini inline SVG charts showing recent price trends at a glance.

### 3.5. Alerts Feed
- **System Notifications:** A centralized feed for application notifications, price alerts, and significant market shifts.

## 4. Non-Functional Requirements
- **Performance:** Live data components (Watchlist, Intraday Screener) must auto-refresh every 10 seconds without causing UI lag.
- **Responsiveness:** The layout must be fully responsive, utilizing a slide-in/out drawer for navigation on mobile devices and a unified TopBar.
- **Theming:** Support for multiple user-selectable themes (Light, Dark, Deep Blue).
- **AI Integration:** Seamless, non-blocking requests to the Google Gemini API to prevent UI freezes during narrative generation.
