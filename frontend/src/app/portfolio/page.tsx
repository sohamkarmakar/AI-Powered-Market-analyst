"use client";

import { useState, useEffect, useCallback } from "react";
import { Briefcase, Upload, PlusCircle, ChevronDown, Trash2 } from "lucide-react";
import TopBar from "@/components/TopBar";
import UploadWidget from "@/components/portfolio/UploadWidget";
import ManualEntryForm from "@/components/portfolio/ManualEntryForm";
import PreviewTable from "@/components/portfolio/PreviewTable";
import PortfolioDashboard from "@/components/portfolio/PortfolioDashboard";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface Portfolio {
  id: string;
  name: string;
  broker_source?: string;
  created_at: string;
}

type AppView = "empty" | "preview" | "dashboard";
type EntryMode = "upload" | "manual" | null;

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolio, setActivePortfolio] = useState<Portfolio | null>(null);
  const [view, setView] = useState<AppView>("empty");
  const [entryMode, setEntryMode] = useState<EntryMode>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showPortfolioDropdown, setShowPortfolioDropdown] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");

  const [apiError, setApiError] = useState<string | null>(null);

  const fetchPortfolios = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/portfolio`);
      if (!res.ok) {
        // Tables might not exist yet — stay in empty state
        setApiError("Portfolio tables not found. Please run schema_portfolio.sql in Supabase first.");
        return;
      }
      const data = await res.json();
      const pList: Portfolio[] = (data.portfolios || []).filter(Boolean);
      setPortfolios(pList);
      if (pList.length > 0 && !activePortfolio) {
        setActivePortfolio(pList[0]);
        setView("dashboard");
      } else if (pList.length === 0) {
        setView("empty");
        setActivePortfolio(null);
      }
    } catch {
      // API offline — stay in empty state
    }
  }, [activePortfolio]);

  useEffect(() => {
    fetchPortfolios();
  }, []);

  const handleCreatePortfolio = async () => {
    if (!newPortfolioName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPortfolioName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.portfolio) {
        // Backend error — show message but don't crash
        const msg = data.detail || "Failed to create portfolio. Have you run schema_portfolio.sql?";
        setApiError(msg);
        setShowCreateModal(false);
        setNewPortfolioName("");
        return;
      }
      const newPort: Portfolio = data.portfolio;
      setApiError(null);
      setPortfolios((prev) => [newPort, ...prev]);
      setActivePortfolio(newPort);
      setView("empty");
      setShowCreateModal(false);
      setNewPortfolioName("");
    } catch (e) {
      console.error(e);
      setApiError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePortfolio = async (id: string) => {
    if (!confirm("Delete this portfolio and all its holdings?")) return;
    try {
      await fetch(`${API}/api/portfolio/${id}`, { method: "DELETE" });
      const updated = portfolios.filter((p) => p.id !== id);
      setPortfolios(updated);
      if (updated.length > 0) {
        setActivePortfolio(updated[0]);
        setView("dashboard");
      } else {
        setActivePortfolio(null);
        setView("empty");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUploadResult = (result: any) => {
    setPreviewData(result);
    setView("preview");
    setEntryMode(null);
  };

  const handleConfirmImport = async (confirmedRows: any[]) => {
    if (!activePortfolio) return;
    setLoading(true);
    try {
      await fetch(`${API}/api/portfolio/${activePortfolio.id}/holdings/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: activePortfolio.id,
          holdings: confirmedRows,
          broker_source: previewData?.broker_detected,
        }),
      });
      setPreviewData(null);
      setView("dashboard");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAdded = () => {
    setEntryMode(null);
    setView("dashboard");
  };

  const handleSelectPortfolio = (p: Portfolio) => {
    setActivePortfolio(p);
    setView("dashboard");
    setEntryMode(null);
    setShowPortfolioDropdown(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg-primary">
      {/* ── TopBar ── */}
      <TopBar
        title="Portfolio"
        subtitle="Holdings Analysis & Insights"
        icon={<Briefcase className="w-4 h-4 text-accent-primary" />}
        actions={
          <div className="flex items-center gap-2">
            {/* Portfolio selector */}
            {portfolios.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowPortfolioDropdown(!showPortfolioDropdown)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-tertiary border border-border-primary text-sm text-text-primary hover:border-accent-primary/40 transition-all"
                >
                  <span className="max-w-28 truncate">{activePortfolio?.name || "Select"}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                </button>
                {showPortfolioDropdown && (
                  <div className="absolute top-full right-0 mt-1 w-60 bg-bg-elevated border border-border-primary rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                    {portfolios.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2 hover:bg-bg-tertiary group">
                        <button className="flex-1 text-left text-sm text-text-primary" onClick={() => handleSelectPortfolio(p)}>
                          <div className="font-medium">{p.name}</div>
                          {p.broker_source && <div className="text-xs text-text-muted capitalize">{p.broker_source}</div>}
                        </button>
                        <button onClick={() => handleDeletePortfolio(p.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-negative hover:bg-negative-bg transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="border-t border-border-primary mt-1 pt-1">
                      <button onClick={() => { setShowCreateModal(true); setShowPortfolioDropdown(false); }} className="w-full text-left px-3 py-2 text-sm text-accent-primary hover:bg-bg-tertiary flex items-center gap-2">
                        <PlusCircle className="w-3.5 h-3.5" /> New Portfolio
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {activePortfolio && view === "dashboard" && (
              <>
                <button onClick={() => setEntryMode("upload")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border-primary hover:border-accent-primary/40 rounded-lg transition-all">
                  <Upload className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Upload</span>
                </button>
                <button onClick={() => setEntryMode("manual")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border-primary hover:border-accent-primary/40 rounded-lg transition-all">
                  <PlusCircle className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Add</span>
                </button>
              </>
            )}
            {!activePortfolio && portfolios.length === 0 && (
              <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white bg-accent-primary rounded-lg hover:bg-accent-primary/90 transition-all shadow-lg shadow-accent-primary/20">
                <PlusCircle className="w-3.5 h-3.5" /> New Portfolio
              </button>
            )}
          </div>
        }
      />

      {/* Create Portfolio Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-bg-elevated border border-border-primary rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-bold text-text-primary mb-1">Create Portfolio</h2>
            <p className="text-sm text-text-muted mb-4">Give your portfolio a name (e.g. "Zerodha", "My Holdings")</p>
            <input
              type="text"
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreatePortfolio()}
              placeholder="Portfolio name"
              className="w-full px-4 py-2.5 rounded-lg border border-border-primary bg-bg-tertiary text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent-primary/60 mb-4"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowCreateModal(false); setNewPortfolioName(""); }}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border-primary rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePortfolio}
                disabled={!newPortfolioName.trim() || loading}
                className="px-4 py-2 text-sm font-semibold text-white bg-accent-primary rounded-lg hover:bg-accent-primary/90 disabled:opacity-40 transition-all"
              >
                {loading ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click-outside handler for dropdown */}
      {showPortfolioDropdown && (
        <div className="fixed inset-0 z-10" onClick={() => setShowPortfolioDropdown(false)} />
      )}

      {/* Main Content */}
      <main className="flex-1 p-6">
        {/* API / Schema error banner */}
        {apiError && (
          <div className="mb-6 flex items-start gap-3 px-5 py-4 rounded-2xl bg-negative-bg border border-negative/25">
            <svg className="w-5 h-5 text-negative shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-negative mb-0.5">Setup required</p>
              <p className="text-sm text-negative/80">{apiError}</p>
              <p className="text-xs text-negative/60 mt-1">
                Open your <strong>Supabase SQL Editor</strong> → paste &amp; run{" "}
                <code className="px-1 py-0.5 rounded bg-negative/10 font-mono">backend/schema_portfolio.sql</code>{" "}
                → then refresh this page.
              </p>
            </div>
            <button
              onClick={() => setApiError(null)}
              className="ml-auto text-negative/60 hover:text-negative transition-colors shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        {/* Empty state — no portfolios exist at all */}
        {view === "empty" && !entryMode && (
          <EmptyState
            onUpload={() => { setShowCreateModal(true); }}
            onManual={() => { setShowCreateModal(true); }}
            hasPortfolio={!!activePortfolio}
            onUploadWithPortfolio={() => setEntryMode("upload")}
            onManualWithPortfolio={() => setEntryMode("manual")}
          />
        )}

        {/* Upload widget overlay */}
        {entryMode === "upload" && activePortfolio && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-4 flex items-center gap-3">
              <button
                onClick={() => setEntryMode(null)}
                className="text-sm text-text-muted hover:text-text-primary transition-all"
              >
                ← Back
              </button>
              <h2 className="text-lg font-semibold text-text-primary">Upload Holdings File</h2>
            </div>
            <UploadWidget onResult={handleUploadResult} />
          </div>
        )}

        {/* Manual entry form */}
        {entryMode === "manual" && activePortfolio && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-4 flex items-center gap-3">
              <button
                onClick={() => setEntryMode(null)}
                className="text-sm text-text-muted hover:text-text-primary transition-all"
              >
                ← Back
              </button>
              <h2 className="text-lg font-semibold text-text-primary">Add Holdings Manually</h2>
            </div>
            <ManualEntryForm portfolioId={activePortfolio.id} onDone={handleManualAdded} />
          </div>
        )}

        {/* Preview / confirm */}
        {view === "preview" && previewData && (
          <PreviewTable
            previewData={previewData}
            onConfirm={handleConfirmImport}
            onCancel={() => { setPreviewData(null); setView(activePortfolio ? "dashboard" : "empty"); }}
            loading={loading}
          />
        )}

        {/* Dashboard */}
        {view === "dashboard" && activePortfolio && !entryMode && (
          <PortfolioDashboard
            portfolioId={activePortfolio.id}
            portfolioName={activePortfolio.name}
            onAddManual={() => setEntryMode("manual")}
            onUpload={() => setEntryMode("upload")}
          />
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────
function EmptyState({
  onUpload, onManual, hasPortfolio, onUploadWithPortfolio, onManualWithPortfolio
}: {
  onUpload: () => void;
  onManual: () => void;
  hasPortfolio: boolean;
  onUploadWithPortfolio: () => void;
  onManualWithPortfolio: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      {/* Animated icon */}
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-3xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center mb-2 mx-auto">
          <Briefcase className="w-10 h-10 text-accent-primary" />
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent-primary animate-ping opacity-60" />
      </div>

      <h2 className="text-2xl font-bold text-text-primary mb-2">
        {hasPortfolio ? "Portfolio is empty" : "No portfolios yet"}
      </h2>
      <p className="text-text-muted text-sm max-w-md mb-10 leading-relaxed">
        {hasPortfolio
          ? "Add your first holding by uploading a broker export or entering stocks manually."
          : "Create a portfolio and upload your broker export (Zerodha, Groww) or add holdings manually to get started with analysis."}
      </p>

      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={hasPortfolio ? onUploadWithPortfolio : onUpload}
          className="group flex items-center gap-3 px-6 py-4 rounded-2xl bg-accent-primary text-white font-semibold hover:bg-accent-primary/90 transition-all shadow-xl shadow-accent-primary/20 hover:shadow-accent-primary/30 hover:-translate-y-0.5"
        >
          <Upload className="w-5 h-5 group-hover:scale-110 transition-transform" />
          Upload Broker File
          <span className="ml-1 text-xs font-normal opacity-80">CSV / XLSX</span>
        </button>

        <button
          onClick={hasPortfolio ? onManualWithPortfolio : onManual}
          className="group flex items-center gap-3 px-6 py-4 rounded-2xl bg-bg-elevated border border-border-primary text-text-primary font-semibold hover:border-accent-primary/40 hover:bg-bg-tertiary transition-all hover:-translate-y-0.5"
        >
          <PlusCircle className="w-5 h-5 text-text-secondary group-hover:text-accent-primary group-hover:scale-110 transition-all" />
          Add Manually
        </button>
      </div>

      <div className="mt-12 grid grid-cols-3 gap-4 max-w-lg">
        {[
          { icon: "📊", label: "Zerodha", sub: "Console CSV/XLSX" },
          { icon: "📈", label: "Groww", sub: "Holdings XLSX" },
          { icon: "✍️", label: "Any Broker", sub: "Manual entry" },
        ].map((b) => (
          <div key={b.label} className="p-3 rounded-xl bg-bg-elevated border border-border-primary text-center">
            <div className="text-2xl mb-1">{b.icon}</div>
            <div className="text-xs font-semibold text-text-primary">{b.label}</div>
            <div className="text-xs text-text-muted">{b.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
