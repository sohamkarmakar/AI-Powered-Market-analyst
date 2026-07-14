"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import SectorHeatmap from "@/components/SectorHeatmap";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { useTheme } from "@/components/ThemeContext";
import Link from "next/link";
import {
  Globe,
  TrendingUp,
  TrendingDown,
  Info,
  RefreshCw,
  Layers,
  Cpu,
  ArrowUpRight,
  ArrowDownRight,
  BarChart2,
  Clock,
  Wifi,
  WifiOff,
} from "lucide-react";

interface IndexQuote {
  label: string;
  symbol: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
}

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
  macro_trends?: string[];
}

const API = "http://127.0.0.1:8000";

const FALLBACK_PULSE: MarketPulseData = {
  market_condition: "BULLISH",
  pulse_summary:
    "The Indian stock market exhibits strong bullish momentum, with NIFTY 50 and SENSEX hitting near-record highs led by IT services expansion and robust domestic credit growth in Financial Services.",
  top_sectors: [
    {
      sector: "IT & Software Services",
      performance: "Strong",
      outlook:
        "Strong pipeline in cloud and digital transformations driving major service exports.",
    },
    {
      sector: "Financial Services",
      performance: "Stable",
      outlook:
        "Robust credit growth and improving net interest margins supporting corporate banks.",
    },
    {
      sector: "Energy & Power",
      performance: "Strong",
      outlook:
        "Green energy capital expenditures driving infrastructure and utility valuations.",
    },
  ],
  market_drivers: [
    "Strong domestic institutional investor (DII) inflows supporting market valuations.",
    "Optimistic GDP growth projections by the Reserve Bank of India.",
    "Cooling inflation reports enabling repo rate easing sentiment.",
  ],
  macro_trends: [
    "Increasing financialization of household savings in India.",
    "Digital public infrastructure driving efficiency across banking and retail sectors.",
  ],
};

