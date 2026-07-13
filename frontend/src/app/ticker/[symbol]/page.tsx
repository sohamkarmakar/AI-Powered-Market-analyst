"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import SentimentGauge from "@/components/SentimentGauge";
import SearchAutocomplete from "@/components/SearchAutocomplete";
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Info,
  Brain,
  Sparkles,
  Newspaper,
  Terminal,
  Activity
} from "lucide-react";

export default function TickerDeepDivePage() {
  const router = useRouter();
  const params = useParams();
  const symbol = (params.symbol as string || "AAPL").toUpperCase();

  const [tickerInfo, setTickerInfo] = useState<any>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [indicators, setIndicators] = useState<any[]>([]);
  const [orbSignal, setOrbSignal] = useState<any>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  
  const [loading, setLoading] = useState(true);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);
  const [timeframe, setTimeframe] = useState("1y");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Sync data fetch pipeline
  const loadData = async (currentTimeframe = timeframe, triggerGenerate = false) => {
    setLoading(true);
    setErrorNotice(null);
    setConnectionError(null);
    try {
      // 1. Fetch main stock profile info (price, fundamentals, news)
      const tickerRes = await fetch(`http://127.0.0.1:8000/api/ticker/${symbol}?period=${currentTimeframe}`);
      if (!tickerRes.ok) throw new Error(`Ticker profile fetch failed with status ${tickerRes.status}`);
      const tickerData = await tickerRes.json();
      setTickerInfo(tickerData.info);
      
      const cleanPrices = (tickerData.price_history || []).filter((p: any) => p && typeof p.close === "number");
      setPriceHistory(cleanPrices);

      // 2. Fetch technical indicators (EMA, RSI, VWAP, ORB)
      const indicatorRes = await fetch(`http://127.0.0.1:8000/api/ticker/${symbol}/indicators?period=${currentTimeframe}`);
      if (indicatorRes.ok) {
        const indicatorData = await indicatorRes.json();
        const cleanIndicators = (indicatorData.indicators || []).filter((p: any) => p && typeof p.close === "number");
        setIndicators(cleanIndicators);
        setOrbSignal(indicatorData.orb_signal);
      }

      // 3. Fetch Cached Gemini AI research note (or run generate)
      const analysisUrl = triggerGenerate 
        ? `http://127.0.0.1:8000/api/ticker/${symbol}/analysis/generate`
        : `http://127.0.0.1:8000/api/ticker/${symbol}/analysis`;
        
      const analysisMethod = triggerGenerate ? "POST" : "GET";
      
      const analysisRes = await fetch(analysisUrl, { method: analysisMethod });
      if (analysisRes.ok) {
        const analysisData = await analysisRes.json();
        setAiAnalysis(analysisData);
      } else {
        setAiAnalysis(null); // Not generated yet
      }
      
      setUsingMock(false);
    } catch (err: any) {
      console.warn("Backend connection failed; falling back to offline demo mode:", err.message);
      setConnectionError(err.message);
      setUsingMock(true);
      // Mock fallback data for a premium dashboard feel
      setTickerInfo({
        symbol: symbol,
        name: symbol === "AAPL" ? "Apple Inc." : symbol === "TSLA" ? "Tesla Inc." : `${symbol} Corporation`,
        sector: symbol === "AAPL" ? "Technology" : symbol === "TSLA" ? "Consumer Cyclical" : "General Business",
        industry: symbol === "AAPL" ? "Consumer Electronics" : symbol === "TSLA" ? "Auto Manufacturers" : "Diversified",
        market_cap: 3450000000000,
        pe_ratio: 32.45,
        description: "Simulated offline preview mode. Start your FastAPI server on port 8000 to enable live financial APIs."
      });
      
      // Generating mock prices
      const mockLength = currentTimeframe === "1mo" ? 20 : currentTimeframe === "3mo" ? 60 : currentTimeframe === "6mo" ? 120 : 250;
      const mockPrices = Array.from({ length: mockLength }, (_, idx) => {
        const base = symbol === "AAPL" ? 220 : symbol === "TSLA" ? 180 : 100;
        const trend = idx * 0.4;
        const randomFactor = Math.sin(idx / 5) * 8 + Math.cos(idx / 2) * 3;
        const price = base + trend + randomFactor;
        return {
          date: new Date(Date.now() - (mockLength - idx) * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          close: price,
          open: price - 1.2,
          high: price + 2.5,
          low: price - 1.8,
          volume: 24000000 + Math.floor(Math.random() * 5000000),
          ema20: price - 3,
          ema50: price - 8,
          vwap: price - 5
        };
      });
      setPriceHistory(mockPrices);
      setIndicators(mockPrices);
      setOrbSignal({
        signal: "BULLISH_BREAKOUT",
        opening_high: 224.5,
        opening_low: 218.4,
        latest_price: 226.8,
        reason: "Evaluated latest price against range (Offline)"
      });
      setAiAnalysis({
        news_summary: {
          overall_sentiment: "BULLISH",
          sentiment_score: 0.72,
          key_themes: ["Strong cloud adoption", "New hardware release"],
          summary_points: [
            "Institutional analysts upgrade stock target price due to services expansion.",
            "Record hardware device shipments reported in the Asian supplier network."
          ]
        },
        research_note: {
          recommendation: "BUY",
          target_price: 245.0,
          investment_thesis: "The asset showcases strong pricing power and recurring subscription growth, compensating for core device cycles.",
          key_catalysts: ["Upcoming developer event in Q3.", "Services margins expanding to all-time highs."],
          key_risks: ["Regulatory supply bottlenecks.", "Antitrust litigation in primary app store platforms."],
          valuation_summary: "Trading at 28x forward earnings, representing historical value against compounding ROIC."
        }
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(timeframe);
  }, [symbol, timeframe]);

  const handleGenerateResearch = async () => {
    setGeneratingAi(true);
    setErrorNotice(null);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/ticker/${symbol}/analysis/generate`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to connect to Gemini API. Check your key in backend/.env.");
      }
      const data = await res.json();
      setAiAnalysis(data);
    } catch (err: any) {
      setErrorNotice(err.message);
    } finally {
      setGeneratingAi(false);
    }
  };

  // Compute percentage price changes
  const priceStats = useMemo(() => {
    if (priceHistory.length < 2) return { price: 0, change: 0, changePercent: 0 };
    const latest = priceHistory[priceHistory.length - 1].close;
    const prev = priceHistory[priceHistory.length - 2].close;
    const change = latest - prev;
    const changePercent = (change / prev) * 100;
    return { price: latest, change, changePercent };
  }, [priceHistory]);

  const currentRsi = useMemo(() => {
    if (indicators.length === 0) return null;
    const latest = indicators[indicators.length - 1];
    return latest && typeof latest.rsi === "number" ? parseFloat(latest.rsi.toFixed(1)) : null;
  }, [indicators]);

  return (
    <div className="p-8 space-y-8 flex-1">
      {/* Top Search Bar & Page Title Row */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Ticker Deep-Dive</h2>
          <p className="text-sm text-gray-500 font-mono">INDIVIDUAL EQUITY ANALYSIS TERMINAL</p>
        </div>

        {/* Search input Autocomplete */}
        <div className="w-full md:w-80">
          <SearchAutocomplete
            placeholder="Search symbol (e.g. AAPL, TSLA)..."
            initialValue={symbol}
            onSelect={(sym) => router.push(`/ticker/${sym}`)}
          />
        </div>
      </div>

      {/* Connection Notice if displaying Mock data */}
      {usingMock && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl p-4 flex items-start space-x-3 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Displaying Offline Demo Data:</span> Backend API server is currently unreachable. Start your FastAPI server on port 8000. {connectionError && <span className="font-mono text-[10px] block mt-1 text-blue-300">Detail: {connectionError}</span>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500 font-mono">Initializing Terminal Modules...</span>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Ticker Header Summary */}
          {tickerInfo && (
            <div className="glass-panel p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <div className="flex items-center space-x-3">
                  <h3 className="text-2xl font-mono font-bold text-white tracking-wide">{tickerInfo.symbol}</h3>
                  <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono uppercase">
                    {tickerInfo.industry}
                  </span>
                </div>
                <h4 className="text-sm text-gray-400 font-medium mt-1">{tickerInfo.name}</h4>
                <div className="flex space-x-1.5 mt-3">
                  {["1mo", "3mo", "6mo", "1y"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setTimeframe(p)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all duration-200 ${
                        timeframe === p
                          ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                          : "bg-slate-800/60 text-gray-400 hover:text-white"
                      }`}
                    >
                      {p === "1mo" ? "1M" : p === "3mo" ? "3M" : p === "6mo" ? "6M" : "1Y"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Metrics */}
              <div className="flex gap-8">
                <div className="text-right">
                  <div className="text-2xl font-mono font-bold text-white">
                    ${typeof priceStats.price === "number" ? priceStats.price.toFixed(2) : "N/A"}
                  </div>
                  <div className={`flex items-center text-xs font-mono font-semibold justify-end mt-1 ${
                    priceStats.change >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {priceStats.change >= 0 ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                    {priceStats.change >= 0 ? "+" : ""}{typeof priceStats.change === "number" ? priceStats.change.toFixed(2) : "0.00"} ({typeof priceStats.changePercent === "number" ? priceStats.changePercent.toFixed(2) : "0.00"}%)
                  </div>
                </div>

                <div className="text-right border-l border-[rgba(255,255,255,0.06)] pl-8">
                  <div className="text-sm font-mono font-bold text-white">
                    {typeof tickerInfo.market_cap === "number" ? `$${(tickerInfo.market_cap / 1e12).toFixed(2)}T` : "N/A"}
                  </div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-mono mt-1">Market Cap</p>
                </div>

                <div className="text-right border-l border-[rgba(255,255,255,0.06)] pl-8">
                  <div className="text-sm font-mono font-bold text-white">
                    {typeof tickerInfo.pe_ratio === "number" ? tickerInfo.pe_ratio.toFixed(2) : "N/A"}
                  </div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-mono mt-1">P/E Ratio</p>
                </div>
              </div>
            </div>
          )}

          {/* Primary Layout Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Chart Area */}
            <div className="lg:col-span-8 min-h-[400px]">
              <PriceChart data={priceHistory} />
            </div>

            {/* Indicator Details & Sentiment Sidebar */}
            <div className="lg:col-span-4 space-y-8">
              {/* Sentiment Card */}
              <div className="glass-panel p-6">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-[rgba(255,255,255,0.06)] pb-3 mb-4 font-mono flex items-center">
                  <Brain className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                  Gemini News Sentiment
                </h4>
                {aiAnalysis && aiAnalysis.news_summary ? (
                  <SentimentGauge 
                    score={aiAnalysis.news_summary.sentiment_score} 
                    sentimentText={aiAnalysis.news_summary.overall_sentiment}
                  />
                ) : (
                  <div className="py-10 text-center flex flex-col items-center justify-center space-y-2">
                    <Activity className="w-8 h-8 text-gray-700 animate-pulse" />
                    <span className="text-xs text-gray-500 font-mono">No sentiment data cached</span>
                  </div>
                )}
              </div>

              {/* Technical Indicator Status Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* RSI Status */}
                <div className="glass-panel p-4 flex flex-col justify-between">
                  <span className="text-[9px] text-gray-500 uppercase tracking-widest font-mono">RSI (14)</span>
                  <div className="mt-4">
                    <div className="text-xl font-mono font-bold text-white">{currentRsi ?? "N/A"}</div>
                    <span className={`text-[10px] font-mono font-bold mt-1 inline-block ${
                      currentRsi && currentRsi > 70 ? "text-rose-400" :
                      currentRsi && currentRsi < 30 ? "text-emerald-400" : "text-slate-400"
                    }`}>
                      {currentRsi && currentRsi > 70 ? "OVERBOUGHT" :
                       currentRsi && currentRsi < 30 ? "OVERSOLD" : "NEUTRAL"}
                    </span>
                  </div>
                </div>

                {/* ORB Status */}
                <div className="glass-panel p-4 flex flex-col justify-between">
                  <span className="text-[9px] text-gray-500 uppercase tracking-widest font-mono">ORB Signal</span>
                  <div className="mt-4">
                    <div className={`text-xs font-bold leading-tight ${
                      orbSignal && orbSignal.signal === "BULLISH_BREAKOUT" ? "text-emerald-400" :
                      orbSignal && orbSignal.signal === "BEARISH_BREAKOUT" ? "text-rose-400" :
                      "text-slate-400"
                    }`}>
                      {orbSignal ? orbSignal.signal.replace("_", " ") : "NO DATA"}
                    </div>
                    <span className="text-[8px] text-gray-500 font-mono uppercase mt-1 inline-block">
                      30M Range Breakout
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Research Note and News Feed Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* AI Research Note Panel */}
            <div className="lg:col-span-8">
              <div className="glass-panel p-6 h-full space-y-6">
                <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] pb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/15 flex items-center justify-center">
                      <Brain className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">AI Equity Research Note</h3>
                      <p className="text-[10px] text-gray-500 font-mono">GEMINI ANALYST EVALUATION</p>
                    </div>
                  </div>

                  {aiAnalysis && aiAnalysis.research_note && (
                    <div className={`font-mono font-bold text-xs px-3 py-1 rounded-lg border ${
                      aiAnalysis.research_note.recommendation === "BUY" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                      aiAnalysis.research_note.recommendation === "SELL" ? "bg-rose-500/10 text-rose-400 border-rose-500/25" :
                      "bg-slate-500/10 text-slate-400 border-slate-500/25"
                    }`}>
                      REC: {aiAnalysis.research_note.recommendation} | TARGET: ${aiAnalysis.research_note.target_price}
                    </div>
                  )}
                </div>

                {errorNotice && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl p-4 text-xs font-mono">
                    Error generating report: {errorNotice}
                  </div>
                )}

                {generatingAi ? (
                  <div className="py-20 flex flex-col items-center justify-center space-y-3">
                    <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-gray-400 font-mono animate-pulse">Gemini 2.5 Flash is compiling research data...</span>
                  </div>
                ) : aiAnalysis && aiAnalysis.research_note ? (
                  <div className="space-y-6 text-sm">
                    {/* Investment Thesis */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest font-mono">Investment Thesis</h4>
                      <p className="text-xs text-slate-300 leading-relaxed font-sans">{aiAnalysis.research_note.investment_thesis}</p>
                    </div>

                    {/* Catalysts & Risks */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest font-mono flex items-center">
                          <Sparkles className="w-3.5 h-3.5 mr-1" />
                          Key Catalysts
                        </h4>
                        <ul className="space-y-1.5 text-xs text-slate-300">
                          {aiAnalysis.research_note.key_catalysts.map((cat: string, idx: number) => (
                            <li key={idx} className="flex items-start">
                              <span className="text-emerald-500 mr-2">•</span>
                              <span>{cat}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-rose-400 uppercase tracking-widest font-mono flex items-center">
                          <Terminal className="w-3.5 h-3.5 mr-1" />
                          Key Risks
                        </h4>
                        <ul className="space-y-1.5 text-xs text-slate-300">
                          {aiAnalysis.research_note.key_risks.map((risk: string, idx: number) => (
                            <li key={idx} className="flex items-start">
                              <span className="text-rose-500 mr-2">•</span>
                              <span>{risk}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Valuation summary */}
                    <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-4">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest font-mono">Valuation & Metrics</h4>
                      <p className="text-xs text-slate-400 leading-relaxed font-sans">{aiAnalysis.research_note.valuation_summary}</p>
                    </div>
                  </div>
                ) : (
                  <div className="py-16 text-center flex flex-col items-center justify-center space-y-4">
                    <Brain className="w-12 h-12 text-gray-700 animate-bounce" />
                    <div>
                      <h4 className="text-xs font-bold text-white font-mono">No AI Analysis cached in Supabase</h4>
                      <p className="text-[11px] text-gray-500 mt-1 max-w-sm mx-auto">
                        Execute a live prompt run on Gemini to fetch news summaries, sentiment weights, and investment notes.
                      </p>
                    </div>
                    
                    <button
                      onClick={handleGenerateResearch}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs tracking-wide cursor-pointer transition-all duration-200 shadow-lg shadow-blue-500/20"
                    >
                      Generate Research with Gemini
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* News Articles Feed */}
            <div className="lg:col-span-4">
              <div className="glass-panel p-6 h-full flex flex-col">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-[rgba(255,255,255,0.06)] pb-3 mb-4 font-mono flex items-center">
                  <Newspaper className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                  Recent Headlines
                </h4>

                <div className="space-y-4 overflow-y-auto flex-1 max-h-[400px] pr-1">
                  {aiAnalysis && aiAnalysis.news_summary ? (
                    <div className="mb-4 bg-blue-500/5 rounded-xl p-3 border border-blue-500/10">
                      <span className="text-[9px] font-mono font-bold text-blue-400 uppercase tracking-wider">AI news theme</span>
                      <p className="text-[11px] text-slate-300 mt-1 font-sans">
                        {aiAnalysis.news_summary.key_themes.join(", ")}
                      </p>
                    </div>
                  ) : null}

                  {tickerInfo && tickerInfo.symbol && (
                    // We pull from the direct yfinance fetched data, but let's assume we store it on page load in news state
                    // News array was retrieved under the API call
                    // For safety, let's render a fallback news feed list from the cache or print placeholders
                    <div className="space-y-3">
                      {aiAnalysis && aiAnalysis.news_summary ? (
                        aiAnalysis.news_summary.summary_points.map((point: string, idx: number) => (
                          <div key={idx} className="bg-black/20 rounded-xl p-3 border border-white/[0.02]">
                            <div className="text-[11px] text-slate-300 font-sans leading-relaxed">{point}</div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-gray-500 font-mono text-center py-10">
                          Sync stock to populate news articles.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
