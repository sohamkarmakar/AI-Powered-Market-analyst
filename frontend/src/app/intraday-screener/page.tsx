"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import {
  Plus, X, Play, Save, RefreshCw, Trash2, ChevronDown,
  ChevronUp, ExternalLink, Star, Bell, Wifi, WifiOff,
  Clock, AlertTriangle, CheckCircle2, ScanLine, Zap,
  TrendingUp, TrendingDown, BarChart3, Activity, Filter,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface Condition {
  id: string;
  indicator: string;
  op: string;
  value: string;
  bars?: number;
  logic?: "AND" | "OR"; // how to join with the NEXT condition
}

interface ScreenerMatch {
  symbol: string;
  ltp: number;
  change_pct: number;
  signal_value: string;
  signal_time: string | null;
  volume: number;
  indicators: {
    rsi: number | null;
    supertrend: string | null;
    macd: number | null;
    macd_hist: number | null;
    vwap: number | null;
    adx: number | null;
    volume_ratio: number | null;
  };
  sparkline: number[];
}

interface ScanResult {
  matches: ScreenerMatch[];
  match_count: number;
  total_scanned: number;
  scan_time_ms: number;
  is_stale: boolean;
  fetched_at: string;
  universe: string;
  timeframe: string;
  symbol_count: number;
}

interface SavedScan {
  id: string;
  name: string;
  query: { universe: string; timeframe: string; conditions: Condition[]; logic: string };
  created_at: string;
}

interface Preset {
  id: string;
  name: string;
  description: string;
  emoji: string;
  query: { universe: string; timeframe: string; conditions: { indicator: string; op: string; value?: number; bars?: number }[]; logic: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const UNIVERSES: Record<string, string> = {
  nifty50: "Nifty 50",
  banknifty: "Bank Nifty",
  niftyit: "Nifty IT",
  niftyfmcg: "Nifty FMCG",
};

const TIMEFRAMES: Record<string, string> = {
  "1m": "1 min",
  "5m": "5 min",
  "15m": "15 min",
  "1h": "1 hour",
  "1d": "Daily",
};

const INDICATORS: { value: string; label: string; group: string }[] = [
  { value: "rsi", label: "RSI (14)", group: "Momentum" },
  { value: "macd", label: "MACD (12,26,9)", group: "Momentum" },
  { value: "macd_histogram", label: "MACD Histogram", group: "Momentum" },
  { value: "supertrend", label: "Supertrend (10,3)", group: "Trend" },
  { value: "adx", label: "ADX (14)", group: "Trend" },
  { value: "sma20", label: "SMA 20", group: "Moving Average" },
  { value: "sma50", label: "SMA 50", group: "Moving Average" },
  { value: "ema20", label: "EMA 20", group: "Moving Average" },
  { value: "ema50", label: "EMA 50", group: "Moving Average" },
  { value: "vwap", label: "VWAP", group: "Volume" },
  { value: "volume", label: "Volume Ratio", group: "Volume" },
  { value: "bb", label: "Bollinger %b", group: "Volatility" },
  { value: "price_change", label: "% Price Change", group: "Price" },
  { value: "ltp", label: "Price (LTP)", group: "Price" },
];

const OPS_BY_INDICATOR: Record<string, { value: string; label: string }[]> = {
  default: [
    { value: "gt", label: "is above" },
    { value: "lt", label: "is below" },
    { value: "gte", label: "is above or equal" },
    { value: "lte", label: "is below or equal" },
    { value: "eq", label: "equals" },
  ],
  rsi: [
    { value: "gt", label: "is above" },
    { value: "lt", label: "is below" },
    { value: "crosses_above", label: "crosses above" },
    { value: "crosses_below", label: "crosses below" },
  ],
  supertrend: [
    { value: "flips_to_buy", label: "flips to Buy" },
    { value: "flips_to_sell", label: "flips to Sell" },
    { value: "gt", label: "direction is UP (bullish)" },
    { value: "lt", label: "direction is DOWN (bearish)" },
  ],
  macd: [
    { value: "bullish_crossover", label: "bullish crossover" },
    { value: "bearish_crossover", label: "bearish crossover" },
    { value: "gt", label: "MACD line above 0" },
    { value: "lt", label: "MACD line below 0" },
  ],
  vwap: [
    { value: "above_vwap", label: "price is above VWAP" },
    { value: "below_vwap", label: "price is below VWAP" },
  ],
  volume: [
    { value: "gt", label: "ratio is above" },
    { value: "lt", label: "ratio is below" },
  ],
  price_change: [
    { value: "gt", label: "is above %" },
    { value: "lt", label: "is below %" },
    { value: "gte", label: "is at least %" },
    { value: "lte", label: "is at most %" },
  ],
};

const EVENT_OPS = new Set([
  "flips_to_buy", "flips_to_sell",
  "bullish_crossover", "bearish_crossover",
  "above_vwap", "below_vwap",
]);

const REFRESH_INTERVALS: { label: string; value: number }[] = [
  { label: "Off", value: 0 },
  { label: "60s", value: 60 },
  { label: "90s", value: 90 },
  { label: "2 min", value: 120 },
];

function uid() { return Math.random().toString(36).slice(2, 8); }

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline SVG
// ─────────────────────────────────────────────────────────────────────────────

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) return <div className="w-16 h-7 opacity-20 flex items-center justify-center text-[9px] text-text-muted">—</div>;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const w = 64, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rng) * (h - 4) - 2}`).join(" ");
  const col = positive ? "var(--positive)" : "var(--negative)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sp-${positive}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.3" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#sp-${positive})`} />
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator Badge
// ─────────────────────────────────────────────────────────────────────────────

