"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import SearchAutocomplete from "@/components/SearchAutocomplete";
import {
  ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown,
  Activity, BarChart2, Newspaper, Users, Target,
  Brain, Sparkles, Terminal, Info, RefreshCw,
  LayoutDashboard, ChevronRight, ExternalLink, Calendar,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
  ComposedChart,
} from "recharts";

import { technicalRating, pivotPoints } from "@/utils/indicators";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Tab = "overview" | "technicals" | "fundamentals" | "financials" | "ownership" | "analyst" | "news";

const API = "http://127.0.0.1:8000";

const fmt = (v: number | null | undefined, dec = 2) =>
  v != null && isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "–";
const fmtCr = (v: number | null | undefined) =>
  v != null ? `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr` : "–";
const fmtPct = (v: number | null | undefined) =>
  v != null ? `${(v * 100).toFixed(2)}%` : "–";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white/[0.025] border border-white/[0.05] rounded-xl p-3">
      <p className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-sm font-mono font-bold ${color || "text-white"}`}>{value}</p>
      {sub && <p className="text-[9px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, badge }: { icon: any; title: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.05]">
      <div className="flex items-center space-x-2">
        <div className="w-6 h-6 rounded-lg bg-blue-600/15 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-blue-400" />
        </div>
        <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">{title}</h3>
      </div>
      {badge && <span className="text-[9px] font-mono text-gray-500 bg-white/[0.04] px-2 py-0.5 rounded-full border border-white/[0.05]">{badge}</span>}
    </div>
  );
}

function SignalBadge({ signal }: { signal: "BUY" | "SELL" | "NEUTRAL" }) {
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
      signal === "BUY" ? "bg-emerald-500/15 text-emerald-400" :
      signal === "SELL" ? "bg-rose-500/15 text-rose-400" :
      "bg-slate-500/15 text-slate-400"
    }`}>{signal}</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function TickerDeepDivePage() {
  const params = useParams();
  const router = useRouter();
  const symbol = ((params.symbol as string) || "RELIANCE").toUpperCase();

  // Core state
  const [tickerInfo, setTickerInfo] = useState<any>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [liveQuote, setLiveQuote] = useState<{ price: number; change: number | null; change_pct: number | null } | null>(null);
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);
  const [liveActive, setLiveActive] = useState(false);
  const [coreLoading, setCoreLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [fundamentals, setFundamentals] = useState<any>(null);
  const [earnings, setEarnings] = useState<any>(null);
  const [holders, setHolders] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any>(null);
  const [news, setNews] = useState<any[]>([]);
  const [peers, setPeers] = useState<any[]>([]);
  const [loadedTabs, setLoadedTabs] = useState<Set<Tab>>(new Set());
  const [tabLoading, setTabLoading] = useState(false);

  // Gemini AI
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [generatingAi, setGeneratingAi] = useState(false);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const lastPriceRef = useRef<number>(0);

  // ── Core data load ────────────────────────────────────────
  const loadCore = useCallback(async () => {
    setCoreLoading(true);
    try {
      const [tickerRes, analysisRes] = await Promise.allSettled([
        fetch(`${API}/api/ticker/${symbol}?period=1y`),
        fetch(`${API}/api/ticker/${symbol}/analysis`),
      ]);

      if (tickerRes.status === "fulfilled" && tickerRes.value.ok) {
        const data = await tickerRes.value.json();
        setTickerInfo(data.info);
        setPriceHistory((data.price_history || []).filter((p: any) => p && typeof p.close === "number"));
        setUsingMock(false);
      } else {
        setUsingMock(true);
      }

      if (analysisRes.status === "fulfilled" && analysisRes.value.ok) {
        setAiAnalysis(await analysisRes.value.json());
      }
    } catch {
      setUsingMock(true);
    } finally {
      setCoreLoading(false);
    }
  }, [symbol]);

  useEffect(() => { loadCore(); }, [loadCore]);

  // ── Live price polling ────────────────────────────────────
  const pollPrice = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/ticker/${symbol}/quote`);
      if (!res.ok) return;
      const q = await res.json();
      const p: number = q.price ?? 0;
      if (p > 0) {
        if (lastPriceRef.current && p !== lastPriceRef.current) {
          setPriceFlash(p > lastPriceRef.current ? "up" : "down");
          setTimeout(() => setPriceFlash(null), 800);
        }
        lastPriceRef.current = p;
        setLiveQuote({ price: p, change: q.change ?? null, change_pct: q.change_pct ?? null });
      }
    } catch { /* ignore */ }
  }, [symbol]);

  useEffect(() => {
    if (coreLoading || usingMock) { if (pollRef.current) clearInterval(pollRef.current); return; }
    setLiveActive(true);
    pollPrice();
    pollRef.current = setInterval(pollPrice, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [coreLoading, usingMock, pollPrice]);

  // ── Lazy tab data loading ─────────────────────────────────
  const loadTabData = useCallback(async (tab: Tab) => {
    if (loadedTabs.has(tab)) return;
    setTabLoading(true);
    try {
      if (tab === "fundamentals") {
        const [fRes, pRes] = await Promise.allSettled([
          fetch(`${API}/api/ticker/${symbol}/fundamentals`),
          fetch(`${API}/api/ticker/${symbol}/peers`),
        ]);
        if (fRes.status === "fulfilled" && fRes.value.ok) setFundamentals(await fRes.value.json());
        if (pRes.status === "fulfilled" && pRes.value.ok) setPeers((await pRes.value.json()).peers || []);
      }
      if (tab === "financials") {
        const res = await fetch(`${API}/api/ticker/${symbol}/earnings`);
        if (res.ok) setEarnings(await res.json());
      }
      if (tab === "ownership") {
        const res = await fetch(`${API}/api/ticker/${symbol}/holders`);
        if (res.ok) setHolders(await res.json());
      }
      if (tab === "analyst") {
        const res = await fetch(`${API}/api/ticker/${symbol}/recommendations`);
        if (res.ok) setRecommendations(await res.json());
      }
      if (tab === "news") {
        const res = await fetch(`${API}/api/ticker/${symbol}/news`);
        if (res.ok) setNews((await res.json()).news || []);
      }
      setLoadedTabs(prev => new Set([...prev, tab]));
    } catch { /* graceful */ }
    finally { setTabLoading(false); }
  }, [symbol, loadedTabs]);

  const handleTab = (tab: Tab) => {
    setActiveTab(tab);
    if (!loadedTabs.has(tab) && tab !== "overview" && tab !== "technicals") {
      loadTabData(tab);
    }
  };

  // ── Compute technical rating from price history ───────────
  const techRating = useMemo(() => {
    if (priceHistory.length < 20) return null;
    return technicalRating(
      priceHistory.map(d => d.close),
      priceHistory.map(d => d.high ?? d.close),
      priceHistory.map(d => d.low ?? d.close),
    );
  }, [priceHistory]);

  // ── Pivot points from last candle ─────────────────────────
  const pivots = useMemo(() => {
    if (priceHistory.length < 2) return null;
    const prev = priceHistory[priceHistory.length - 2];
    return pivotPoints(prev.high ?? prev.close, prev.low ?? prev.close, prev.close);
  }, [priceHistory]);

  // ── Price summary ─────────────────────────────────────────
  const price = liveQuote?.price ?? tickerInfo?.current_price ?? priceHistory[priceHistory.length - 1]?.close ?? 0;
  const change = liveQuote?.change ?? tickerInfo?.change ?? 0;
  const changePct = liveQuote?.change_pct ?? tickerInfo?.change_pct ?? 0;
  const isUp = changePct >= 0;

  const TABS: Array<{ id: Tab; label: string; icon: any }> = [
    { id: "overview",     label: "Overview",     icon: LayoutDashboard },
    { id: "technicals",   label: "Technicals",   icon: Activity },
    { id: "fundamentals", label: "Fundamentals", icon: BarChart2 },
    { id: "financials",   label: "Financials",   icon: TrendingUp },
    { id: "ownership",    label: "Ownership",    icon: Users },
    { id: "analyst",      label: "Analyst",      icon: Target },
    { id: "news",         label: "News & Research", icon: Newspaper },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      {/* ── Sticky Header ──────────────────────────────────── */}
      <div className="shrink-0 bg-[#060b18] border-b border-white/[0.05] px-6 pt-5 pb-0">
        {/* Search + symbol row */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
          <div>
            {coreLoading ? (
              <div className="h-7 w-48 bg-white/[0.04] rounded animate-pulse" />
            ) : (
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-xl font-mono font-bold text-white tracking-wide">
                  {tickerInfo?.symbol || symbol}
                </h2>
                {tickerInfo?.industry && (
                  <span className="text-[9px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-mono uppercase tracking-wider">
                    {tickerInfo.industry}
                  </span>
                )}
                {tickerInfo?.sector && (
                  <span className="text-[9px] bg-white/[0.04] text-gray-400 border border-white/[0.06] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider">
                    {tickerInfo.sector}
                  </span>
                )}
              </div>
            )}
            {tickerInfo?.name && <p className="text-xs text-gray-400 mt-0.5">{tickerInfo.name}</p>}
          </div>
          <div className="w-full md:w-72">
            <SearchAutocomplete
              placeholder="Search symbol…"
              initialValue={symbol}
              onSelect={(sym) => router.push(`/ticker/${sym}`)}
            />
          </div>
        </div>

        {/* Live price row */}
        {!coreLoading && price > 0 && (
          <div className="flex flex-wrap items-end gap-6 mb-4">
            <style>{`
              @keyframes flashUp { 0%{color:#10b981;text-shadow:0 0 12px rgba(16,185,129,.8)} 100%{color:white;text-shadow:none} }
              @keyframes flashDown { 0%{color:#ef4444;text-shadow:0 0 12px rgba(239,68,68,.8)} 100%{color:white;text-shadow:none} }
              .flash-up{animation:flashUp .8s ease-out forwards}
              .flash-down{animation:flashDown .8s ease-out forwards}
            `}</style>
            {/* Price */}
            <div>
              {liveActive && !usingMock && (
                <div className="flex items-center space-x-1 mb-0.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <span className="text-[9px] font-mono text-emerald-500 uppercase tracking-widest">Live · 10s</span>
                </div>
              )}
              <div className={`text-3xl font-mono font-bold transition-colors ${priceFlash === "up" ? "flash-up" : priceFlash === "down" ? "flash-down" : "text-white"}`}>
                ₹{fmt(price, 2)}
              </div>
              <div className={`flex items-center text-sm font-mono font-semibold mt-0.5 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                {isUp ? <ArrowUpRight className="w-4 h-4 mr-0.5" /> : <ArrowDownRight className="w-4 h-4 mr-0.5" />}
                {isUp ? "+" : ""}₹{fmt(Math.abs(change), 2)} ({isUp ? "+" : ""}{fmt(Math.abs(changePct), 2)}%)
              </div>
            </div>

            {/* Key stats row */}
            <div className="flex flex-wrap gap-4 text-right">
              {[
                { l: "Market Cap",  v: fmtCr(tickerInfo?.market_cap) },
                { l: "P/E (TTM)",   v: tickerInfo?.pe_ratio ? fmt(tickerInfo.pe_ratio, 1) : "–" },
                { l: "52W High",    v: tickerInfo?.year_high  ? `₹${fmt(tickerInfo.year_high, 0)}`  : "–" },
                { l: "52W Low",     v: tickerInfo?.year_low   ? `₹${fmt(tickerInfo.year_low, 0)}`   : "–" },
                { l: "Volume",      v: tickerInfo?.volume ? (tickerInfo.volume >= 1e7 ? `${(tickerInfo.volume/1e7).toFixed(2)}Cr` : tickerInfo.volume >= 1e5 ? `${(tickerInfo.volume/1e5).toFixed(1)}L` : tickerInfo.volume.toLocaleString("en-IN")) : "–" },
                { l: "Beta",        v: tickerInfo?.beta ? fmt(tickerInfo.beta, 2) : "–" },
              ].map(({ l, v }) => (
                <div key={l}>
                  <div className="text-sm font-mono font-bold text-white">{v}</div>
                  <div className="text-[9px] text-gray-500 uppercase tracking-wider font-mono">{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tab Bar ──────────────────────────────────────── */}
        <div className="flex items-center space-x-0 overflow-x-auto scrollbar-hide">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTab(id)}
              className={`flex items-center space-x-1.5 px-4 py-2.5 text-[11px] font-medium font-mono uppercase tracking-wide border-b-2 whitespace-nowrap transition-all duration-150 cursor-pointer ${
                activeTab === id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
          {tabLoading && <div className="ml-3 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />}
        </div>
      </div>

      {/* ── Tab Content ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {coreLoading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-3 py-24">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-500 font-mono">Loading Terminal…</span>
          </div>
        ) : (
          <>
            {/* ═══════════════════════════════════════════════ */}
            {/* OVERVIEW TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Chart (full width) */}
                <div className="h-[420px]">
                  <PriceChart data={priceHistory} liveSymbol={symbol} />
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {tickerInfo && <>
                    <StatCard label="Open" value={tickerInfo.open ? `₹${fmt(tickerInfo.open, 2)}` : "–"} />
                    <StatCard label="Prev Close" value={tickerInfo.prev_close ? `₹${fmt(tickerInfo.prev_close, 2)}` : "–"} />
                    <StatCard label="Day High" value={tickerInfo.day_high ? `₹${fmt(tickerInfo.day_high, 0)}` : "–"} color="text-emerald-400" />
                    <StatCard label="Day Low" value={tickerInfo.day_low  ? `₹${fmt(tickerInfo.day_low, 0)}` : "–"} color="text-rose-400" />
                    <StatCard label="Avg Volume" value={tickerInfo.avg_volume ? (tickerInfo.avg_volume >= 1e7 ? `${(tickerInfo.avg_volume/1e7).toFixed(2)}Cr` : `${(tickerInfo.avg_volume/1e5).toFixed(1)}L`) : "–"} />
                    <StatCard label="Mkt State" value={tickerInfo.market_state || "–"} />
                  </>}
                </div>

                {/* S/R + Technicals summary */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Support & Resistance */}
                  <div className="glass-panel p-5">
                    <SectionHeader icon={Target} title="Support & Resistance" />
                    {/* 52W Range */}
                    {tickerInfo?.year_high && tickerInfo?.year_low && (
                      <div className="mb-4">
                        <div className="flex justify-between text-[10px] font-mono text-gray-400 mb-1">
                          <span>52W Low: ₹{fmt(tickerInfo.year_low, 0)}</span>
                          <span>52W High: ₹{fmt(tickerInfo.year_high, 0)}</span>
                        </div>
                        <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(0, ((price - tickerInfo.year_low) / (tickerInfo.year_high - tickerInfo.year_low)) * 100))}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] font-mono text-gray-600 mt-1">
                          <span>–{tickerInfo.year_low ? ((1 - tickerInfo.year_low/price)*100).toFixed(1) : 0}%</span>
                          <span className="text-blue-400">CMP ₹{fmt(price, 2)}</span>
                          <span>+{tickerInfo.year_high ? ((tickerInfo.year_high/price - 1)*100).toFixed(1) : 0}% to ATH</span>
                        </div>
                      </div>
                    )}
                    {/* Pivot Points */}
                    {pivots && (
                      <div className="space-y-1.5">
                        <p className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-2">Classic Pivot (Prior Day)</p>
                        {[
                          { l: "R3", v: pivots.r3, c: "text-emerald-300" },
                          { l: "R2", v: pivots.r2, c: "text-emerald-400" },
                          { l: "R1", v: pivots.r1, c: "text-emerald-500" },
                          { l: "PP", v: pivots.pp, c: "text-blue-400" },
                          { l: "S1", v: pivots.s1, c: "text-rose-500" },
                          { l: "S2", v: pivots.s2, c: "text-rose-400" },
                          { l: "S3", v: pivots.s3, c: "text-rose-300" },
                        ].map(({ l, v, c }) => (
                          <div key={l} className={`flex justify-between text-[10px] font-mono ${l === "PP" ? "bg-blue-500/5 rounded px-2 py-0.5 border border-blue-500/10" : ""}`}>
                            <span className="text-gray-500">{l}</span>
                            <span className={c}>₹{fmt(v, 2)}</span>
                            <span className="text-gray-600">{v > 0 ? ((v/price - 1)*100).toFixed(2) : ""}%</span>
                          </div>
                        ))}
                        {/* Fibonacci */}
                        <p className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mt-3 mb-1.5">Fibonacci</p>
                        {[
                          { l: "Fib R2 (61.8%)", v: pivots.fr2 },
                          { l: "Fib R1 (38.2%)", v: pivots.fr1 },
                          { l: "Fib S1 (38.2%)", v: pivots.fs1 },
                          { l: "Fib S2 (61.8%)", v: pivots.fs2 },
                        ].map(({ l, v }) => (
                          <div key={l} className="flex justify-between text-[10px] font-mono">
                            <span className="text-gray-500">{l}</span>
                            <span className="text-gray-300">₹{fmt(v, 2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Technical Rating Quick View */}
                  <div className="glass-panel p-5">
                    <SectionHeader icon={Activity} title="Technical Summary" />
                    {techRating ? (
                      <div className="space-y-4">
                        {/* Rating widget */}
                        <div className={`flex items-center justify-between p-4 rounded-xl border ${
                          techRating.overall.includes("BUY") ? "bg-emerald-500/8 border-emerald-500/20" :
                          techRating.overall.includes("SELL") ? "bg-rose-500/8 border-rose-500/20" :
                          "bg-slate-500/8 border-slate-500/20"
                        }`}>
                          <div>
                            <p className={`text-lg font-mono font-bold ${
                              techRating.overall.includes("BUY") ? "text-emerald-400" :
                              techRating.overall.includes("SELL") ? "text-rose-400" : "text-slate-400"
                            }`}>{techRating.overall}</p>
                            <p className="text-[10px] font-mono text-gray-500 mt-0.5">
                              {techRating.buys}B · {techRating.neutrals}N · {techRating.sells}S from {techRating.buys + techRating.neutrals + techRating.sells} indicators
                            </p>
                          </div>
                          {/* Mini bar */}
                          <div className="flex items-center space-x-0.5 h-8">
                            {[...Array(techRating.buys)].map((_, i) => <div key={i} className="w-1.5 h-full rounded-sm bg-emerald-500/70" />)}
                            {[...Array(techRating.neutrals)].map((_, i) => <div key={i} className="w-1.5 h-4 rounded-sm bg-slate-500/70" />)}
                            {[...Array(techRating.sells)].map((_, i) => <div key={i} className="w-1.5 h-full rounded-sm bg-rose-500/70" />)}
                          </div>
                        </div>
                        {/* Key levels */}
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                          {[
                            { l: "RSI (14)",  v: techRating.rsi.toFixed(1), c: techRating.rsi > 70 ? "text-rose-400" : techRating.rsi < 30 ? "text-emerald-400" : "text-white" },
                            { l: "MACD",     v: techRating.macd.toFixed(3), c: techRating.macd > 0 ? "text-emerald-400" : "text-rose-400" },
                            { l: "Stoch %K", v: techRating.stochK.toFixed(1), c: techRating.stochK > 80 ? "text-rose-400" : techRating.stochK < 20 ? "text-emerald-400" : "text-white" },
                            { l: "EMA 20",   v: `₹${fmt(techRating.ema20, 0)}`, c: price > techRating.ema20 ? "text-emerald-400" : "text-rose-400" },
                            { l: "EMA 50",   v: techRating.ema50 ? `₹${fmt(techRating.ema50, 0)}` : "–", c: techRating.ema50 && price > techRating.ema50 ? "text-emerald-400" : "text-rose-400" },
                            { l: "ATR (14)", v: `₹${fmt(techRating.atr, 1)}`, c: "text-white" },
                          ].map(({ l, v, c }) => (
                            <div key={l} className="flex justify-between bg-white/[0.02] rounded px-2 py-1.5">
                              <span className="text-gray-500">{l}</span>
                              <span className={c}>{v}</span>
                            </div>
                          ))}
                        </div>
                        {/* Golden/Death cross */}
                        {techRating.goldenCross !== null && (
                          <div className={`text-[10px] font-mono px-3 py-2 rounded-xl border ${
                            techRating.goldenCross ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-400" : "bg-rose-500/8 border-rose-500/20 text-rose-400"
                          }`}>
                            {techRating.goldenCross ? "✦ Golden Cross: SMA50 > SMA200 — Bullish trend" : "✦ Death Cross: SMA50 < SMA200 — Bearish trend"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600 font-mono text-center py-8">Need ≥ 20 candles of history</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════ */}
            {/* TECHNICALS TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {activeTab === "technicals" && (
              <div className="space-y-6">
                {techRating ? (
                  <>
                    {/* Overall rating */}
                    <div className="glass-panel p-6">
                      <SectionHeader icon={Activity} title="Technical Rating" badge={`${techRating.buys + techRating.neutrals + techRating.sells} indicators`} />
                      <div className="flex flex-col md:flex-row gap-6">
                        {/* Gauge */}
                        <div className="flex flex-col items-center justify-center min-w-[140px]">
                          <div className={`text-2xl font-mono font-bold mb-1 ${
                            techRating.overall.includes("BUY") ? "text-emerald-400" :
                            techRating.overall.includes("SELL") ? "text-rose-400" : "text-slate-400"
                          }`}>{techRating.overall}</div>
                          <div className="flex gap-3 text-xs font-mono">
                            <span className="text-emerald-400">{techRating.buys} BUY</span>
                            <span className="text-slate-400">{techRating.neutrals} NEUTRAL</span>
                            <span className="text-rose-400">{techRating.sells} SELL</span>
                          </div>
                          <div className="flex mt-3 gap-0.5 h-3">
                            {[...Array(techRating.buys)].map((_, i) => <div key={i} className="w-3 h-full bg-emerald-500 rounded-sm" />)}
                            {[...Array(techRating.neutrals)].map((_, i) => <div key={i} className="w-3 h-2 bg-slate-500 rounded-sm self-end" />)}
                            {[...Array(techRating.sells)].map((_, i) => <div key={i} className="w-3 h-full bg-rose-500 rounded-sm" />)}
                          </div>
                        </div>
                        {/* Signal table */}
                        <div className="flex-1 overflow-x-auto">
                          <table className="w-full text-[10px] font-mono">
                            <thead><tr className="text-gray-600 border-b border-white/[0.05]">
                              <th className="text-left py-1 pr-4">Indicator</th>
                              <th className="text-right py-1 pr-4">Value</th>
                              <th className="text-right py-1">Signal</th>
                            </tr></thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {techRating.signals.map((sig) => (
                                <tr key={sig.name} className="hover:bg-white/[0.02]">
                                  <td className="py-1 pr-4 text-gray-300">{sig.name}</td>
                                  <td className="py-1 pr-4 text-right text-gray-400">{sig.value}</td>
                                  <td className="py-1 text-right"><SignalBadge signal={sig.signal} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* MACD Chart */}
                    <div className="glass-panel p-5">
                      <SectionHeader icon={BarChart2} title="MACD (12, 26, 9)" />
                      <div className="h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={techRating.chartData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                            <XAxis dataKey="i" hide />
                            <YAxis tick={{ fill: "#4b5563", fontSize: 9 }} dx={-4} />
                            <Tooltip contentStyle={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, fontFamily: "monospace" }} />
                            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                            <Bar dataKey="histogram" name="Histogram" fill="#6366f1"
                              label={false}
                              shape={(props: any) => {
                                const { x, y, width, height, value } = props;
                                return <rect x={x} y={value >= 0 ? y : y + height} width={width} height={Math.abs(height)} fill={value >= 0 ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)"} />;
                              }}
                            />
                            <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="MACD" />
                            <Line type="monotone" dataKey="signal" stroke="#f59e0b" strokeWidth={1.2} dot={false} name="Signal" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* RSI + Stochastic side by side */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="glass-panel p-5">
                        <SectionHeader icon={Activity} title="RSI (14)" />
                        <div className="h-[160px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={techRating.chartData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                              <defs>
                                <linearGradient id="rsiGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                              <XAxis dataKey="i" hide />
                              <YAxis domain={[0, 100]} tick={{ fill: "#4b5563", fontSize: 9 }} dx={-4} />
                              <Tooltip contentStyle={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, fontFamily: "monospace" }} formatter={(v: any) => [Number(v).toFixed(1), "RSI"]} />
                              <ReferenceLine y={70} stroke="rgba(239,68,68,0.4)" strokeDasharray="3 3" />
                              <ReferenceLine y={30} stroke="rgba(16,185,129,0.4)" strokeDasharray="3 3" />
                              <Area type="monotone" dataKey="rsi" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#rsiGrad)" dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                        <p className="text-[9px] font-mono text-gray-500 mt-1">Current: {techRating.rsi.toFixed(1)} — {techRating.rsi > 70 ? "OVERBOUGHT" : techRating.rsi < 30 ? "OVERSOLD" : "NEUTRAL"}</p>
                      </div>

                      <div className="glass-panel p-5">
                        <SectionHeader icon={Activity} title="Stochastic (14, 3)" />
                        <div className="h-[160px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={techRating.chartData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                              <XAxis dataKey="i" hide />
                              <YAxis domain={[0, 100]} tick={{ fill: "#4b5563", fontSize: 9 }} dx={-4} />
                              <Tooltip contentStyle={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10, fontFamily: "monospace" }} />
                              <ReferenceLine y={80} stroke="rgba(239,68,68,0.4)" strokeDasharray="3 3" />
                              <ReferenceLine y={20} stroke="rgba(16,185,129,0.4)" strokeDasharray="3 3" />
                              <Line type="monotone" dataKey="stochK" stroke="#06b6d4" strokeWidth={1.5} dot={false} name="%K" />
                              <Line type="monotone" dataKey="stochD" stroke="#f59e0b" strokeWidth={1.2} dot={false} name="%D" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <p className="text-[9px] font-mono text-gray-500 mt-1">%K: {techRating.stochK.toFixed(1)} · %D: {techRating.stochD.toFixed(1)}</p>
                      </div>
                    </div>

                    {/* Moving Averages table */}
                    <div className="glass-panel p-5">
                      <SectionHeader icon={TrendingUp} title="Moving Averages vs CMP" />
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] font-mono">
                          <thead><tr className="text-gray-500 border-b border-white/[0.05]">
                            <th className="text-left py-2 pr-4">MA</th>
                            <th className="text-right py-2 pr-4">Value</th>
                            <th className="text-right py-2 pr-4">vs CMP</th>
                            <th className="text-right py-2">Signal</th>
                          </tr></thead>
                          <tbody className="divide-y divide-white/[0.03]">
                            {[
                              { n: "EMA 9",   v: techRating.ema9 },
                              { n: "EMA 20",  v: techRating.ema20 },
                              { n: "EMA 50",  v: techRating.ema50 },
                              { n: "SMA 20",  v: techRating.sma20 },
                              { n: "SMA 50",  v: techRating.sma50 },
                              { n: "SMA 200", v: techRating.sma200 },
                            ].filter(x => x.v !== null).map(({ n, v }) => {
                              const pct = v ? ((price - v!) / v! * 100) : 0;
                              return (
                                <tr key={n} className="hover:bg-white/[0.02]">
                                  <td className="py-2 pr-4 text-gray-300">{n}</td>
                                  <td className="py-2 pr-4 text-right text-gray-300">₹{fmt(v, 2)}</td>
                                  <td className={`py-2 pr-4 text-right ${pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</td>
                                  <td className="py-2 text-right"><SignalBadge signal={pct >= 0 ? "BUY" : "SELL"} /></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="glass-panel p-12 text-center">
                    <p className="text-sm font-mono text-gray-500">Not enough price history to compute indicators (need ≥ 20 candles).</p>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════ */}
            {/* FUNDAMENTALS TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {activeTab === "fundamentals" && (
              <div className="space-y-6">
                {fundamentals ? (
                  <>
                    {/* Valuation */}
                    <div className="glass-panel p-5">
                      <SectionHeader icon={BarChart2} title="Valuation Multiples" />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="P/E (TTM)"     value={fundamentals.pe_ttm ? fmt(fundamentals.pe_ttm, 2) : "–"} />
                        <StatCard label="P/E (Fwd)"     value={fundamentals.pe_forward ? fmt(fundamentals.pe_forward, 2) : "–"} />
                        <StatCard label="P/B Ratio"     value={fundamentals.pb_ratio ? fmt(fundamentals.pb_ratio, 2) : "–"} />
                        <StatCard label="P/S Ratio"     value={fundamentals.ps_ratio ? fmt(fundamentals.ps_ratio, 2) : "–"} />
                        <StatCard label="PEG Ratio"     value={fundamentals.peg_ratio ? fmt(fundamentals.peg_ratio, 2) : "–"} />
                        <StatCard label="EV/EBITDA"     value={fundamentals.ev_ebitda ? fmt(fundamentals.ev_ebitda, 2) : "–"} />
                        <StatCard label="EV/Revenue"    value={fundamentals.ev_revenue ? fmt(fundamentals.ev_revenue, 2) : "–"} />
                        <StatCard label="Enterprise Val" value={fmtCr(fundamentals.enterprise_value)} />
                      </div>
                    </div>

                    {/* Per Share + Dividends */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="glass-panel p-5">
                        <SectionHeader icon={BarChart2} title="Per Share Metrics" />
                        <div className="grid grid-cols-2 gap-3">
                          <StatCard label="EPS (TTM)"   value={fundamentals.eps_ttm ? `₹${fmt(fundamentals.eps_ttm, 2)}` : "–"} />
                          <StatCard label="EPS (Fwd)"   value={fundamentals.eps_forward ? `₹${fmt(fundamentals.eps_forward, 2)}` : "–"} />
                          <StatCard label="Book Value"  value={fundamentals.book_value ? `₹${fmt(fundamentals.book_value, 2)}` : "–"} />
                          <StatCard label="Short Ratio" value={fundamentals.short_ratio ? fmt(fundamentals.short_ratio, 2) : "–"} />
                        </div>
                      </div>
                      <div className="glass-panel p-5">
                        <SectionHeader icon={BarChart2} title="Dividends" />
                        <div className="grid grid-cols-2 gap-3">
                          <StatCard label="Div Yield" value={fundamentals.dividend_yield ? fmtPct(fundamentals.dividend_yield) : "–"} color="text-emerald-400" />
                          <StatCard label="Div Rate"  value={fundamentals.dividend_rate ? `₹${fmt(fundamentals.dividend_rate, 2)}` : "–"} />
                          <StatCard label="Payout %"  value={fundamentals.payout_ratio ? fmtPct(fundamentals.payout_ratio) : "–"} />
                          <StatCard label="5Y Avg Yield" value={fundamentals.five_year_avg_yield ? `${(fundamentals.five_year_avg_yield * 100).toFixed(2)}%` : "–"} />
                        </div>
                      </div>
                    </div>

                    {/* Profitability */}
                    <div className="glass-panel p-5">
                      <SectionHeader icon={TrendingUp} title="Profitability & Margins" />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="ROE"           value={fundamentals.roe ? fmtPct(fundamentals.roe) : "–"} color="text-emerald-400" />
                        <StatCard label="ROA"           value={fundamentals.roa ? fmtPct(fundamentals.roa) : "–"} />
                        <StatCard label="Gross Margin"  value={fundamentals.gross_margins ? fmtPct(fundamentals.gross_margins) : "–"} />
                        <StatCard label="Oper. Margin"  value={fundamentals.operating_margins ? fmtPct(fundamentals.operating_margins) : "–"} />
                        <StatCard label="Net Margin"    value={fundamentals.profit_margins ? fmtPct(fundamentals.profit_margins) : "–"} />
                        <StatCard label="EBITDA Margin" value={fundamentals.ebitda_margins ? fmtPct(fundamentals.ebitda_margins) : "–"} />
                        <StatCard label="Rev. Growth"   value={fundamentals.revenue_growth ? fmtPct(fundamentals.revenue_growth) : "–"} color={fundamentals.revenue_growth > 0 ? "text-emerald-400" : "text-rose-400"} />
                        <StatCard label="Earn. Growth"  value={fundamentals.earnings_growth ? fmtPct(fundamentals.earnings_growth) : "–"} color={fundamentals.earnings_growth > 0 ? "text-emerald-400" : "text-rose-400"} />
                      </div>
                    </div>

                    {/* Financial Health */}
                    <div className="glass-panel p-5">
                      <SectionHeader icon={Activity} title="Financial Health" />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="D/E Ratio"     value={fundamentals.debt_to_equity ? fmt(fundamentals.debt_to_equity, 2) : "–"} />
                        <StatCard label="Current Ratio" value={fundamentals.current_ratio ? fmt(fundamentals.current_ratio, 2) : "–"} />
                        <StatCard label="Quick Ratio"   value={fundamentals.quick_ratio ? fmt(fundamentals.quick_ratio, 2) : "–"} />
                        <StatCard label="Total Cash"    value={fmtCr(fundamentals.total_cash)} />
                        <StatCard label="Total Debt"    value={fmtCr(fundamentals.total_debt)} />
                        <StatCard label="Free CF"       value={fmtCr(fundamentals.free_cashflow)} />
                        <StatCard label="Oper. CF"      value={fmtCr(fundamentals.operating_cashflow)} />
                        <StatCard label="Revenue"       value={fmtCr(fundamentals.revenue)} />
                      </div>
                    </div>

                    {/* Peer Comparison */}
                    {peers.length > 0 && (
                      <div className="glass-panel p-5">
                        <SectionHeader icon={Users} title="Peer Comparison" badge={fundamentals.sector || ""} />
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] font-mono">
                            <thead><tr className="text-gray-500 border-b border-white/[0.05]">
                              <th className="text-left py-2 pr-3">Company</th>
                              <th className="text-right py-2 pr-3">Price</th>
                              <th className="text-right py-2 pr-3">Chg%</th>
                              <th className="text-right py-2 pr-3">Market Cap</th>
                              <th className="text-right py-2 pr-3">P/E</th>
                              <th className="text-right py-2 pr-3">P/B</th>
                              <th className="text-right py-2 pr-3">ROE</th>
                              <th className="text-right py-2">Net Margin</th>
                            </tr></thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {/* Current symbol */}
                              <tr className="bg-blue-500/5 border border-blue-500/10 rounded">
                                <td className="py-2 pr-3 text-blue-400 font-bold">{symbol} (You)</td>
                                <td className="py-2 pr-3 text-right text-white">₹{fmt(price, 0)}</td>
                                <td className={`py-2 pr-3 text-right ${isUp ? "text-emerald-400" : "text-rose-400"}`}>{isUp ? "+" : ""}{fmt(changePct, 2)}%</td>
                                <td className="py-2 pr-3 text-right text-gray-300">{fmtCr(fundamentals.market_cap)}</td>
                                <td className="py-2 pr-3 text-right text-gray-300">{fundamentals.pe_ttm ? fmt(fundamentals.pe_ttm, 1) : "–"}</td>
                                <td className="py-2 pr-3 text-right text-gray-300">{fundamentals.pb_ratio ? fmt(fundamentals.pb_ratio, 2) : "–"}</td>
                                <td className="py-2 pr-3 text-right text-gray-300">{fundamentals.roe ? fmtPct(fundamentals.roe) : "–"}</td>
                                <td className="py-2 text-right text-gray-300">{fundamentals.profit_margins ? fmtPct(fundamentals.profit_margins) : "–"}</td>
                              </tr>
                              {peers.map(p => (
                                <tr key={p.symbol} className="hover:bg-white/[0.02] cursor-pointer" onClick={() => router.push(`/ticker/${p.symbol}`)}>
                                  <td className="py-2 pr-3 text-gray-300">{p.symbol}</td>
                                  <td className="py-2 pr-3 text-right text-white">{p.price ? `₹${fmt(p.price, 0)}` : "–"}</td>
                                  <td className={`py-2 pr-3 text-right ${(p.change_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                    {p.change_pct != null ? `${p.change_pct >= 0 ? "+" : ""}${fmt(p.change_pct, 2)}%` : "–"}
                                  </td>
                                  <td className="py-2 pr-3 text-right text-gray-400">{fmtCr(p.market_cap)}</td>
                                  <td className="py-2 pr-3 text-right text-gray-400">{p.pe_ratio ? fmt(p.pe_ratio, 1) : "–"}</td>
                                  <td className="py-2 pr-3 text-right text-gray-400">{p.pb_ratio ? fmt(p.pb_ratio, 2) : "–"}</td>
                                  <td className="py-2 pr-3 text-right text-gray-400">{p.roe ? fmtPct(p.roe) : "–"}</td>
                                  <td className="py-2 text-right text-gray-400">{p.profit_margin ? fmtPct(p.profit_margin) : "–"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="glass-panel p-12 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
                    <span className="text-xs font-mono text-gray-500">Loading fundamentals from Yahoo Finance…</span>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════ */}
            {/* FINANCIALS TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {activeTab === "financials" && (
              <div className="space-y-6">
                {earnings ? (
                  <>
                    {/* Next earnings */}
                    {earnings.next_earnings_date && (
                      <div className="flex items-center space-x-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3">
                        <Calendar className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-mono text-amber-300">
                          Next Earnings: <strong>{earnings.next_earnings_date}</strong>
                        </span>
                      </div>
                    )}

                    {/* Quarterly */}
                    {earnings.quarterly?.length > 0 && (
                      <div className="glass-panel p-5">
                        <SectionHeader icon={BarChart2} title="Quarterly Financials (TTM)" />
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] font-mono min-w-[600px]">
                            <thead><tr className="text-gray-500 border-b border-white/[0.05]">
                              <th className="text-left py-2 pr-4">Quarter</th>
                              <th className="text-right py-2 pr-4">Revenue</th>
                              <th className="text-right py-2 pr-4">Gross Profit</th>
                              <th className="text-right py-2 pr-4">EBITDA</th>
                              <th className="text-right py-2">Net Income</th>
                            </tr></thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {earnings.quarterly.map((q: any, i: number) => (
                                <tr key={i} className="hover:bg-white/[0.02]">
                                  <td className="py-2 pr-4 text-gray-300 font-bold">{q.period}</td>
                                  <td className="py-2 pr-4 text-right text-white">{q.revenue ? fmtCr(q.revenue) : "–"}</td>
                                  <td className="py-2 pr-4 text-right text-gray-300">{q.gross_profit ? fmtCr(q.gross_profit) : "–"}</td>
                                  <td className="py-2 pr-4 text-right text-gray-300">{q.ebitda ? fmtCr(q.ebitda) : "–"}</td>
                                  <td className={`py-2 text-right font-bold ${q.net_income > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                    {q.net_income ? fmtCr(q.net_income) : "–"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* Revenue bar chart */}
                        <div className="h-[140px] mt-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[...earnings.quarterly].reverse()} margin={{ top: 4, right: 4, left: -10, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                              <XAxis dataKey="period" tick={{ fill: "#4b5563", fontSize: 8 }} />
                              <YAxis tick={{ fill: "#4b5563", fontSize: 8 }} tickFormatter={(v) => `${(v/1e9).toFixed(0)}B`} />
                              <Tooltip contentStyle={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 10 }} formatter={(v: any) => [fmtCr(v), "Revenue"]} />
                              <Bar dataKey="revenue" fill="rgba(59,130,246,0.5)" radius={[3,3,0,0]} />
                              <Bar dataKey="net_income" fill="rgba(16,185,129,0.5)" radius={[3,3,0,0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* Annual */}
                    {earnings.annual?.length > 0 && (
                      <div className="glass-panel p-5">
                        <SectionHeader icon={BarChart2} title="Annual Financials" />
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] font-mono min-w-[500px]">
                            <thead><tr className="text-gray-500 border-b border-white/[0.05]">
                              <th className="text-left py-2 pr-4">Year</th>
                              <th className="text-right py-2 pr-4">Revenue</th>
                              <th className="text-right py-2 pr-4">Gross Profit</th>
                              <th className="text-right py-2 pr-4">EBITDA</th>
                              <th className="text-right py-2">Net Income</th>
                            </tr></thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {earnings.annual.map((a: any, i: number) => (
                                <tr key={i} className="hover:bg-white/[0.02]">
                                  <td className="py-2 pr-4 text-gray-300 font-bold">{a.period}</td>
                                  <td className="py-2 pr-4 text-right text-white">{a.revenue ? fmtCr(a.revenue) : "–"}</td>
                                  <td className="py-2 pr-4 text-right text-gray-300">{a.gross_profit ? fmtCr(a.gross_profit) : "–"}</td>
                                  <td className="py-2 pr-4 text-right text-gray-300">{a.ebitda ? fmtCr(a.ebitda) : "–"}</td>
                                  <td className={`py-2 text-right font-bold ${a.net_income > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                    {a.net_income ? fmtCr(a.net_income) : "–"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* EPS Surprise */}
                    {earnings.eps_history?.length > 0 && (
                      <div className="glass-panel p-5">
                        <SectionHeader icon={Sparkles} title="EPS Surprise History" />
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] font-mono">
                            <thead><tr className="text-gray-500 border-b border-white/[0.05]">
                              <th className="text-left py-2 pr-4">Period</th>
                              <th className="text-right py-2 pr-4">Estimate</th>
                              <th className="text-right py-2 pr-4">Actual</th>
                              <th className="text-right py-2">Surprise</th>
                            </tr></thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {earnings.eps_history.map((e: any, i: number) => (
                                <tr key={i} className="hover:bg-white/[0.02]">
                                  <td className="py-2 pr-4 text-gray-300">{e.period}</td>
                                  <td className="py-2 pr-4 text-right text-gray-400">{e.eps_estimate != null ? `₹${fmt(e.eps_estimate, 2)}` : "–"}</td>
                                  <td className="py-2 pr-4 text-right text-white">{e.eps_actual != null ? `₹${fmt(e.eps_actual, 2)}` : "–"}</td>
                                  <td className={`py-2 text-right font-bold ${(e.surprise_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                    {e.surprise_pct != null ? `${e.surprise_pct >= 0 ? "+" : ""}${fmt(e.surprise_pct * 100, 2)}%` : "–"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="glass-panel p-12 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
                    <span className="text-xs font-mono text-gray-500">Loading financials…</span>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════ */}
            {/* OWNERSHIP TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {activeTab === "ownership" && (
              <div className="space-y-6">
                {holders ? (
                  <>
                    {/* Major breakdown */}
                    {holders.major_holders?.length > 0 && (
                      <div className="glass-panel p-5">
                        <SectionHeader icon={Users} title="Ownership Breakdown" />
                        <div className="space-y-3">
                          {holders.major_holders.map((h: any, i: number) => (
                            <div key={i}>
                              <div className="flex justify-between text-xs font-mono mb-1">
                                <span className="text-gray-400">{h.label}</span>
                                <span className="text-white font-bold">{h.pct != null ? `${h.pct.toFixed(2)}%` : "–"}</span>
                              </div>
                              {h.pct != null && (
                                <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, h.pct)}%` }} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Institutional holders table */}
                    {holders.institutional_holders?.length > 0 && (
                      <div className="glass-panel p-5">
                        <SectionHeader icon={Users} title="Top Institutional Holders" />
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] font-mono">
                            <thead><tr className="text-gray-500 border-b border-white/[0.05]">
                              <th className="text-left py-2 pr-4">Institution</th>
                              <th className="text-right py-2 pr-4">Shares</th>
                              <th className="text-right py-2 pr-4">Value</th>
                              <th className="text-right py-2 pr-4">% Held</th>
                              <th className="text-right py-2">As Of</th>
                            </tr></thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {holders.institutional_holders.map((h: any, i: number) => (
                                <tr key={i} className="hover:bg-white/[0.02]">
                                  <td className="py-2 pr-4 text-gray-300 max-w-[200px] truncate">{h.holder}</td>
                                  <td className="py-2 pr-4 text-right text-gray-400">{h.shares ? (h.shares >= 1e7 ? `${(h.shares/1e7).toFixed(2)}Cr` : h.shares.toLocaleString("en-IN")) : "–"}</td>
                                  <td className="py-2 pr-4 text-right text-gray-300">{h.value ? fmtCr(h.value) : "–"}</td>
                                  <td className="py-2 pr-4 text-right text-blue-400">{h.pct_held != null ? `${(h.pct_held * 100).toFixed(3)}%` : "–"}</td>
                                  <td className="py-2 text-right text-gray-600">{h.date || "–"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {!holders.major_holders?.length && !holders.institutional_holders?.length && (
                      <div className="glass-panel p-12 text-center">
                        <p className="text-xs font-mono text-gray-500">Ownership data not available for this ticker.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="glass-panel p-12 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
                    <span className="text-xs font-mono text-gray-500">Loading ownership data…</span>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════ */}
            {/* ANALYST TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {activeTab === "analyst" && (
              <div className="space-y-6">
                {recommendations ? (
                  <>
                    {/* Consensus */}
                    <div className="glass-panel p-5">
                      <SectionHeader icon={Target} title="Analyst Consensus" badge={`${recommendations.analyst_count || 0} analysts`} />
                      <div className="flex flex-col md:flex-row gap-8 items-start">
                        {/* Rating breakdown */}
                        <div className="min-w-[200px]">
                          {(() => {
                            const t = recommendations.trend || {};
                            const total = (t.strong_buy||0) + (t.buy||0) + (t.hold||0) + (t.sell||0) + (t.strong_sell||0);
                            return (
                              <div className="space-y-2">
                                {[
                                  { l: "Strong Buy", v: t.strong_buy || 0, c: "bg-emerald-500" },
                                  { l: "Buy",         v: t.buy || 0,        c: "bg-emerald-400" },
                                  { l: "Hold",        v: t.hold || 0,       c: "bg-amber-400" },
                                  { l: "Sell",        v: t.sell || 0,       c: "bg-rose-400" },
                                  { l: "Strong Sell", v: t.strong_sell || 0, c: "bg-rose-600" },
                                ].map(({ l, v, c }) => (
                                  <div key={l}>
                                    <div className="flex justify-between text-[10px] font-mono mb-0.5">
                                      <span className="text-gray-400">{l}</span>
                                      <span className="text-white">{v}</span>
                                    </div>
                                    <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                                      <div className={`h-full ${c} rounded-full`} style={{ width: total > 0 ? `${(v/total)*100}%` : "0%" }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          <div className={`mt-4 text-sm font-mono font-bold text-center py-2 rounded-xl border ${
                            recommendations.recommendation_key?.includes("buy") ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                            recommendations.recommendation_key?.includes("sell") ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                            "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}>
                            {(recommendations.recommendation_key || "hold").toUpperCase()}
                          </div>
                        </div>

                        {/* Target price */}
                        <div className="flex-1">
                          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">Target Price Range</p>
                          {recommendations.target_high && recommendations.target_low && (
                            <div className="relative h-10 mb-4">
                              <div className="absolute inset-y-0 left-0 right-0 flex items-center">
                                <div className="w-full h-2 bg-white/[0.05] rounded-full overflow-hidden relative">
                                  <div
                                    className="absolute h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500"
                                    style={{
                                      left: `${Math.min(100, Math.max(0, ((price - recommendations.target_low) / (recommendations.target_high - recommendations.target_low)) * 100))}%`,
                                      width: "2px",
                                    }}
                                  />
                                  <div className="h-full bg-blue-500/30 rounded-full" style={{
                                    marginLeft: `${Math.min(100, Math.max(0, ((price - recommendations.target_low) / (recommendations.target_high - recommendations.target_low)) * 100))}%`,
                                  }} />
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-3">
                            <StatCard label="Low Target" value={recommendations.target_low ? `₹${fmt(recommendations.target_low, 0)}` : "–"} color="text-rose-400" />
                            <StatCard label="Mean Target" value={recommendations.target_mean ? `₹${fmt(recommendations.target_mean, 0)}` : "–"} color="text-blue-400"
                              sub={recommendations.target_mean && price ? `${((recommendations.target_mean/price - 1)*100).toFixed(1)}% upside` : ""} />
                            <StatCard label="High Target" value={recommendations.target_high ? `₹${fmt(recommendations.target_high, 0)}` : "–"} color="text-emerald-400" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Recent analyst recs trend by month */}
                    <div className="glass-panel p-5">
                      <SectionHeader icon={BarChart2} title="Rating Trend (Last 3 Months)" />
                      <div className="overflow-x-auto">
                        <table className="w-full text-[10px] font-mono">
                          <thead><tr className="text-gray-500 border-b border-white/[0.05]">
                            <th className="text-left py-2 pr-4">Period</th>
                            <th className="text-right py-2 pr-3">Strong Buy</th>
                            <th className="text-right py-2 pr-3">Buy</th>
                            <th className="text-right py-2 pr-3">Hold</th>
                            <th className="text-right py-2 pr-3">Sell</th>
                            <th className="text-right py-2">Strong Sell</th>
                          </tr></thead>
                          <tbody className="divide-y divide-white/[0.03]">
                            {[recommendations.trend].map((t, i) => (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="py-2 pr-4 text-gray-300">Current</td>
                                <td className="py-2 pr-3 text-right text-emerald-400">{t.strong_buy}</td>
                                <td className="py-2 pr-3 text-right text-emerald-300">{t.buy}</td>
                                <td className="py-2 pr-3 text-right text-amber-400">{t.hold}</td>
                                <td className="py-2 pr-3 text-right text-rose-300">{t.sell}</td>
                                <td className="py-2 text-right text-rose-500">{t.strong_sell}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </>
                ) : (
                  <div className="glass-panel p-12 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
                    <span className="text-xs font-mono text-gray-500">Loading analyst data…</span>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════ */}
            {/* NEWS & RESEARCH TAB */}
            {/* ═══════════════════════════════════════════════ */}
            {activeTab === "news" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* News feed */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="glass-panel p-5">
                    <SectionHeader icon={Newspaper} title="Recent Headlines" badge="Yahoo Finance" />
                    {news.length > 0 ? (
                      <div className="space-y-3">
                        {news.map((item, i) => (
                          <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                            className="flex gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/10 hover:bg-white/[0.04] transition-all group cursor-pointer">
                            {item.thumbnail && (
                              <img src={item.thumbnail} alt="" className="w-16 h-14 object-cover rounded-lg shrink-0 opacity-80" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-white group-hover:text-blue-300 transition-colors line-clamp-2 font-medium">{item.title}</p>
                              <div className="flex items-center space-x-2 mt-1.5">
                                <span className="text-[9px] font-mono text-gray-500">{item.publisher}</span>
                                <span className="text-[9px] text-gray-700">·</span>
                                <span className="text-[9px] font-mono text-gray-600">
                                  {item.published_at ? new Date(item.published_at * 1000).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                                </span>
                              </div>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 text-gray-700 group-hover:text-blue-400 transition-colors shrink-0 mt-0.5" />
                          </a>
                        ))}
                      </div>
                    ) : loadedTabs.has("news") ? (
                      <p className="text-xs font-mono text-gray-600 text-center py-8">No news available for this ticker.</p>
                    ) : (
                      <div className="flex items-center justify-center py-12 space-x-3">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-mono text-gray-500">Fetching news…</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Research Note */}
                <div className="lg:col-span-5">
                  <div className="glass-panel p-5 h-full">
                    <SectionHeader icon={Brain} title="AI Research Note" />
                    {aiAnalysis?.research_note ? (
                      <div className="space-y-4 text-xs">
                        {aiAnalysis.research_note.recommendation && (
                          <div className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-mono font-bold border ${
                            aiAnalysis.research_note.recommendation === "BUY" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                            aiAnalysis.research_note.recommendation === "SELL" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                            "bg-slate-500/10 text-slate-400 border-slate-500/20"
                          }`}>
                            {aiAnalysis.research_note.recommendation} · Target ₹{aiAnalysis.research_note.target_price?.toLocaleString("en-IN") || "N/A"}
                          </div>
                        )}
                        <p className="text-slate-300 leading-relaxed">{aiAnalysis.research_note.investment_thesis}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <h5 className="text-[9px] font-mono text-emerald-400 uppercase tracking-widest mb-1.5 flex items-center"><Sparkles className="w-3 h-3 mr-1" /> Catalysts</h5>
                            <ul className="space-y-1">{(aiAnalysis.research_note.key_catalysts || []).map((c: string, i: number) => (
                              <li key={i} className="text-slate-400 flex items-start"><span className="text-emerald-600 mr-1">•</span>{c}</li>
                            ))}</ul>
                          </div>
                          <div>
                            <h5 className="text-[9px] font-mono text-rose-400 uppercase tracking-widest mb-1.5 flex items-center"><Terminal className="w-3 h-3 mr-1" /> Risks</h5>
                            <ul className="space-y-1">{(aiAnalysis.research_note.key_risks || []).map((r: string, i: number) => (
                              <li key={i} className="text-slate-400 flex items-start"><span className="text-rose-600 mr-1">•</span>{r}</li>
                            ))}</ul>
                          </div>
                        </div>
                        {aiAnalysis.research_note.valuation_summary && (
                          <p className="text-slate-500 text-[11px] border-t border-white/[0.05] pt-3">{aiAnalysis.research_note.valuation_summary}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 space-y-4">
                        <Brain className="w-10 h-10 text-gray-700" />
                        <div className="text-center">
                          <p className="text-xs font-mono text-white">No AI Analysis cached</p>
                          <p className="text-[10px] text-gray-500 mt-1">Generate a Gemini research note on demand.</p>
                        </div>
                        <button
                          onClick={async () => {
                            setGeneratingAi(true);
                            try {
                              const res = await fetch(`${API}/api/ticker/${symbol}/analysis/generate`, { method: "POST" });
                              if (res.ok) setAiAnalysis(await res.json());
                            } catch { /* ignore */ }
                            finally { setGeneratingAi(false); }
                          }}
                          disabled={generatingAi}
                          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono rounded-xl cursor-pointer transition-all disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{generatingAi ? "Generating…" : "Generate with Gemini"}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