const StockTable = ({ title, data, type }: { title: string; data: any[]; type: "gainers" | "losers" | "active" }) => {
  return (
    <div className="glass-panel p-5 space-y-4 flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between border-b border-border-primary pb-3 mb-2">
          <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">{title}</h3>
          <span className="text-[10px] text-text-muted font-mono">NSE LIVE</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="text-text-muted border-b border-border-subtle pb-2">
                <th className="pb-2 font-normal">Symbol</th>
                <th className="pb-2 text-right font-normal">Price</th>
                <th className="pb-2 text-right font-normal">{type === "active" ? "Volume" : "Change"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-text-muted font-sans">Fetching live data...</td>
                </tr>
              ) : (
                data.map((stock) => {
                  const isGain = stock.change_pct >= 0;
                  return (
                    <tr key={stock.symbol} className="hover:bg-bg-tertiary transition-colors duration-150">
                      <td className="py-2.5">
                        <a
                          href={`/ticker/${stock.symbol}`}
                          className="text-accent-primary hover:text-accent-primary/80 font-bold transition-colors"
                        >
                          {stock.symbol}
                        </a>
                        <span className="block text-[9px] text-text-muted truncate max-w-[120px]">{stock.name}</span>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-text-primary">
                        ₹{stock.price ? stock.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "–"}
                      </td>
                      <td className={`py-2.5 text-right font-bold ${
                        type === "active" ? "text-text-secondary" : isGain ? "text-positive" : "text-negative"
                      }`}>
                        {type === "active" ? (
                          <span>{(stock.volume / 1000000).toFixed(2)}M</span>
                        ) : (
                          <span className="inline-flex items-center">
                            {isGain ? "+" : ""}{stock.change_pct.toFixed(2)}%
                            {isGain ? (
                              <ArrowUpRight className="w-3 h-3 ml-0.5 text-positive" />
                            ) : (
                              <ArrowDownRight className="w-3 h-3 ml-0.5 text-negative" />
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default function MarketOverviewPage() {
  const { theme } = useTheme();
  const [pulse, setPulse] = useState<MarketPulseData | null>(null);
  const [pulseCreatedAt, setPulseCreatedAt] = useState<Date | null>(null);
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [tapeData, setTapeData] = useState<any[]>([]);
  const [gainers, setGainers] = useState<any[]>([]);
  const [losers, setLosers] = useState<any[]>([]);
  const [active, setActive] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [regeneratingPulse, setRegeneratingPulse] = useState(false);
  const [indicesLoading, setIndicesLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [online, setOnline] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const indexPollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Fetch indices live ──────────────────────────────
  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/indices`);
      if (!res.ok) throw new Error("Indices fetch failed");
      const data = await res.json();
      setIndices(data.indices || []);
      setOnline(true);
      setLastUpdated(new Date());
    } catch {
      setOnline(false);
    } finally {
      setIndicesLoading(false);
    }
  }, []);

  // ── Fetch global ticker tape ────────────────────────
  const fetchTickerTape = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/market/ticker-tape`);
      if (res.ok) {
        const data = await res.json();
        setTapeData(data.tape || []);
      }
    } catch (e) {
      console.error("Failed to fetch ticker tape:", e);
    }
  }, []);

  // ── Fetch top gainers/losers/active ─────────────────
  const fetchGainersLosers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/market/gainers-losers`);
      if (res.ok) {
        const data = await res.json();
        setGainers(data.gainers || []);
        setLosers(data.losers || []);
        setActive(data.active || []);
      }
    } catch (e) {
      console.error("Failed to fetch gainers/losers:", e);
    }
  }, []);

  // ── Fetch AI market pulse ───────────────────────────
  const fetchPulse = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/market/pulse`);
      if (!res.ok) throw new Error("No cached pulse");
      const data = await res.json();
      if (data.pulse_data) {
        setPulse(data.pulse_data);
        if (data.created_at) {
          setPulseCreatedAt(new Date(data.created_at));
        }
      } else {
        setPulse(data);
      }
      setUsingMock(false);
    } catch {
      setPulse(FALLBACK_PULSE);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Manual AI Briefing regeneration ────────────────
  const handleRegeneratePulse = async () => {
    setRegeneratingPulse(true);
    try {
      const res = await fetch(`${API}/api/market/pulse/generate`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Regeneration failed");
      const data = await res.json();
      if (data.pulse_data) {
        setPulse(data.pulse_data);
        setPulseCreatedAt(new Date());
        setUsingMock(false);
      }
    } catch (err) {
      console.error("Failed to regenerate AI Briefing:", err);
    } finally {
      setRegeneratingPulse(false);
    }
  };

  // ── Manual refresh ──────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchIndices(), fetchPulse(), fetchTickerTape(), fetchGainersLosers()]);
    setRefreshing(false);
  }, [fetchIndices, fetchPulse, fetchTickerTape, fetchGainersLosers]);

  useEffect(() => {
    setMounted(true);
    fetchIndices();
    fetchPulse();
    fetchTickerTape();
    fetchGainersLosers();
    // Auto-refresh live data every 10s
    indexPollRef.current = setInterval(() => {
      fetchIndices();
      fetchTickerTape();
      fetchGainersLosers();
    }, 10000);
    return () => {
      if (indexPollRef.current) clearInterval(indexPollRef.current);
    };
  }, [fetchIndices, fetchPulse, fetchTickerTape, fetchGainersLosers]);

  // ── Market hours status ─────────────────────────────
  const getMarketStatus = () => {
    if (!mounted) return null;
    const now = new Date();
    const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const h = ist.getHours(), m = ist.getMinutes();
    const mins = h * 60 + m;
    const day = ist.getDay();
    if (day === 0 || day === 6)
      return { label: "Market Closed", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", dot: "bg-red-400" };
    if (mins < 9 * 60 + 15)
      return { label: "Pre-Open", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400" };
    if (mins <= 15 * 60 + 30)
      return { label: "NSE Open", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" };
    return { label: "Market Closed", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", dot: "bg-red-400" };
  };
  const mktStatus = getMarketStatus();

  return (
    <div className="p-6 space-y-6 flex-1">
      {/* ── Global Ticker Tape ────────────────────────── */}
      {tapeData && tapeData.length > 0 && (
        <div
          className="w-full rounded-2xl overflow-hidden py-2.5 px-4 relative flex items-center shadow-lg backdrop-blur-md"
          style={{ background: "var(--tape-bg)", border: "1px solid var(--tape-border)" }}
        >
          <style>{`
            @keyframes marquee {
              0% { transform: translateX(0%); }
              100% { transform: translateX(-50%); }
            }
            .animate-marquee {
              display: inline-flex;
              white-space: nowrap;
              animation: marquee 25s linear infinite;
            }
            .animate-marquee:hover {
              animation-play-state: paused;
            }
          `}</style>
          <div className="flex w-full overflow-hidden">
            <div className="animate-marquee gap-8 pr-8 flex">
              {tapeData.map((item, idx) => {
                const up = (item.change_pct ?? 0) >= 0;
                return (
                  <div key={idx} className="inline-flex items-center space-x-2 text-xs font-mono select-none">
                    <span className="text-text-muted font-semibold uppercase">{item.label}</span>
                    <span className="text-text-primary font-bold">
                      {item.label.includes("USD") ? `₹${item.price?.toFixed(2)}` : item.label.includes("GOLD") || item.label.includes("CRUDE") ? `$${item.price?.toFixed(2)}` : item.price?.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                    <span className={`inline-flex items-center font-bold ${up ? "text-positive" : "text-negative"}`}>
                      {up ? "+" : ""}{item.change_pct?.toFixed(2)}%
                      {up ? <ArrowUpRight className="w-3 h-3 ml-0.5" /> : <ArrowDownRight className="w-3 h-3 ml-0.5" />}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="animate-marquee gap-8 pr-8 flex" aria-hidden="true">
              {tapeData.map((item, idx) => {
                const up = (item.change_pct ?? 0) >= 0;
                return (
                  <div key={`dup-${idx}`} className="inline-flex items-center space-x-2 text-xs font-mono select-none">
                    <span className="text-text-muted font-semibold uppercase">{item.label}</span>
                    <span className="text-text-primary font-bold">
                      {item.label.includes("USD") ? `₹${item.price?.toFixed(2)}` : item.label.includes("GOLD") || item.label.includes("CRUDE") ? `$${item.price?.toFixed(2)}` : item.price?.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                    <span className={`inline-flex items-center font-bold ${up ? "text-positive" : "text-negative"}`}>
                      {up ? "+" : ""}{item.change_pct?.toFixed(2)}%
                      {up ? <ArrowUpRight className="w-3 h-3 ml-0.5" /> : <ArrowDownRight className="w-3 h-3 ml-0.5" />}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Page Header ─────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">Market Overview</h2>
          <p className="text-sm text-text-muted font-mono">INDIAN EQUITY HEALTH & LIVE MARKET DATA</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Market status pill */}
          {mktStatus && (
            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border border-border-primary text-xs font-mono font-semibold ${mktStatus.bg} ${mktStatus.color}`}>
              <span className={`relative flex h-2 w-2`}>
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${mktStatus.dot} opacity-75`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${mktStatus.dot}`} />
              </span>
              <span>{mktStatus.label}</span>
            </div>
          )}

          {/* Last updated */}
          {lastUpdated && mounted && (
            <div className="flex items-center space-x-1.5 text-[10px] font-mono text-text-muted">
              <Clock className="w-3 h-3" />
              <span>Updated {lastUpdated.toLocaleTimeString("en-IN")}</span>
            </div>
          )}

          {/* Theme switcher */}
          <ThemeSwitcher />

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center space-x-2 px-4 py-2 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/20 hover:border-accent-primary/40 text-accent-primary rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* ── Live Indices Bar ─────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {indicesLoading
          ? [1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-bg-tertiary border border-border-primary rounded-2xl animate-pulse" />
            ))
          : indices.map((idx) => {
              const up = (idx.change_pct ?? 0) >= 0;
              return (
                <Link
                  key={idx.symbol}
                  href={`/ticker/${encodeURIComponent(idx.symbol)}`}
                  className={`flex flex-col justify-between p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${
                    up
                      ? "bg-positive-bg border-positive/10 hover:border-positive/25 hover:shadow-lg hover:shadow-positive/10"
                      : "bg-negative-bg border-negative/10 hover:border-negative/25 hover:shadow-lg hover:shadow-negative/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">{idx.label}</span>
                    {up ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-positive" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-negative" />
                    )}
                  </div>
                  <div>
                    <div className="text-lg font-mono font-bold text-text-primary">
                      {idx.price ? idx.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "–"}
                    </div>
                    <div className={`text-xs font-mono font-semibold mt-0.5 ${up ? "text-positive" : "text-negative"}`}>
                      {idx.change_pct != null
                        ? `${up ? "+" : ""}${idx.change_pct.toFixed(2)}%`
                        : "–"}
                      {idx.change != null ? (
                        <span className="text-text-muted font-normal ml-1.5 opacity-80">
                          ({up ? "+" : ""}
                          {idx.change.toFixed(2)})
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
      </div>

      {/* ── Offline / mock notice ────────────────────── */}
      {usingMock && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl p-4 flex items-start space-x-3 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">AI Pulse: Offline Demo Mode.</span> No cached AI Market Pulse found in the database. Run{" "}
            <code className="font-mono bg-black/40 px-1 py-0.5 rounded">
              python backend/app/cron/daily_analysis.py
            </code>{" "}
            to generate a live Gemini report.
          </div>
        </div>
      )}

      {/* ── Main grid: Heatmap + Pulse ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sector Heatmap */}
        <div className="lg:col-span-7 h-full">
          <SectorHeatmap />
        </div>

        {/* AI Market Pulse panel */}
        <div className="lg:col-span-5 space-y-4">
          <div className="glass-panel p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-border-primary pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-accent-primary/15 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-accent-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">AI Market Pulse</h3>
                  <div className="flex flex-col">
                    <p className="text-[10px] text-text-muted font-mono">GEMINI GENERATIVE SYNTHESIS</p>
                    {pulseCreatedAt && (
                      <span className="text-[8px] text-text-muted font-mono">
                        Synced {pulseCreatedAt.toLocaleTimeString("en-IN")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleRegeneratePulse}
                  disabled={regeneratingPulse}
                  className="flex items-center space-x-1 px-2 py-1 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/20 text-accent-primary rounded-lg text-[9px] font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${regeneratingPulse ? "animate-spin" : ""}`} />
                  <span>{regeneratingPulse ? "Analyzing..." : "Analyze Live"}</span>
                </button>

                {pulse && (
                  <div
                    className={`flex items-center font-mono font-bold text-[10px] px-2 py-1 rounded-full border ${
                      pulse.market_condition === "BULLISH"
                        ? "bg-positive-bg text-positive border-positive/20"
                        : pulse.market_condition === "BEARISH"
                        ? "bg-negative-bg text-negative border-negative/20"
                        : "bg-neutral-bg text-neutral border-neutral/20"
                    }`}
                  >
                    {pulse.market_condition === "BULLISH" ? (
                      <TrendingUp className="w-3 h-3 mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 mr-1" />
                    )}
                    {pulse.market_condition}
                  </div>
                )}
              </div>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-text-muted font-mono">Analyzing Market Metrics...</span>
              </div>
            ) : pulse ? (
              <div className="space-y-5">
                <p className="text-xs text-text-secondary leading-relaxed font-sans">{pulse.pulse_summary}</p>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-text-muted uppercase tracking-widest flex items-center font-mono">
                    <Layers className="w-3.5 h-3.5 mr-1.5 text-accent-primary" />
                    Sector Outlook
                  </h4>
                  <div className="space-y-2">
                    {pulse.top_sectors.map((sec) => (
                      <div key={sec.sector} className="bg-bg-tertiary rounded-xl p-3 border border-border-primary">
                        <div className="flex justify-between items-center text-xs font-bold text-text-primary mb-1">
                          <span>{sec.sector}</span>
                          <span
                            className={`text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded-md ${
                              sec.performance === "Strong"
                                ? "bg-positive-bg text-positive"
                                : sec.performance === "Weak"
                                ? "bg-negative-bg text-negative"
                                : "bg-neutral-bg text-neutral"
                            }`}
                          >
                            {sec.performance}
                          </span>
                        </div>
                        <p className="text-[11px] text-text-secondary leading-relaxed font-sans">{sec.outlook}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-text-muted uppercase tracking-widest flex items-center font-mono">
                    <Cpu className="w-3.5 h-3.5 mr-1.5 text-accent-primary" />
                    Key Market Drivers
                  </h4>
                  <ul className="space-y-1.5">
                    {pulse.market_drivers.map((driver, idx) => (
                      <li key={idx} className="flex items-start text-xs text-text-secondary leading-relaxed">
                        <span className="text-accent-primary font-bold font-mono mr-2">{idx + 1}.</span>
                        <span>{driver}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {pulse.macro_trends && pulse.macro_trends.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-text-muted uppercase tracking-widest flex items-center font-mono">
                      <BarChart2 className="w-3.5 h-3.5 mr-1.5 text-accent-primary" />
                      Macro Trends
                    </h4>
                    <ul className="space-y-1.5">
                      {pulse.macro_trends.map((t, i) => (
                        <li key={i} className="flex items-start text-xs text-text-secondary leading-relaxed">
                          <span className="text-text-muted font-mono mr-2">→</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Live status card */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-bg-secondary border border-border-primary text-[10px] font-mono">
            <div className="flex items-center space-x-2">
              {online ? (
                <>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-positive opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-positive" />
                  </span>
                  <span className="text-positive font-semibold">Live · Auto-refresh 10s</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-negative" />
                  <span className="text-negative font-semibold">Offline</span>
                </>
              )}
            </div>
            <span className="text-text-muted">Yahoo Finance API · NSE/BSE</span>
          </div>
        </div>
      </div>

      {/* ── Top Gainers / Losers / Active Section ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <StockTable title="Top Gainers" data={gainers} type="gainers" />
        <StockTable title="Top Losers" data={losers} type="losers" />
        <StockTable title="Most Active by Volume" data={active} type="active" />
      </div>
    </div>
  );
}
