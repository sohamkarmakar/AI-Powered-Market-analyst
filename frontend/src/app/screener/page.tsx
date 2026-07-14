"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Plus, X, Search, ArrowUpRight, ArrowDownRight,
  TrendingUp, TrendingDown, BarChart2, Activity,
  RefreshCw, ChevronUp, ChevronDown, ExternalLink,
  Info, Star, Layers, Wifi, WifiOff, Clock
} from "lucide-react";
import SearchAutocomplete from "@/components/SearchAutocomplete";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Quote {
  symbol: string;
  name: string;
  sector: string;
  market_state: string;
  price: number | null;
  open: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  day_high: number | null;
  day_low: number | null;
  year_high: number | null;
  year_low: number | null;
  volume: number | null;
  avg_volume: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  forward_pe: number | null;
  beta: number | null;
  eps: number | null;
  dividend_yield: number | null;
  roe: number | null;
  profit_margins: number | null;
  debt_to_equity: number | null;
  target_mean: number | null;
  recommendation: string | null;
  error?: string;
}

interface IndexData {
  label: string;
  symbol: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  error?: string;
}

interface IntraBar { t: string; c: number; v: number; }

type SortField = keyof Quote;
type SortDir = "asc" | "desc";
type FlashDir = "up" | "down";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const API = "http://127.0.0.1:8000";
const DEFAULT_WATCHLIST = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "BHARTIARTL", "WIPRO", "ADANIENT", "LTIM"];

function normBase(s: string) { return s.toUpperCase().replace(/\.(NS|BO)$/, ""); }

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return "–";
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtCr(n: number | null | undefined): string {
  if (!n) return "–";
  if (n >= 1e12) return `₹${(n / 1e12).toFixed(2)}L Cr`;
  if (n >= 1e7)  return `₹${(n / 1e7).toFixed(0)} Cr`;
  return `₹${n.toLocaleString("en-IN")}`;
}
function fmtVol(n: number | null | undefined): string {
  if (!n) return "–";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ─────────────────────────────────────────────────────────
// Mini Sparkline (SVG)
// ─────────────────────────────────────────────────────────

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) return <div className="w-24 h-8 opacity-30 text-gray-600 text-[10px] flex items-center">No data</div>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const w = 96, h = 32, pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(" ");
  const color = positive ? "#10b981" : "#ef4444";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <defs>
        <linearGradient id={`sg-${positive}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#sg-${positive})`} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// Detail Panel
// ─────────────────────────────────────────────────────────

