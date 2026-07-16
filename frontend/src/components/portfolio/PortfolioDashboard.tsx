"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Loader2,
  BarChart2, PieChart, Upload, PlusCircle, Sparkles, Pencil,
  Trash2, Check, X, ShieldAlert, ShieldCheck, Activity,
  ArrowUpRight, ArrowDownRight, Minus
} from "lucide-react";
import {
  PieChart as RePieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from "recharts";

const API = "http://127.0.0.1:8000";

const fmt = (n: number | null | undefined, decimals = 2) =>
  n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtCrore = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${fmt(n, 0)}`;
};

const PALETTE = [
  "#3b82f6","#22c55e","#f59e0b","#ef4444","#8b5cf6","#06b6d4",
  "#ec4899","#14b8a6","#f97316","#a3e635","#fb7185","#60a5fa",
];

interface PortfolioDashboardProps {
  portfolioId: string;
  portfolioName: string;
  onAddManual: () => void;
  onUpload: () => void;
}

export default function PortfolioDashboard({
  portfolioId, portfolioName, onAddManual, onUpload
}: PortfolioDashboardProps) {
  const [analysis, setAnalysis] = useState<any>(null);
  const [narrative, setNarrative] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allocationView, setAllocationView] = useState<"stock" | "sector" | "cap">("sector");
  const [activeTab, setActiveTab] = useState<"overview" | "holdings">("overview");

  const fetchAnalysis = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/portfolio/${portfolioId}/analysis${refresh ? "?refresh=true" : ""}`);
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail || "Failed to load analysis");
        return;
      }
      const data = await res.json();
      setAnalysis(data);
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }, [portfolioId]);

  const fetchNarrative = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/portfolio/${portfolioId}/narrative`);
      if (res.ok) {
        const data = await res.json();
        setNarrative(data.narrative);
      }
    } catch {}
  }, [portfolioId]);

  const generateNarrative = async () => {
    setNarrativeLoading(true);
    try {
      const res = await fetch(`${API}/api/portfolio/${portfolioId}/narrative/generate`, { method: "POST" });
      const data = await res.json();
      if (data.narrative) setNarrative(data.narrative);
    } catch {} finally {
      setNarrativeLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalysis();
    fetchNarrative();
  }, [portfolioId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
        <p className="text-text-muted text-sm">Loading portfolio analysis…</p>
        <p className="text-xs text-text-muted">Fetching live prices for all holdings</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
        <AlertTriangle className="w-10 h-10 text-neutral" />
        <p className="text-text-primary font-semibold">{error}</p>
        <button
          onClick={() => fetchAnalysis()}
          className="px-4 py-2 text-sm text-accent-primary border border-accent-primary/30 rounded-lg hover:bg-accent-primary/10 transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!analysis) return null;

  const { summary, holdings, stock_allocation, sector_allocation, cap_allocation, concentration_flags, diversification_score } = analysis;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Summary Cards */}
      <SummaryCards summary={summary} />

      {/* Concentration Alerts */}
      {concentration_flags.length > 0 && (
        <ConcentrationPanel flags={concentration_flags} divScore={diversification_score} />
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-border-primary">
        <div className="flex gap-1">
          {(["overview", "holdings"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px capitalize ${
                activeTab === tab
                  ? "border-accent-primary text-accent-primary"
                  : "border-transparent text-text-muted hover:text-text-primary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <button
          onClick={() => fetchAnalysis(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 mb-1 text-xs text-text-secondary hover:text-accent-primary hover:bg-bg-tertiary rounded-lg transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Allocation Chart */}
          <div className="xl:col-span-2 bg-bg-elevated border border-border-primary rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <PieChart className="w-4 h-4 text-accent-primary" />
                Allocation Breakdown
              </h3>
              <div className="flex gap-1">
                {(["sector", "stock", "cap"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setAllocationView(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                      allocationView === v
                        ? "bg-accent-primary text-white"
                        : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
                    }`}
                  >
                    {v === "cap" ? "Market Cap" : v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <AllocationChart
              view={allocationView}
              stockAlloc={stock_allocation}
              sectorAlloc={sector_allocation}
              capAlloc={cap_allocation}
            />
          </div>

          {/* AI Narrative */}
          <AInarrativeCard
            narrative={narrative}
            loading={narrativeLoading}
            onGenerate={generateNarrative}
          />
        </div>
      )}

      {/* Holdings Tab */}
      {activeTab === "holdings" && (
        <HoldingsTable
          holdings={holdings}
          portfolioId={portfolioId}
          onRefresh={() => fetchAnalysis(true)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SUMMARY CARDS
// ─────────────────────────────────────────────
function SummaryCards({ summary }: { summary: any }) {
  const pnlPos = summary.total_pnl_abs >= 0;
  const dayPos = summary.total_day_change >= 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <SummaryCard
        label="Invested Value"
        value={fmtCrore(summary.total_invested)}
        icon={<BarChart2 className="w-4 h-4" />}
        color="text-accent-primary"
        bg="bg-accent-primary/10"
      />
      <SummaryCard
        label="Current Value"
        value={fmtCrore(summary.total_current)}
        icon={<Activity className="w-4 h-4" />}
        color="text-text-primary"
        bg="bg-bg-tertiary"
      />
      <SummaryCard
        label="Total P&L"
        value={`${pnlPos ? "+" : ""}${fmtCrore(summary.total_pnl_abs)}`}
        sub={`${pnlPos ? "+" : ""}${fmt(summary.total_pnl_pct)}%`}
        icon={pnlPos ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        color={pnlPos ? "text-positive" : "text-negative"}
        bg={pnlPos ? "bg-positive-bg" : "bg-negative-bg"}
      />
      <SummaryCard
        label="Today's Change"
        value={`${dayPos ? "+" : ""}${fmtCrore(summary.total_day_change)}`}
        icon={dayPos ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
        color={dayPos ? "text-positive" : "text-negative"}
        bg={dayPos ? "bg-positive-bg" : "bg-negative-bg"}
      />
    </div>
  );
}

function SummaryCard({
  label, value, sub, icon, color, bg
}: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; color: string; bg: string;
}) {
  return (
    <div className="bg-bg-elevated border border-border-primary rounded-2xl p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${bg} ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted mb-0.5">{label}</p>
        <p className={`text-lg font-bold truncate ${color}`}>{value}</p>
        {sub && <p className={`text-xs font-medium ${color}`}>{sub}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ALLOCATION CHART
// ─────────────────────────────────────────────
function AllocationChart({
  view, stockAlloc, sectorAlloc, capAlloc
}: {
  view: "stock" | "sector" | "cap";
  stockAlloc: any[];
  sectorAlloc: any[];
  capAlloc: any[];
}) {
  const data =
    view === "stock"
      ? stockAlloc.slice(0, 12).map((r) => ({ name: (r.name || r.symbol || "").replace(".NS","").slice(0,12), value: r.weight_pct }))
      : view === "sector"
      ? sectorAlloc.map((r) => ({ name: r.sector, value: r.weight_pct }))
      : capAlloc.map((r) => ({ name: r.tier, value: r.weight_pct }));

  const RADIAN = Math.PI / 180;
  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) => {
    if (percent < 0.05) return null;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  if (view === "cap") {
    // Horizontal bar for market-cap
    return (
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis type="number" unit="%" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} width={80} />
            <Tooltip
              contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", borderRadius: 8 }}
              formatter={(v: any) => [`${v.toFixed(1)}%`, "Weight"]}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="flex gap-6 items-center">
      <div className="w-52 h-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RePieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              dataKey="value"
              labelLine={false}
              label={renderLabel}
            >
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", borderRadius: 8 }}
              formatter={(v: any) => [`${v.toFixed(1)}%`, "Weight"]}
            />
          </RePieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto max-h-52">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-xs text-text-secondary flex-1 truncate">{d.name}</span>
            <span className="text-xs font-semibold text-text-primary">{d.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CONCENTRATION RISK PANEL
// ─────────────────────────────────────────────
function ConcentrationPanel({ flags, divScore }: { flags: any[]; divScore: number }) {
  const riskLevel = divScore > 70 ? "LOW" : divScore > 45 ? "MEDIUM" : "HIGH";
  const riskColor = riskLevel === "LOW" ? "text-positive" : riskLevel === "MEDIUM" ? "text-neutral" : "text-negative";
  const riskBg = riskLevel === "LOW" ? "bg-positive-bg" : riskLevel === "MEDIUM" ? "bg-neutral-bg" : "bg-negative-bg";

  return (
    <div className="bg-bg-elevated border border-border-primary rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-neutral" />
          Concentration Risk
        </h3>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${riskColor} ${riskBg}`}>
          {riskLevel === "LOW" ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
          {riskLevel} RISK · Diversification {divScore.toFixed(0)}/100
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {flags.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-bg border border-neutral/20 text-sm"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-neutral shrink-0" />
            <span className="text-text-primary font-medium">{f.label}</span>
            <span className="text-neutral font-bold">{f.weight.toFixed(1)}%</span>
            <span className="text-text-muted text-xs capitalize">{f.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// AI NARRATIVE CARD
// ─────────────────────────────────────────────
const SENTIMENT_COLORS: Record<string, string> = {
  STRONG:    "text-positive border-positive/20 bg-positive-bg",
  BALANCED:  "text-accent-primary border-accent-primary/20 bg-accent-primary/10",
  CAUTIOUS:  "text-neutral border-neutral/20 bg-neutral-bg",
  AT_RISK:   "text-negative border-negative/20 bg-negative-bg",
};

function AInarrativeCard({ narrative, loading, onGenerate }: {
  narrative: any; loading: boolean; onGenerate: () => void;
}) {
  return (
    <div className="bg-bg-elevated border border-border-primary rounded-2xl p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-primary" />
          AI Portfolio Pulse
        </h3>
        {narrative && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${SENTIMENT_COLORS[narrative.sentiment] || SENTIMENT_COLORS.BALANCED}`}>
            {narrative.sentiment}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-3 py-10">
          <Loader2 className="w-5 h-5 animate-spin text-accent-primary" />
          <span className="text-sm text-text-muted">Generating AI analysis…</span>
        </div>
      ) : narrative ? (
        <div className="space-y-4 flex-1">
          <p className="text-sm text-text-secondary leading-relaxed">{narrative.health_summary}</p>

          {narrative.key_observations?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Observations</p>
              <ul className="space-y-1.5">
                {narrative.key_observations.map((obs: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-primary mt-1.5 shrink-0" />
                    {obs}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {narrative.concentration_warnings?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral uppercase tracking-wide mb-2">Warnings</p>
              <ul className="space-y-1.5">
                {narrative.concentration_warnings.map((w: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-neutral">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={onGenerate}
            className="mt-2 text-xs text-text-muted hover:text-accent-primary flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Regenerate
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-accent-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-accent-primary" />
          </div>
          <p className="text-sm text-text-secondary">Get an AI-generated plain-English portfolio health summary</p>
          <button
            onClick={onGenerate}
            className="px-4 py-2 text-sm font-semibold text-white bg-accent-primary rounded-xl hover:bg-accent-primary/90 transition-all shadow-lg shadow-accent-primary/20"
          >
            Generate AI Pulse
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// HOLDINGS TABLE
// ─────────────────────────────────────────────
function HoldingsTable({
  holdings, portfolioId, onRefresh
}: {
  holdings: any[]; portfolioId: string; onRefresh: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ quantity: string; avg_price: string }>({ quantity: "", avg_price: "" });
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<string>("weight_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = [...holdings].sort((a, b) => {
    const va = a[sortKey] ?? -Infinity;
    const vb = b[sortKey] ?? -Infinity;
    return sortDir === "desc" ? vb - va : va - vb;
  });

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const startEdit = (h: any) => {
    setEditingId(h.id);
    setEditValues({ quantity: String(h.quantity), avg_price: String(h.avg_price) });
  };

  const saveEdit = async (h: any) => {
    setSaving(true);
    try {
      await fetch(`${API}/api/portfolio/${portfolioId}/holdings/${h.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: parseFloat(editValues.quantity),
          avg_price: parseFloat(editValues.avg_price),
        }),
      });
      setEditingId(null);
      onRefresh();
    } catch {} finally {
      setSaving(false);
    }
  };

  const deleteHolding = async (h: any) => {
    if (!confirm(`Remove ${h.name || h.symbol} from this portfolio?`)) return;
    try {
      await fetch(`${API}/api/portfolio/${portfolioId}/holdings/${h.id}`, { method: "DELETE" });
      onRefresh();
    } catch {}
  };

  const Th = ({ label, sortable, col }: { label: string; sortable?: boolean; col?: string }) => (
    <th
      className={`px-4 py-3 text-xs text-text-muted font-semibold uppercase tracking-wider text-left whitespace-nowrap ${sortable ? "cursor-pointer hover:text-text-primary select-none" : ""}`}
      onClick={() => sortable && col && handleSort(col)}
    >
      {label} {sortable && col === sortKey && (sortDir === "desc" ? "↓" : "↑")}
    </th>
  );

  return (
    <div className="bg-bg-elevated border border-border-primary rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-border-primary bg-bg-tertiary/50">
              <Th label="Stock" />
              <Th label="Sector" />
              <Th label="Cap" />
              <Th label="Qty" sortable col="quantity" />
              <Th label="Avg Price" />
              <Th label="LTP" sortable col="current_price" />
              <Th label="P&L" sortable col="pnl_pct" />
              <Th label="Weight" sortable col="weight_pct" />
              <Th label="RSI" sortable col="rsi" />
              <Th label="52W Pos" sortable col="week52_position" />
              <Th label="P/E" sortable col="pe_ratio" />
              <Th label="Div Yld" sortable col="dividend_yield" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary">
            {sorted.map((h) => {
              const pnlPos = h.pnl_pct >= 0;
              const rsiFlag = h.rsi_flag;
              const weekFlag = h.week52_flag;
              const isEditing = editingId === h.id;
              return (
                <tr key={h.id} className="hover:bg-bg-tertiary/30 transition-colors group">
                  {/* Stock */}
                  <td className="px-4 py-3">
                    <div className="font-semibold text-text-primary">{(h.symbol || "").replace(".NS", "")}</div>
                    <div className="text-xs text-text-muted truncate max-w-28">{h.name}</div>
                  </td>

                  {/* Sector */}
                  <td className="px-4 py-3 text-xs text-text-muted max-w-28 truncate">{h.sector || "—"}</td>

                  {/* Cap Tier */}
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      h.market_cap_tier === "Large Cap" ? "bg-accent-primary/10 text-accent-primary" :
                      h.market_cap_tier === "Mid Cap" ? "bg-neutral-bg text-neutral" :
                      "bg-bg-tertiary text-text-muted"
                    }`}>
                      {h.market_cap_tier?.replace(" Cap","") || "—"}
                    </span>
                  </td>

                  {/* Qty */}
                  <td className="px-4 py-3 text-text-primary">
                    {isEditing ? (
                      <input
                        type="number"
                        value={editValues.quantity}
                        onChange={(e) => setEditValues((v) => ({ ...v, quantity: e.target.value }))}
                        className="w-20 px-2 py-1 rounded border border-accent-primary/40 bg-bg-tertiary text-text-primary text-xs focus:outline-none"
                      />
                    ) : (
                      fmt(h.quantity, 0)
                    )}
                  </td>

                  {/* Avg Price */}
                  <td className="px-4 py-3 text-text-secondary">
                    {isEditing ? (
                      <input
                        type="number"
                        value={editValues.avg_price}
                        onChange={(e) => setEditValues((v) => ({ ...v, avg_price: e.target.value }))}
                        className="w-24 px-2 py-1 rounded border border-accent-primary/40 bg-bg-tertiary text-text-primary text-xs focus:outline-none"
                      />
                    ) : (
                      `₹${fmt(h.avg_price)}`
                    )}
                  </td>

                  {/* LTP */}
                  <td className="px-4 py-3 font-semibold text-text-primary">
                    {h.current_price ? `₹${fmt(h.current_price)}` : "—"}
                  </td>

                  {/* P&L */}
                  <td className="px-4 py-3">
                    {h.pnl_pct != null ? (
                      <div>
                        <span className={`font-semibold ${h.pnl_pct >= 0 ? "text-positive" : "text-negative"}`}>
                          {h.pnl_pct >= 0 ? "+" : ""}{fmt(h.pnl_pct)}%
                        </span>
                        <div className="text-xs text-text-muted">
                          {h.pnl_abs >= 0 ? "+" : ""}₹{fmt(Math.abs(h.pnl_abs), 0)}
                        </div>
                      </div>
                    ) : "—"}
                  </td>

                  {/* Weight */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent-primary"
                          style={{ width: `${Math.min(h.weight_pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-secondary">{fmt(h.weight_pct, 1)}%</span>
                    </div>
                  </td>

                  {/* RSI */}
                  <td className="px-4 py-3">
                    {h.rsi != null ? (
                      <span className={`text-xs font-semibold ${
                        rsiFlag === "OVERBOUGHT" ? "text-negative" :
                        rsiFlag === "OVERSOLD"   ? "text-positive" :
                        "text-text-secondary"
                      }`}>
                        {fmt(h.rsi, 0)}
                        {rsiFlag === "OVERBOUGHT" && " ⚠️"}
                        {rsiFlag === "OVERSOLD"   && " 📉"}
                      </span>
                    ) : "—"}
                  </td>

                  {/* 52W position */}
                  <td className="px-4 py-3">
                    {h.week52_position != null ? (
                      <div>
                        <div className="w-16 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              h.week52_position > 75 ? "bg-positive" :
                              h.week52_position < 15 ? "bg-negative" :
                              "bg-neutral"
                            }`}
                            style={{ width: `${h.week52_position}%` }}
                          />
                        </div>
                        <span className={`text-xs ${weekFlag ? "text-negative font-semibold" : "text-text-muted"}`}>
                          {fmt(h.week52_position, 0)}%{weekFlag ? " ↓" : ""}
                        </span>
                      </div>
                    ) : "—"}
                  </td>

                  {/* P/E */}
                  <td className="px-4 py-3 text-xs text-text-secondary">
                    {h.pe_ratio ? fmt(h.pe_ratio, 1) : "—"}
                  </td>

                  {/* Div Yield */}
                  <td className="px-4 py-3 text-xs text-text-secondary">
                    {h.dividend_yield ? `${(h.dividend_yield * 100).toFixed(2)}%` : "—"}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveEdit(h)}
                          disabled={saving}
                          className="p-1.5 rounded-lg text-positive hover:bg-positive-bg transition-all"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded-lg text-text-muted hover:bg-bg-tertiary transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(h)}
                          className="p-1.5 rounded-lg text-text-muted hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteHolding(h)}
                          className="p-1.5 rounded-lg text-text-muted hover:text-negative hover:bg-negative-bg transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
