"use client";

import { useState, useEffect } from "react";
import SectorHeatmap from "@/components/SectorHeatmap";
import { 
  Globe, 
  TrendingUp, 
  TrendingDown, 
  Info,
  Calendar,
  Layers,
  Cpu
} from "lucide-react";

interface SectorOutlook {
  sector: string;
  performance: string;
  outlook: string;
}

interface MarketPulseData {
  market_condition: string;
  pulse_summary: string;
  top_sectors: SectorOutlook[];
  market_drivers: string[];
  macro_trends: string[];
}

export default function MarketOverviewPage() {
  const [pulse, setPulse] = useState<MarketPulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [syncTime, setSyncTime] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    async function fetchMarketPulse() {
      try {
        const res = await fetch("http://127.0.0.1:8000/api/market/pulse");
        if (!res.ok) {
          throw new Error("No cached pulse found in database");
        }
        const data = await res.json();
        // Supabase stores it nested in 'pulse_data'
        setPulse(data.pulse_data || data);
        if (data.created_at) {
          setSyncTime(data.created_at);
        }
        setUsingMock(false);
      } catch (err: any) {
        setError(err.message);
        // Fallback mock data if server/DB is not active yet
        setPulse({
          market_condition: "BULLISH",
          pulse_summary: "The Indian stock market exhibits strong bullish momentum, with NIFTY 50 and SENSEX hitting near-record highs led by IT services expansion and robust domestic credit growth in Financial Services.",
          top_sectors: [
            {
              sector: "IT & Software Services",
              performance: "Strong",
              outlook: "Strong pipeline in cloud and digital transformations driving major service exports."
            },
            {
              sector: "Financial Services",
              performance: "Stable",
              outlook: "Robust credit growth and improving net interest margins supporting corporate banks."
            },
            {
              sector: "Energy & Power",
              performance: "Strong",
              outlook: "Green energy capital expenditures driving infrastructure and utility valuations."
            }
          ],
          market_drivers: [
            "Strong domestic institutional investor (DII) inflows supporting market valuations.",
            "Optimistic GDP growth projections by the Reserve Bank of India.",
            "Cooling inflation reports enabling repo rate easing sentiment."
          ],
          macro_trends: [
            "Increasing financialization of household savings in India.",
            "Digital public infrastructure driving efficiency across banking and retail sectors."
          ]
        });
        setUsingMock(true);
      } finally {
        setLoading(false);
      }
    }
    fetchMarketPulse();
  }, []);

  return (
    <div className="p-8 space-y-8 flex-1">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Market Overview</h2>
          <p className="text-sm text-gray-500 font-mono">GLOBAL EQUITY HEALTH & AI INSIGHTS</p>
        </div>
        <div className="flex items-center space-x-3 text-xs bg-[#0c1020]/80 border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-2 text-gray-400 font-mono">
          <Calendar className="w-3.5 h-3.5 mr-1" />
          <span>
            Latest Sync: {mounted 
              ? (syncTime 
                ? new Date(syncTime).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) 
                : new Date().toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) 
              : "Loading..."}
          </span>
        </div>
      </div>

      {/* Connection Notice if displaying Mock data */}
      {usingMock && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl p-4 flex items-start space-x-3 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Displaying Offline Demo Data:</span> No cached AI Market Pulse was found in the database. Run the daily analysis cron job script (<code className="font-mono bg-black/40 px-1 py-0.5 rounded">python backend/app/cron/daily_analysis.py</code>) with tracked tickers in the database to generate a live Gemini report here.
          </div>
        </div>
      )}

      {/* Main Grid: Left Heatmap, Right Market Pulse */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Heatmap Area */}
        <div className="lg:col-span-7 h-full">
          <SectorHeatmap />
        </div>

        {/* AI Market Pulse Area */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-panel p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600/15 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">AI Market Pulse</h3>
                  <p className="text-[10px] text-gray-500 font-mono">GEMINI GENERATIVE SYNTHESIS</p>
                </div>
              </div>
              
              {/* Market Condition Badge */}
              {pulse && (
                <div className={`flex items-center font-mono font-bold text-xs px-2.5 py-1 rounded-full border ${
                  pulse.market_condition === "BULLISH" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  pulse.market_condition === "BEARISH" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                  "bg-slate-500/10 text-slate-400 border-slate-500/20"
                }`}>
                  {pulse.market_condition === "BULLISH" ? <TrendingUp className="w-3.5 h-3.5 mr-1" /> : <TrendingDown className="w-3.5 h-3.5 mr-1" />}
                  {pulse.market_condition}
                </div>
              )}
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-500 font-mono">Analyzing Portfolio Metrics...</span>
              </div>
            ) : pulse ? (
              <div className="space-y-6">
                {/* Summary narrative */}
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  {pulse.pulse_summary}
                </p>

                {/* Top Sector Outlook */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center font-mono">
                    <Layers className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                    Sector Outlook
                  </h4>
                  <div className="space-y-2">
                    {pulse.top_sectors.map((sec) => (
                      <div key={sec.sector} className="bg-black/20 rounded-xl p-3 border border-white/[0.02]">
                        <div className="flex justify-between items-center text-xs font-bold text-white mb-1">
                          <span>{sec.sector}</span>
                          <span className={`text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded-md ${
                            sec.performance === "Strong" ? "bg-emerald-500/10 text-emerald-400" :
                            sec.performance === "Weak" ? "bg-rose-500/10 text-rose-400" :
                            "bg-slate-500/10 text-slate-400"
                          }`}>
                            {sec.performance}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 leading-relaxed font-sans">{sec.outlook}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Core Market Drivers */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center font-mono">
                    <Cpu className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                    Key Market Drivers
                  </h4>
                  <ul className="space-y-1.5">
                    {pulse.market_drivers.map((driver, idx) => (
                      <li key={idx} className="flex items-start text-xs text-slate-300 leading-relaxed">
                        <span className="text-blue-500 font-bold font-mono mr-2">{idx + 1}.</span>
                        <span>{driver}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
