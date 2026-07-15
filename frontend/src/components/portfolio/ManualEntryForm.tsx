"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Trash2, Search, Loader2, Calendar, HelpCircle } from "lucide-react";

const API = "http://127.0.0.1:8000";

interface HoldingRow {
  id: string;
  symbol: string;
  company_name: string;
  quantity: string;
  avg_price: string;
  buy_date: string;
}

interface ManualEntryFormProps {
  portfolioId: string;
  onDone: () => void;
}

function makeRow(): HoldingRow {
  return {
    id: Math.random().toString(36).slice(2),
    symbol: "",
    company_name: "",
    quantity: "",
    avg_price: "",
    buy_date: "",
  };
}

function SymbolSearch({
  value,
  companyName,
  onChange,
}: {
  value: string;
  companyName: string;
  onChange: (symbol: string, name: string) => void;
}) {
  const [query, setQuery] = useState(companyName || value);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/portfolio/symbol-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 250);
  };

  const handleSelect = (item: any) => {
    const sym = item.symbol.includes(".") ? item.symbol : item.symbol + ".NS";
    onChange(sym, item.name);
    setQuery(item.name);
    setOpen(false);
    setResults([]);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search stock…"
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-border-primary bg-bg-tertiary text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-primary/60"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-text-muted" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-elevated border border-border-primary rounded-xl shadow-xl z-50 max-h-52 overflow-y-auto">
          {results.map((item) => (
            <button
              key={item.symbol}
              onMouseDown={() => handleSelect(item)}
              className="w-full text-left px-3 py-2.5 hover:bg-bg-tertiary flex items-center justify-between group"
            >
              <span className="text-sm text-text-primary truncate">{item.name}</span>
              <span className="text-xs text-text-muted font-mono ml-2 shrink-0">{item.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ManualEntryForm({ portfolioId, onDone }: ManualEntryFormProps) {
  const [rows, setRows] = useState<HoldingRow[]>([makeRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateRow = (id: string, field: keyof HoldingRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, makeRow()]);
  const removeRow = (id: string) => {
    if (rows.length === 1) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSubmit = async () => {
    setError(null);
    const validRows = rows.filter((r) => r.symbol && r.quantity && r.avg_price);
    if (validRows.length === 0) {
      setError("Please fill in at least one holding with a stock, quantity, and buy price.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = validRows.map((r) => ({
        symbol: r.symbol,
        company_name: r.company_name || r.symbol,
        quantity: parseFloat(r.quantity),
        avg_price: parseFloat(r.avg_price),
        buy_date: r.buy_date || undefined,
      }));
      const res = await fetch(`${API}/api/portfolio/${portfolioId}/holdings/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail || "Failed to save holdings");
        return;
      }
      setSuccess(true);
      setTimeout(() => onDone(), 1000);
    } catch {
      setError("Could not connect to server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-bg-elevated border border-border-primary rounded-2xl p-6 space-y-5">
      <p className="text-sm text-text-muted">
        Add stocks one by one. All fields except Buy Date are required for P&amp;L analysis.
      </p>

      {/* Holdings rows */}
      <div className="space-y-4">
        {rows.map((row, idx) => (
          <div
            key={row.id}
            className="p-4 rounded-xl bg-bg-tertiary border border-border-primary space-y-3 relative group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                Holding {idx + 1}
              </span>
              {rows.length > 1 && (
                <button
                  onClick={() => removeRow(row.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-negative hover:bg-negative-bg transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Stock search */}
            <div>
              <label className="text-xs text-text-muted mb-1 block">Stock *</label>
              <SymbolSearch
                value={row.symbol}
                companyName={row.company_name}
                onChange={(sym, name) => {
                  updateRow(row.id, "symbol", sym);
                  updateRow(row.id, "company_name", name);
                }}
              />
              {row.symbol && (
                <p className="text-xs text-text-muted mt-1 font-mono">{row.symbol}</p>
              )}
            </div>

            {/* Quantity + Price */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">Shares / Quantity *</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={row.quantity}
                  onChange={(e) => updateRow(row.id, "quantity", e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full px-3 py-2 rounded-lg border border-border-primary bg-bg-primary text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-primary/60"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Avg Buy Price (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.avg_price}
                  onChange={(e) => updateRow(row.id, "avg_price", e.target.value)}
                  placeholder="e.g. 2400.50"
                  className="w-full px-3 py-2 rounded-lg border border-border-primary bg-bg-primary text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-primary/60"
                />
              </div>
            </div>

            {/* Buy Date (optional) */}
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs text-text-muted">Buy Date</label>
                <span className="text-xs text-text-muted">(optional)</span>
                <div className="relative group/tooltip ml-1">
                  <HelpCircle className="w-3 h-3 text-text-muted cursor-help" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-bg-elevated border border-border-primary rounded-lg px-3 py-2 text-xs text-text-secondary opacity-0 group-hover/tooltip:opacity-100 transition-all pointer-events-none z-50 shadow-xl">
                    Used only to calculate XIRR (annualised return). Skip if you don't remember — P&L and allocation analysis still work fully without it.
                  </div>
                </div>
              </div>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                <input
                  type="date"
                  value={row.buy_date}
                  onChange={(e) => updateRow(row.id, "buy_date", e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-border-primary bg-bg-primary text-text-primary text-sm focus:outline-none focus:border-accent-primary/60"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add another row */}
      <button
        onClick={addRow}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border-primary text-text-muted hover:text-accent-primary hover:border-accent-primary/40 text-sm transition-all"
      >
        <Plus className="w-4 h-4" />
        Add Another Holding
      </button>

      {/* Error */}
      {error && (
        <p className="text-sm text-negative bg-negative-bg px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting || success}
        className="w-full py-3 rounded-xl bg-accent-primary text-white font-semibold text-sm hover:bg-accent-primary/90 disabled:opacity-40 transition-all shadow-lg shadow-accent-primary/20"
      >
        {success ? "✓ Holdings saved!" : submitting ? "Saving…" : `Save ${rows.filter((r) => r.symbol && r.quantity && r.avg_price).length || ""} Holdings`}
      </button>
    </div>
  );
}