function IndBadge({ label, value, positive }: { label: string; value: string | number | null; positive?: boolean }) {
  if (value === null || value === undefined) return null;
  const col = positive === true ? "text-positive" : positive === false ? "text-negative" : "text-text-secondary";
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-bg-tertiary">
      <span className="text-text-muted">{label}</span>
      <span className={col}>{value}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function IntradayScreenerPage() {
  // Query builder state
  const [universe, setUniverse] = useState("nifty50");
  const [timeframe, setTimeframe] = useState("5m");
  const [conditions, setConditions] = useState<Condition[]>([
    { id: uid(), indicator: "rsi", op: "gt", value: "70", bars: 1 },
  ]);
  const [globalLogic, setGlobalLogic] = useState<"AND" | "OR">("AND");

  // Results
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Presets
  const [presets, setPresets] = useState<Preset[]>([]);

  // Auto-refresh
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Saved scans
  const [savedScans, setSavedScans] = useState<SavedScan[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Sorting
  const [sortBy, setSortBy] = useState<"change_pct" | "ltp" | "volume" | "rsi">("change_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Previous matches for alert diffing
  const prevMatchSymbols = useRef<Set<string>>(new Set());

  // ── Load presets + saved scans on mount ──────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/screener/presets`)
      .then(r => r.json())
      .then(d => setPresets(d.presets || []))
      .catch(() => {});

    fetch(`${API}/api/screener/saved`)
      .then(r => r.json())
      .then(d => setSavedScans(d.scans || []))
      .catch(() => {});
  }, []);

  // ── Run scan ──────────────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (conditions.length === 0) return;
    setLoading(true);
    setScanError(null);

    const payload = {
      universe,
      timeframe,
      conditions: conditions.map(c => ({
        indicator: c.indicator,
        op: c.op,
        value: c.value ? parseFloat(c.value) : null,
        bars: c.bars ?? 1,
      })),
      logic: globalLogic,
    };

    try {
      const res = await fetch(`${API}/api/screener/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Scan failed");
      }
      const data: ScanResult = await res.json();

      // Alert diffing — find NEW matches
      const curSymbols = new Set(data.matches.map(m => m.symbol));
      const newSymbols = [...curSymbols].filter(s => !prevMatchSymbols.current.has(s));
      if (newSymbols.length > 0 && prevMatchSymbols.current.size > 0) {
        // Push to browser notification or simply log for now
        console.info(`[Screener] New matches: ${newSymbols.join(", ")}`);
      }
      prevMatchSymbols.current = curSymbols;

      setResult(data);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [universe, timeframe, conditions, globalLogic]);

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (refreshInterval === 0) { setCountdown(0); return; }

    setCountdown(refreshInterval);
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return refreshInterval;
        return prev - 1;
      });
    }, 1000);

    refreshTimerRef.current = setInterval(() => {
      runScan();
    }, refreshInterval * 1000);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [refreshInterval, runScan]);

  // ── Apply preset ──────────────────────────────────────────────────────────
  function applyPreset(preset: Preset) {
    setUniverse(preset.query.universe);
    setTimeframe(preset.query.timeframe);
    setGlobalLogic((preset.query.logic as "AND" | "OR") ?? "AND");
    setConditions(
      preset.query.conditions.map(c => ({
        id: uid(),
        indicator: c.indicator,
        op: c.op,
        value: c.value !== undefined ? String(c.value) : "",
        bars: c.bars ?? 1,
      }))
    );
    setResult(null);
  }

  // ── Condition helpers ─────────────────────────────────────────────────────
  function addCondition() {
    setConditions(prev => [...prev, { id: uid(), indicator: "rsi", op: "gt", value: "50", bars: 1 }]);
  }

  function removeCondition(id: string) {
    setConditions(prev => prev.filter(c => c.id !== id));
  }

  function updateCondition(id: string, patch: Partial<Condition>) {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }

  // ── Save scan ─────────────────────────────────────────────────────────────
  async function saveScan() {
    if (!saveName.trim()) return;
    const payload = {
      name: saveName.trim(),
      query: { universe, timeframe, conditions, logic: globalLogic },
    };
    try {
      const res = await fetch(`${API}/api/screener/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      setSavedScans(prev => [d.scan, ...prev]);
      setShowSaveModal(false);
      setSaveName("");
    } catch { /* silent */ }
  }

  async function deleteScan(id: string) {
    await fetch(`${API}/api/screener/saved/${id}`, { method: "DELETE" }).catch(() => {});
    setSavedScans(prev => prev.filter(s => s.id !== id));
  }

  function toggleSort(field: typeof sortBy) {
    if (sortBy === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(field); setSortDir("desc"); }
  }

  const sortedMatches = result ? [...result.matches].sort((a, b) => {
    let va: number, vb: number;
    if (sortBy === "change_pct") { va = Math.abs(a.change_pct); vb = Math.abs(b.change_pct); }
    else if (sortBy === "ltp") { va = a.ltp; vb = b.ltp; }
    else if (sortBy === "volume") { va = a.volume; vb = b.volume; }
    else if (sortBy === "rsi") { va = a.indicators.rsi ?? 0; vb = b.indicators.rsi ?? 0; }
    else { va = 0; vb = 0; }
    return sortDir === "desc" ? vb - va : va - vb;
  }) : [];

  function SortIcon({ field }: { field: typeof sortBy }) {
    if (sortBy !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === "desc" ? <ChevronDown className="w-3 h-3 text-accent-primary" /> : <ChevronUp className="w-3 h-3 text-accent-primary" />;
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch { return "—"; }
  }

  function fmtVol(n: number) {
    if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
    if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  }

  const isMarketHours = (() => {
    const now = new Date();
    const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const h = ist.getHours(), m = ist.getMinutes();
    const mins = h * 60 + m;
    const day = ist.getDay();
    return day >= 1 && day <= 5 && mins >= 555 && mins <= 930;
  })();

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg-primary">
      {/* ── TOP BAR ── */}
      <TopBar
        title="Intraday Screener"
        subtitle={result ? `${result.match_count} match${result.match_count !== 1 ? "es" : ""} from ${result.total_scanned} stocks · ${result.scan_time_ms}ms` : "Query builder · Nifty 50, Bank Nifty, Nifty IT"}
        icon={<ScanLine className="w-4 h-4 text-accent-primary" />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
              isMarketHours ? "bg-positive/10 border-positive/20 text-positive" : "bg-neutral-bg border-neutral/20 text-neutral"
            }`}>
              {isMarketHours ? "● LIVE" : "○ CLOSED"}
            </span>
            {result?.is_stale && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] font-mono text-neutral border border-neutral/20 bg-neutral/5 px-2 py-1 rounded-full">
                <AlertTriangle className="w-3 h-3" /> Stale
              </span>
            )}
            <div className="flex items-center gap-1 bg-bg-elevated border border-border-primary rounded-lg p-1">
              <RefreshCw className={`w-3.5 h-3.5 ml-1 ${refreshInterval > 0 ? "text-accent-primary animate-spin" : "text-text-muted"}`} style={{ animationDuration: "3s" }} />
              {REFRESH_INTERVALS.map(opt => (
                <button key={opt.value} onClick={() => setRefreshInterval(opt.value)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-all ${
                    refreshInterval === opt.value ? "bg-accent-primary text-white" : "text-text-muted hover:text-text-primary"
                  }`}>{opt.label}</button>
              ))}
              {refreshInterval > 0 && countdown > 0 && (
                <span className="text-[10px] font-mono text-accent-primary pr-1">{countdown}s</span>
              )}
            </div>
            <button onClick={() => setShowSaved(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                showSaved ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary" : "border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              }`}>
              <Save className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Saved {savedScans.length > 0 && `(${savedScans.length})`}</span>
            </button>
          </div>
        }
      />

      <div className="flex flex-1">
        {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 gap-5 max-w-7xl mx-auto w-full">

          {/* ── PRESET CHIPS ─────────────────────────────────────────────── */}
          <div>
            <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2.5">Quick Scans</p>
            <div className="flex gap-2 flex-wrap">
              {presets.map(p => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  title={p.description}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-bg-elevated border border-border-primary text-text-secondary hover:border-accent-primary/40 hover:text-text-primary hover:bg-accent-primary/5 transition-all duration-150"
                >
                  <span>{p.emoji}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── QUERY BUILDER ────────────────────────────────────────────── */}
          <div className="glass-panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="w-4 h-4 text-accent-primary" />
              <span className="text-sm font-semibold text-text-primary">Scan Conditions</span>
            </div>

            {/* Universe + Timeframe */}
            <div className="flex gap-3 flex-wrap mb-5">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Universe</label>
                <select
                  value={universe}
                  onChange={e => setUniverse(e.target.value)}
                  className="bg-bg-tertiary border border-border-primary text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50 cursor-pointer min-w-[140px]"
                >
                  {Object.entries(UNIVERSES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={e => setTimeframe(e.target.value)}
                  className="bg-bg-tertiary border border-border-primary text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50 cursor-pointer min-w-[120px]"
                >
                  {Object.entries(TIMEFRAMES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Join Logic</label>
                <div className="flex rounded-lg overflow-hidden border border-border-primary">
                  {(["AND", "OR"] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setGlobalLogic(l)}
                      className={`px-4 py-2 text-xs font-bold transition-all ${
                        globalLogic === l
                          ? "bg-accent-primary text-white"
                          : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Condition Rows */}
            <div className="space-y-2.5 mb-4">
              {conditions.map((cond, idx) => {
                const opsForInd = OPS_BY_INDICATOR[cond.indicator] ?? OPS_BY_INDICATOR.default;
                const showValue = !EVENT_OPS.has(cond.op);
                const showBars  = cond.indicator === "price_change";

                return (
                  <div key={cond.id} className="flex flex-col gap-1.5">
                    {idx > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-px bg-border-primary" />
                        <span className="text-[10px] font-bold font-mono text-accent-primary px-2 py-0.5 bg-accent-primary/10 rounded-full border border-accent-primary/20">
                          {globalLogic}
                        </span>
                        <div className="flex-1 h-px bg-border-primary" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Condition number */}
                      <span className="w-5 h-5 rounded-full bg-accent-primary/10 text-accent-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>

                      {/* Indicator selector */}
                      <select
                        value={cond.indicator}
                        onChange={e => {
                          const newInd = e.target.value;
                          const firstOp = (OPS_BY_INDICATOR[newInd] ?? OPS_BY_INDICATOR.default)[0].value;
                          updateCondition(cond.id, { indicator: newInd, op: firstOp, value: "" });
                        }}
                        className="bg-bg-tertiary border border-border-primary text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50 cursor-pointer"
                      >
                        {INDICATORS.map(ind => (
                          <option key={ind.value} value={ind.value}>{ind.label}</option>
                        ))}
                      </select>

                      {/* Operator selector */}
                      <select
                        value={cond.op}
                        onChange={e => updateCondition(cond.id, { op: e.target.value })}
                        className="bg-bg-tertiary border border-border-primary text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50 cursor-pointer"
                      >
                        {opsForInd.map(op => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>

                      {/* Value input */}
                      {showValue && (
                        <input
                          type="number"
                          value={cond.value}
                          onChange={e => updateCondition(cond.id, { value: e.target.value })}
                          placeholder="Value"
                          className="w-24 bg-bg-tertiary border border-border-primary text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50 font-mono"
                        />
                      )}

                      {/* Bars selector for price_change */}
                      {showBars && (
                        <select
                          value={cond.bars ?? 1}
                          onChange={e => updateCondition(cond.id, { bars: parseInt(e.target.value) })}
                          className="bg-bg-tertiary border border-border-primary text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50 cursor-pointer"
                        >
                          <option value={1}>1 bar</option>
                          <option value={3}>3 bars</option>
                          <option value={6}>6 bars</option>
                          <option value={12}>12 bars</option>
                        </select>
                      )}

                      {/* Remove button */}
                      {conditions.length > 1 && (
                        <button
                          onClick={() => removeCondition(cond.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-negative hover:bg-negative/10 transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <button
                onClick={addCondition}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary border border-dashed border-border-primary rounded-lg hover:text-text-primary hover:border-accent-primary/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Condition
              </button>

              <div className="flex-1" />

              <button
                onClick={() => { setConditions([{ id: uid(), indicator: "rsi", op: "gt", value: "70", bars: 1 }]); setResult(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary border border-border-primary rounded-lg hover:bg-bg-tertiary transition-all"
              >
                <X className="w-3 h-3" /> Clear
              </button>

              <button
                onClick={() => setShowSaveModal(true)}
                disabled={!result}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary border border-border-primary rounded-lg hover:text-text-primary hover:bg-bg-tertiary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className="w-3.5 h-3.5" /> Save Scan
              </button>

              <button
                onClick={runScan}
                disabled={loading || conditions.length === 0}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-accent-primary/20"
              >
                {loading
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Play className="w-4 h-4" />
                }
                {loading ? "Scanning…" : "Run Scan"}
              </button>
            </div>
          </div>

          {/* ── RESULTS ──────────────────────────────────────────────────── */}
          {scanError && (
            <div className="glass-panel p-4 border-negative/20 bg-negative/5 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-negative shrink-0" />
              <div>
                <p className="text-sm font-medium text-negative">Scan Error</p>
                <p className="text-xs text-text-secondary mt-0.5">{scanError}</p>
              </div>
            </div>
          )}

          {loading && !result && (
            <div className="glass-panel p-6">
              <div className="flex items-center gap-3 mb-4">
                <RefreshCw className="w-4 h-4 text-accent-primary animate-spin" />
                <span className="text-sm text-text-secondary">Fetching intraday data and computing indicators…</span>
              </div>
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-12 bg-bg-tertiary rounded-lg animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
            </div>
          )}

          {!loading && !result && !scanError && (
            <div className="glass-panel p-12 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center mb-4">
                <ScanLine className="w-8 h-8 text-accent-primary" />
              </div>
              <h3 className="text-base font-semibold text-text-primary mb-1">Ready to Scan</h3>
              <p className="text-sm text-text-muted max-w-sm">
                Select a universe, add conditions, and click{" "}
                <span className="text-accent-primary font-medium">Run Scan</span> — or pick a quick scan above.
              </p>
            </div>
          )}

          {result && (
            <div className="glass-panel overflow-hidden">
              {/* Results header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary bg-bg-elevated/50">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-positive" />
                  <span className="text-sm font-semibold text-text-primary">
                    {result.match_count} Result{result.match_count !== 1 ? "s" : ""}
                  </span>
                  <span className="text-xs text-text-muted font-mono">
                    {UNIVERSES[result.universe] ?? result.universe} · {TIMEFRAMES[result.timeframe] ?? result.timeframe}
                  </span>
                  {result.is_stale && (
                    <span className="text-[10px] font-mono text-neutral border border-neutral/20 bg-neutral/5 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Stale
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-mono text-text-muted">
                  {result.scan_time_ms}ms · {result.total_scanned} scanned
                </span>
              </div>

              {result.match_count === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Filter className="w-10 h-10 text-text-muted mb-3 opacity-30" />
                  <p className="text-sm font-medium text-text-secondary">No matches found</p>
                  <p className="text-xs text-text-muted mt-1">Try relaxing your conditions or switching universe</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-primary text-[10px] font-mono text-text-muted uppercase tracking-wider">
                        <th className="text-left px-5 py-2.5">Symbol</th>
                        <th className="text-right px-4 py-2.5 cursor-pointer hover:text-text-primary" onClick={() => toggleSort("ltp")}>
                          <span className="flex items-center justify-end gap-1">LTP <SortIcon field="ltp" /></span>
                        </th>
                        <th className="text-right px-4 py-2.5 cursor-pointer hover:text-text-primary" onClick={() => toggleSort("change_pct")}>
                          <span className="flex items-center justify-end gap-1">% Chg <SortIcon field="change_pct" /></span>
                        </th>
                        <th className="text-right px-4 py-2.5 cursor-pointer hover:text-text-primary" onClick={() => toggleSort("rsi")}>
                          <span className="flex items-center justify-end gap-1">RSI <SortIcon field="rsi" /></span>
                        </th>
                        <th className="text-left px-4 py-2.5">Signal</th>
                        <th className="text-left px-4 py-2.5">Indicators</th>
                        <th className="text-right px-4 py-2.5 cursor-pointer hover:text-text-primary" onClick={() => toggleSort("volume")}>
                          <span className="flex items-center justify-end gap-1">Volume <SortIcon field="volume" /></span>
                        </th>
                        <th className="text-center px-4 py-2.5">Chart</th>
                        <th className="text-left px-4 py-2.5">Time</th>
                        <th className="text-center px-4 py-2.5">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-primary/50">
                      {sortedMatches.map((m, idx) => {
                        const pos = m.change_pct >= 0;
                        const sym = m.symbol.replace(/\.(NS|BO)$/, "");
                        const rsiVal = m.indicators.rsi;
                        const stDir = m.indicators.supertrend;
                        const volRatio = m.indicators.volume_ratio;
                        return (
                          <tr
                            key={m.symbol}
                            className="hover:bg-bg-elevated/50 transition-colors group"
                          >
                            {/* Symbol */}
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-text-muted font-mono w-5 text-right">{idx + 1}</span>
                                <div>
                                  <p className="font-mono font-bold text-text-primary text-sm">{sym}</p>
                                  <p className="text-[10px] text-text-muted">{UNIVERSES[result.universe]}</p>
                                </div>
                              </div>
                            </td>

                            {/* LTP */}
                            <td className="px-4 py-3 text-right">
                              <span className="font-mono font-semibold text-text-primary">₹{m.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                            </td>

                            {/* % Chg */}
                            <td className="px-4 py-3 text-right">
                              <span className={`font-mono font-semibold text-sm ${pos ? "text-positive" : "text-negative"}`}>
                                {pos ? "+" : ""}{m.change_pct.toFixed(2)}%
                              </span>
                            </td>

                            {/* RSI */}
                            <td className="px-4 py-3 text-right">
                              {rsiVal !== null ? (
                                <span className={`font-mono text-sm font-medium ${
                                  rsiVal > 70 ? "text-negative" : rsiVal < 30 ? "text-positive" : "text-text-secondary"
                                }`}>
                                  {rsiVal.toFixed(1)}
                                </span>
                              ) : <span className="text-text-muted">—</span>}
                            </td>

                            {/* Signal value */}
                            <td className="px-4 py-3">
                              <span className={`text-xs font-mono px-2 py-1 rounded-lg font-medium ${
                                pos ? "bg-positive/10 text-positive border border-positive/15" : "bg-negative/10 text-negative border border-negative/15"
                              }`}>
                                {m.signal_value}
                              </span>
                            </td>

                            {/* Indicators summary */}
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {stDir && <IndBadge label="ST" value={stDir.toUpperCase()} positive={stDir === "up"} />}
                                {m.indicators.adx !== null && <IndBadge label="ADX" value={m.indicators.adx.toFixed(0)} />}
                                {volRatio !== null && volRatio > 1.5 && <IndBadge label="Vol" value={`${volRatio.toFixed(1)}x`} positive />}
                              </div>
                            </td>

                            {/* Volume */}
                            <td className="px-4 py-3 text-right">
                              <span className="font-mono text-xs text-text-secondary">{fmtVol(m.volume)}</span>
                            </td>

                            {/* Sparkline */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex justify-center">
                                <Sparkline data={m.sparkline} positive={pos} />
                              </div>
                            </td>

                            {/* Signal time */}
                            <td className="px-4 py-3">
                              <span className="text-[11px] font-mono text-text-muted">{fmtTime(m.signal_time)}</span>
                            </td>

                            {/* Actions */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <Link
                                  href={`/ticker/${sym}`}
                                  title="Open Deep-Dive"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
                                >
                                  <TrendingUp className="w-3.5 h-3.5" />
                                </Link>
                                <button
                                  title="Add to Watchlist"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-positive hover:bg-positive/10 transition-all"
                                >
                                  <Star className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  title="Set Alert"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-neutral hover:bg-neutral/10 transition-all"
                                >
                                  <Bell className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── SAVED SCANS PANEL ────────────────────────────────────────────── */}
        {showSaved && (
          <div className="w-72 border-l border-border-primary bg-bg-secondary/60 backdrop-blur flex flex-col shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
              <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5 text-accent-primary" /> Saved Scans
              </span>
              <button onClick={() => setShowSaved(false)} className="text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {savedScans.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-xs">
                  <Save className="w-6 h-6 mx-auto mb-2 opacity-20" />
                  No saved scans yet
                </div>
              ) : savedScans.map(s => (
                <div key={s.id} className="p-3 rounded-xl border border-border-primary bg-bg-elevated/50 hover:border-accent-primary/20 transition-all">
                  <div className="flex items-start justify-between mb-1.5">
                    <p className="text-xs font-semibold text-text-primary">{s.name}</p>
                    <button
                      onClick={() => deleteScan(s.id)}
                      className="text-text-muted hover:text-negative transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[10px] text-text-muted font-mono mb-2">
                    {UNIVERSES[s.query.universe] ?? s.query.universe} · {TIMEFRAMES[s.query.timeframe] ?? s.query.timeframe} · {s.query.conditions.length} condition{s.query.conditions.length !== 1 ? "s" : ""}
                  </p>
                  <button
                    onClick={() => {
                      setUniverse(s.query.universe);
                      setTimeframe(s.query.timeframe);
                      setGlobalLogic((s.query.logic as "AND" | "OR") ?? "AND");
                      setConditions(s.query.conditions.map((c: Condition) => ({ ...c, id: uid() })));
                      setResult(null);
                    }}
                    className="w-full text-xs font-medium text-accent-primary border border-accent-primary/20 bg-accent-primary/5 hover:bg-accent-primary/10 rounded-lg py-1.5 transition-all"
                  >
                    Load Scan
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── SAVE SCAN MODAL ──────────────────────────────────────────────────── */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="glass-panel w-80 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-primary">Save Scan</h3>
              <button onClick={() => setShowSaveModal(false)} className="text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveScan()}
              placeholder="e.g. RSI Oversold Bank Nifty"
              className="w-full bg-bg-tertiary border border-border-primary text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50 mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 py-2 text-xs font-medium text-text-secondary border border-border-primary rounded-lg hover:bg-bg-tertiary transition-all"
              >
                Cancel
              </button>
              <button
                onClick={saveScan}
                disabled={!saveName.trim()}
                className="flex-1 py-2 text-xs font-semibold bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition-all disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