function DetailPanel({ quote, intraday, onClose }: { quote: Quote; intraday: IntraBar[]; onClose: () => void }) {
  const closes = intraday.map(c => c.c);
  const isUp = (quote.change ?? 0) >= 0;

  const fundamentals = [
    { label: "P/E (TTM)",        value: quote.pe_ratio ? fmt(quote.pe_ratio) : "–" },
    { label: "Forward P/E",      value: quote.forward_pe ? fmt(quote.forward_pe) : "–" },
    { label: "EPS",              value: quote.eps ? `₹${fmt(quote.eps)}` : "–" },
    { label: "Beta",             value: quote.beta ? fmt(quote.beta) : "–" },
    { label: "Div Yield",        value: quote.dividend_yield ? `${(quote.dividend_yield * 100).toFixed(2)}%` : "–" },
    { label: "ROE",              value: quote.roe ? `${(quote.roe * 100).toFixed(1)}%` : "–" },
    { label: "Profit Margin",    value: quote.profit_margins ? `${(quote.profit_margins * 100).toFixed(1)}%` : "–" },
    { label: "D/E Ratio",        value: quote.debt_to_equity ? fmt(quote.debt_to_equity) : "–" },
    { label: "Analyst Target",   value: quote.target_mean ? `₹${fmt(quote.target_mean)}` : "–" },
    { label: "Recommendation",   value: quote.recommendation ? quote.recommendation.toUpperCase() : "–" },
  ];

  const dayRange  = quote.day_high && quote.day_low ? ((( quote.price ?? quote.day_low) - quote.day_low) / (quote.day_high - quote.day_low)) * 100 : null;
  const yearRange = quote.year_high && quote.year_low ? (((quote.price ?? quote.year_low) - quote.year_low) / (quote.year_high - quote.year_low)) * 100 : null;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-[#080d1a] border-l border-[rgba(255,255,255,0.06)] z-50 flex flex-col shadow-2xl shadow-black/60 overflow-y-auto">
      {/* Header */}
      <div className={`p-5 border-b border-[rgba(255,255,255,0.06)] ${isUp ? "bg-emerald-500/5" : "bg-rose-500/5"}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono font-bold text-xl text-white">{normBase(quote.symbol)}</span>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">{quote.sector !== "N/A" ? quote.sector : "NSE"}</span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5 max-w-[280px] line-clamp-1">{quote.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4">
          <div className={`text-3xl font-mono font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
            {quote.price ? `₹${fmt(quote.price)}` : "–"}
          </div>
          <div className={`flex items-center space-x-2 mt-1 text-sm font-mono ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
            {isUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            <span>{quote.change ? `${isUp ? "+" : ""}₹${fmt(Math.abs(quote.change))}` : "–"}</span>
            <span className="text-gray-500">|</span>
            <span>{fmtPct(quote.change_pct)}</span>
          </div>
        </div>
      </div>

      {/* Sparkline */}
      {closes.length > 2 && (
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Intraday (5-min)</span>
          </div>
          <div className="w-full h-16 flex items-center">
            <svg width="100%" height="64" viewBox={`0 0 ${closes.length} 64`} preserveAspectRatio="none">
              {(() => {
                const mn = Math.min(...closes), mx = Math.max(...closes), rng = mx - mn || 1;
                const pts = closes.map((v, i) => `${i},${64 - ((v - mn) / rng) * 60 - 2}`).join(" ");
                const c = isUp ? "#10b981" : "#ef4444";
                return (
                  <>
                    <defs>
                      <linearGradient id="dp-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={c} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
                    <polygon points={`0,64 ${pts} ${closes.length - 1},64`} fill="url(#dp-grad)" />
                  </>
                );
              })()}
            </svg>
          </div>
        </div>
      )}

      {/* OHLC + Range */}
      <div className="px-5 py-3 grid grid-cols-2 gap-3 border-y border-[rgba(255,255,255,0.04)]">
        {[
          { label: "Open",       value: quote.open      ? `₹${fmt(quote.open)}` : "–" },
          { label: "Prev Close", value: quote.prev_close ? `₹${fmt(quote.prev_close)}` : "–" },
          { label: "Day High",   value: quote.day_high  ? `₹${fmt(quote.day_high)}` : "–", color: "text-emerald-400" },
          { label: "Day Low",    value: quote.day_low   ? `₹${fmt(quote.day_low)}` : "–",  color: "text-rose-400" },
          { label: "52W High",   value: quote.year_high ? `₹${fmt(quote.year_high)}` : "–", color: "text-emerald-400/70" },
          { label: "52W Low",    value: quote.year_low  ? `₹${fmt(quote.year_low)}` : "–",  color: "text-rose-400/70" },
          { label: "Volume",     value: fmtVol(quote.volume) },
          { label: "Avg Vol",    value: fmtVol(quote.avg_volume) },
          { label: "Market Cap", value: fmtCr(quote.market_cap) },
        ].map(item => (
          <div key={item.label}>
            <p className="text-[10px] text-gray-500 font-mono">{item.label}</p>
            <p className={`text-xs font-mono font-semibold mt-0.5 ${(item as any).color || "text-white"}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* Range bars */}
      <div className="px-5 py-3 space-y-3 border-b border-[rgba(255,255,255,0.04)]">
        {dayRange !== null && (
          <div>
            <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1">
              <span>Day Range</span>
              <span>{quote.day_low ? `₹${fmt(quote.day_low)}` : ""} – {quote.day_high ? `₹${fmt(quote.day_high)}` : ""}</span>
            </div>
            <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-500 to-emerald-500 rounded-full" style={{ width: "100%" }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md border border-black/20" style={{ left: `calc(${Math.min(Math.max(dayRange, 0), 100)}% - 5px)` }} />
            </div>
          </div>
        )}
        {yearRange !== null && (
          <div>
            <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1">
              <span>52W Range</span>
              <span>{quote.year_low ? `₹${fmt(quote.year_low)}` : ""} – {quote.year_high ? `₹${fmt(quote.year_high)}` : ""}</span>
            </div>
            <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-500/60 to-emerald-500/60 rounded-full" style={{ width: "100%" }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md border border-black/20" style={{ left: `calc(${Math.min(Math.max(yearRange, 0), 100)}% - 5px)` }} />
            </div>
          </div>
        )}
      </div>

      {/* Fundamentals */}
      <div className="px-5 py-3">
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">Fundamentals</p>
        <div className="grid grid-cols-2 gap-2">
          {fundamentals.map(f => (
            <div key={f.label} className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2">
              <p className="text-[10px] text-gray-500 font-mono">{f.label}</p>
              <p className="text-xs font-mono font-semibold text-white mt-0.5">{f.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-5 pb-5 pt-2 mt-auto">
        <Link
          href={`/ticker/${normBase(quote.symbol)}`}
          className="w-full flex items-center justify-center space-x-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 shadow-lg shadow-blue-500/20"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Full Analysis Terminal</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingSymbols, setLoadingSymbols] = useState<Set<string>>(new Set());
  const [flashMap, setFlashMap] = useState<Record<string, FlashDir>>({});
  const [intraday, setIntraday] = useState<IntraBar[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("ALL");
  const [online, setOnline] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [addingTicker, setAddingTicker] = useState(false);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const indexPollRef = useRef<NodeJS.Timeout | null>(null);
  const prevPricesRef = useRef<Record<string, number>>({});

  // ── localStorage helpers ──────────────────────────────
  const persistWatchlist = useCallback((list: string[]) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("watchlist_v2", JSON.stringify(list));
    }
  }, []);

  const loadWatchlist = useCallback((): string[] => {
    if (typeof window === "undefined") return DEFAULT_WATCHLIST;
    const raw = localStorage.getItem("watchlist_v2");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return [...new Set(parsed.map(normBase))];
        }
      } catch { /* ignore */ }
    }
    return DEFAULT_WATCHLIST;
  }, []);

  // ── Fetch batch quotes ────────────────────────────────
  const fetchBatchQuotes = useCallback(async (syms: string[], isInitial = false) => {
    if (syms.length === 0) return;
    if (isInitial) setLoadingInit(true);
    try {
      const res = await fetch(`${API}/api/quotes/batch?symbols=${syms.join(",")}`);
      if (!res.ok) throw new Error("Batch fetch failed");
      const data = await res.json();
      const incoming: Record<string, Quote> = data.quotes || {};
      const newFlash: Record<string, FlashDir> = {};

      setQuotes(prev => {
        const merged = { ...prev };
        for (const [sym, q] of Object.entries(incoming)) {
          if (q.error) continue;
          const newPrice = q.price ?? 0;
          const oldPrice = prevPricesRef.current[sym] ?? 0;
          if (oldPrice !== 0 && newPrice !== 0 && newPrice !== oldPrice) {
            newFlash[sym] = newPrice > oldPrice ? "up" : "down";
          }
          if (newPrice > 0) prevPricesRef.current[sym] = newPrice;
          merged[sym] = q as Quote;
        }
        return merged;
      });

      if (Object.keys(newFlash).length > 0) {
        setFlashMap(prev => ({ ...prev, ...newFlash }));
        setTimeout(() => {
          setFlashMap(prev => {
            const next = { ...prev };
            Object.keys(newFlash).forEach(k => delete next[k]);
            return next;
          });
        }, 1000);
      }
      setOnline(true);
      setLastUpdated(new Date());
    } catch (e) {
      setOnline(false);
    } finally {
      if (isInitial) setLoadingInit(false);
    }
  }, []);

  // ── Fetch indices ─────────────────────────────────────
  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/indices`);
      if (!res.ok) return;
      const data = await res.json();
      setIndices(data.indices || []);
    } catch { /* silent */ }
  }, []);

  // ── Fetch intraday for selected symbol ───────────────
  const fetchIntraday = useCallback(async (sym: string) => {
    try {
      const res = await fetch(`${API}/api/ticker/${sym}/intraday?period=1d`);
      if (!res.ok) return;
      const data = await res.json();
      setIntraday(data.candles || []);
    } catch { setIntraday([]); }
  }, []);

  // ── Initial load ──────────────────────────────────────
  useEffect(() => {
    const list = loadWatchlist();
    setWatchlist(list);
    fetchBatchQuotes(list, true);
    fetchIndices();
  }, []);

  // ── Start polling once initial load done ──────────────
  useEffect(() => {
    if (loadingInit || watchlist.length === 0) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchBatchQuotes(watchlist), 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadingInit, watchlist, fetchBatchQuotes]);

  // ── Poll indices every 30s ────────────────────────────
  useEffect(() => {
    indexPollRef.current = setInterval(fetchIndices, 30000);
    return () => { if (indexPollRef.current) clearInterval(indexPollRef.current); };
  }, [fetchIndices]);

  // ── Fetch intraday when selection changes ─────────────
  useEffect(() => {
    if (selectedSymbol) fetchIntraday(selectedSymbol);
    else setIntraday([]);
  }, [selectedSymbol, fetchIntraday]);

  // ── Add symbol ────────────────────────────────────────
  const addSymbol = useCallback(async (raw: string) => {
    const sym = normBase(raw);
    if (!sym || watchlist.includes(sym)) return;
    setAddingTicker(true);
    try {
      setLoadingSymbols(prev => new Set([...prev, sym]));
      const updated = [...watchlist, sym];
      setWatchlist(updated);
      persistWatchlist(updated);
      await fetchBatchQuotes([sym]);
    } finally {
      setLoadingSymbols(prev => { const s = new Set(prev); s.delete(sym); return s; });
      setAddingTicker(false);
    }
  }, [watchlist, fetchBatchQuotes, persistWatchlist]);

  // ── Remove symbol ─────────────────────────────────────
  const removeSymbol = useCallback((sym: string) => {
    const updated = watchlist.filter(s => s !== sym);
    setWatchlist(updated);
    persistWatchlist(updated);
    if (selectedSymbol === sym) setSelectedSymbol(null);
    setQuotes(prev => { const n = { ...prev }; delete n[`${sym}.NS`]; delete n[sym]; return n; });
  }, [watchlist, selectedSymbol, persistWatchlist]);

  // ── Manual refresh ────────────────────────────────────
  const manualRefresh = useCallback(() => {
    fetchBatchQuotes(watchlist);
    fetchIndices();
  }, [watchlist, fetchBatchQuotes, fetchIndices]);

  // ── Sort ──────────────────────────────────────────────
  const requestSort = (field: SortField) => {
    setSortDir(prev => sortField === field && prev === "asc" ? "desc" : "asc");
    setSortField(field);
  };

  // ── Derived rows ──────────────────────────────────────
  const rows = useMemo(() => {
    const term = filter.toLowerCase().trim();
    return watchlist
      .map(sym => {
        const key = Object.keys(quotes).find(k => normBase(k) === sym) || `${sym}.NS`;
        return { sym, q: quotes[key] || null };
      })
      .filter(({ sym, q }) => {
        if (term && !sym.toLowerCase().includes(term) && !(q?.name || "").toLowerCase().includes(term)) return false;
        if (sectorFilter !== "ALL" && q?.sector !== sectorFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (!a.q && !b.q) return 0;
        if (!a.q) return 1;
        if (!b.q) return -1;
        const av = a.q[sortField] as any, bv = b.q[sortField] as any;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [watchlist, quotes, filter, sectorFilter, sortField, sortDir]);

  const availableSectors = useMemo(() => {
    const s = new Set<string>();
    Object.values(quotes).forEach(q => { if (q.sector && q.sector !== "N/A") s.add(q.sector); });
    return ["ALL", ...Array.from(s).sort()];
  }, [quotes]);

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────

  const SortIcon = ({ field }: { field: SortField }) =>
    sortField === field
      ? sortDir === "asc" ? <ChevronUp className="w-3 h-3 ml-0.5 text-blue-400" /> : <ChevronDown className="w-3 h-3 ml-0.5 text-blue-400" />
      : <ChevronUp className="w-3 h-3 ml-0.5 text-gray-600 opacity-0 group-hover:opacity-100" />;

  const ColHeader = ({ label, field, className = "" }: { label: string; field: SortField; className?: string }) => (
    <th
      className={`px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 cursor-pointer select-none group ${className}`}
      onClick={() => requestSort(field)}
    >
      <div className="flex items-center font-mono">
        {label}
        <SortIcon field={field} />
      </div>
    </th>
  );

  const selectedQuote = selectedSymbol
    ? Object.values(quotes).find(q => normBase(q.symbol) === selectedSymbol) ?? null
    : null;

  // NSE Market Hours (IST): 9:15 – 15:30
  const getMarketStatus = () => {
    const now = new Date();
    const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const h = ist.getHours(), m = ist.getMinutes();
    const mins = h * 60 + m;
    const day = ist.getDay();
    if (day === 0 || day === 6) return { label: "MARKET CLOSED", color: "text-red-400", bg: "bg-red-500/10" };
    if (mins < 9 * 60 + 15) return { label: "PRE-OPEN", color: "text-amber-400", bg: "bg-amber-500/10" };
    if (mins <= 15 * 60 + 30) return { label: "NSE OPEN", color: "text-emerald-400", bg: "bg-emerald-500/10" };
    return { label: "MARKET CLOSED", color: "text-red-400", bg: "bg-red-500/10" };
  };
  const mktStatus = getMarketStatus();

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      {/* ── Indices Strip ────────────────────────────────── */}
      <div className="flex items-center space-x-1 px-4 py-2 border-b border-[rgba(255,255,255,0.05)] bg-[#050810] overflow-x-auto shrink-0">
        <span className={`text-[9px] font-bold font-mono px-2 py-1 rounded ${mktStatus.bg} ${mktStatus.color} mr-2 shrink-0 uppercase tracking-widest`}>
          {mktStatus.label}
        </span>
        {indices.length === 0
          ? [1, 2, 3, 4].map(i => <div key={i} className="h-7 w-28 bg-white/5 rounded animate-pulse shrink-0" />)
          : indices.map(idx => {
              const up = (idx.change_pct ?? 0) >= 0;
              return (
                <div key={idx.symbol} className="flex items-center space-x-3 px-3 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04] shrink-0">
                  <span className="text-[10px] font-mono text-gray-400">{idx.label}</span>
                  <span className="text-[11px] font-mono font-bold text-white">{idx.price ? idx.price.toLocaleString("en-IN") : "–"}</span>
                  <span className={`text-[10px] font-mono font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                    {up ? "▲" : "▼"} {Math.abs(idx.change_pct ?? 0).toFixed(2)}%
                  </span>
                </div>
              );
            })}

        <div className="ml-auto flex items-center space-x-2 shrink-0">
          {online
            ? <><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" /></span><span className="text-[9px] font-mono text-emerald-500">LIVE · 10s</span></>
            : <><WifiOff className="w-3 h-3 text-red-400" /><span className="text-[9px] font-mono text-red-400">OFFLINE</span></>
          }
          {lastUpdated && <span className="text-[9px] font-mono text-gray-600">{lastUpdated.toLocaleTimeString("en-IN")}</span>}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        <div className={`flex flex-col flex-1 overflow-hidden transition-all duration-300 ${selectedSymbol ? "mr-[420px]" : ""}`}>

          {/* ── Toolbar ─────────────────────────────────── */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgba(255,255,255,0.05)] shrink-0 bg-[#060b18]/80 backdrop-blur-sm">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Watchlist</h2>
              <p className="text-[10px] font-mono text-gray-600">{watchlist.length} STOCKS · LIVE NSE DATA</p>
            </div>

            <div className="flex-1 max-w-xs">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Filter watchlist..."
                  className="w-full pl-9 pr-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-xs text-white placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>

            <select
              value={sectorFilter}
              onChange={e => setSectorFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none cursor-pointer"
            >
              {availableSectors.map(s => <option key={s} value={s}>{s === "ALL" ? "All Sectors" : s}</option>)}
            </select>

            <div className="flex-1 max-w-[220px]">
              <SearchAutocomplete
                placeholder="Add stock to watchlist..."
                clearOnSelect
                onSelect={addSymbol}
              />
            </div>

            <button
              onClick={manualRefresh}
              className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] text-gray-400 hover:text-white transition-all cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ── Table ───────────────────────────────────── */}
          <div className="flex-1 overflow-auto">
            <style>{`
              @keyframes flashUp {
                0%   { background-color: rgba(16,185,129,0.18); }
                100% { background-color: transparent; }
              }
              @keyframes flashDown {
                0%   { background-color: rgba(239,68,68,0.18); }
                100% { background-color: transparent; }
              }
              .row-flash-up   { animation: flashUp   1s ease-out; }
              .row-flash-down { animation: flashDown 1s ease-out; }
              .row-selected   { background-color: rgba(59,130,246,0.07) !important; }
              th { white-space: nowrap; }
              td { white-space: nowrap; }
            `}</style>

            {loadingInit ? (
              <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 border-2 border-blue-500/30 rounded-full" />
                  <div className="absolute inset-0 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <p className="text-xs font-mono text-gray-500">Fetching live quotes from NSE…</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[1100px]">
                <thead className="sticky top-0 z-10 bg-[#060b18] border-b border-[rgba(255,255,255,0.06)]">
                  <tr>
                    <th className="px-3 py-3 w-8"></th>
                    <ColHeader label="Symbol"   field="symbol"     className="min-w-[100px]" />
                    <ColHeader label="LTP"      field="price"      className="text-right min-w-[90px]" />
                    <ColHeader label="Chg"      field="change"     className="text-right min-w-[80px]" />
                    <ColHeader label="Chg %"    field="change_pct" className="text-right min-w-[70px]" />
                    <ColHeader label="Open"     field="open"       className="text-right min-w-[80px]" />
                    <ColHeader label="High"     field="day_high"   className="text-right min-w-[80px]" />
                    <ColHeader label="Low"      field="day_low"    className="text-right min-w-[80px]" />
                    <ColHeader label="52W H"    field="year_high"  className="text-right min-w-[80px]" />
                    <ColHeader label="52W L"    field="year_low"   className="text-right min-w-[80px]" />
                    <ColHeader label="Volume"   field="volume"     className="text-right min-w-[80px]" />
                    <ColHeader label="Mkt Cap"  field="market_cap" className="text-right min-w-[100px]" />
                    <ColHeader label="P/E"      field="pe_ratio"   className="text-right min-w-[60px]" />
                    <ColHeader label="Beta"     field="beta"       className="text-right min-w-[55px]" />
                    <th className="px-3 py-3 text-[10px] font-mono text-gray-500 uppercase tracking-wider min-w-[100px]">Sparkline</th>
                    <th className="px-3 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={16} className="py-20 text-center">
                      <div className="flex flex-col items-center space-y-3">
                        <Layers className="w-8 h-8 text-gray-700" />
                        <p className="text-xs font-mono text-gray-600">No stocks match your filter</p>
                      </div>
                    </td></tr>
                  ) : rows.map(({ sym, q }) => {
                    const qKey = q ? q.symbol : `${sym}.NS`;
                    const flash = flashMap[qKey];
                    const isUp = (q?.change ?? 0) >= 0;
                    const isSelected = selectedSymbol === sym;
                    const isLoading = loadingSymbols.has(sym);
                    const sparkData = q ? [q.day_low, q.open, q.price, q.day_high].filter(Boolean) as number[] : [];

                    return (
                      <tr
                        key={sym}
                        onClick={() => setSelectedSymbol(isSelected ? null : sym)}
                        className={`border-b border-[rgba(255,255,255,0.03)] cursor-pointer transition-colors hover:bg-white/[0.025] ${flash === "up" ? "row-flash-up" : flash === "down" ? "row-flash-down" : ""} ${isSelected ? "row-selected" : ""}`}
                      >
                        {/* Star */}
                        <td className="px-3 py-2.5 text-center">
                          <Star className={`w-3 h-3 ${isSelected ? "text-yellow-400 fill-yellow-400" : "text-gray-700"}`} />
                        </td>

                        {/* Symbol + Name */}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-mono font-bold text-white">{sym}</span>
                            <span className="text-[10px] text-gray-500 max-w-[130px] truncate">{q?.name || "–"}</span>
                          </div>
                        </td>

                        {/* LTP */}
                        <td className="px-3 py-2.5 text-right">
                          {isLoading ? <div className="h-4 w-16 bg-white/5 rounded animate-pulse ml-auto" /> :
                            <span className={`text-sm font-mono font-bold ${isUp ? "text-white" : "text-white"}`}>
                              {q?.price ? `₹${fmt(q.price)}` : "–"}
                            </span>}
                        </td>

                        {/* Change */}
                        <td className={`px-3 py-2.5 text-right text-xs font-mono font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                          {q?.change !== null && q?.change !== undefined ? `${isUp ? "+" : ""}₹${fmt(Math.abs(q.change))}` : "–"}
                        </td>

                        {/* Change % */}
                        <td className="px-3 py-2.5 text-right">
                          <span className={`inline-flex items-center text-xs font-mono font-bold px-1.5 py-0.5 rounded ${isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                            {isUp ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                            {q?.change_pct !== null && q?.change_pct !== undefined ? `${Math.abs(q.change_pct).toFixed(2)}%` : "–"}
                          </span>
                        </td>

                        {/* Open */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-400">
                          {q?.open ? `₹${fmt(q.open)}` : "–"}
                        </td>

                        {/* High */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-emerald-400/80">
                          {q?.day_high ? `₹${fmt(q.day_high)}` : "–"}
                        </td>

                        {/* Low */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-rose-400/80">
                          {q?.day_low ? `₹${fmt(q.day_low)}` : "–"}
                        </td>

                        {/* 52W High */}
                        <td className="px-3 py-2.5 text-right text-[11px] font-mono text-emerald-400/50">
                          {q?.year_high ? `₹${fmt(q.year_high)}` : "–"}
                        </td>

                        {/* 52W Low */}
                        <td className="px-3 py-2.5 text-right text-[11px] font-mono text-rose-400/50">
                          {q?.year_low ? `₹${fmt(q.year_low)}` : "–"}
                        </td>

                        {/* Volume */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-400">
                          {fmtVol(q?.volume)}
                        </td>

                        {/* Market Cap */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-300">
                          {fmtCr(q?.market_cap)}
                        </td>

                        {/* P/E */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-400">
                          {q?.pe_ratio ? fmt(q.pe_ratio, 1) : "–"}
                        </td>

                        {/* Beta */}
                        <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-500">
                          {q?.beta ? fmt(q.beta) : "–"}
                        </td>

                        {/* Sparkline */}
                        <td className="px-3 py-2.5">
                          <Sparkline data={sparkData} positive={isUp} />
                        </td>

                        {/* Remove */}
                        <td className="px-2 py-2.5 text-center">
                          <button
                            onClick={e => { e.stopPropagation(); removeSymbol(sym); }}
                            className="p-1 text-gray-700 hover:text-rose-400 transition-colors cursor-pointer opacity-0 group-hover:opacity-100 hover:opacity-100 rounded"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Footer stats bar ────────────────────────── */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-[rgba(255,255,255,0.04)] bg-[#060b18] text-[10px] font-mono text-gray-600 shrink-0">
            <span>{rows.length} of {watchlist.length} symbols shown</span>
            <span className="flex items-center space-x-1">
              <Clock className="w-3 h-3" />
              <span>Auto-refresh every 10s · Yahoo Finance API</span>
            </span>
          </div>
        </div>

        {/* ── Detail Panel ─────────────────────────────── */}
        {selectedSymbol && selectedQuote && (
          <DetailPanel
            quote={selectedQuote}
            intraday={intraday}
            onClose={() => setSelectedSymbol(null)}
          />
        )}
      </div>
    </div>
  );
}
