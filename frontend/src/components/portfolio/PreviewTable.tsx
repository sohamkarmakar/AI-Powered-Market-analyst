"use client";

import { useState } from "react";
import {
  CheckCircle2, AlertTriangle, XCircle, Search,
  AlertCircle, ChevronRight, Loader2
} from "lucide-react";

interface PreviewTableProps {
  previewData: any;
  onConfirm: (rows: any[]) => void;
  onCancel: () => void;
  loading: boolean;
}

export default function PreviewTable({ previewData, onConfirm, onCancel, loading }: PreviewTableProps) {
  const [rows, setRows] = useState<any[]>(previewData?.resolved_rows || []);
  const [symbolOverrides, setSymbolOverrides] = useState<Record<number, string>>({});

  const broker = previewData?.broker_detected || "unknown";
  const unresolvedCount = rows.filter((r) => r.is_unresolved).length;
  const integrityWarning = previewData?.integrity_warning;

  const handleSymbolOverride = (idx: number, symbol: string) => {
    const updated = symbol.includes(".") ? symbol.toUpperCase() : symbol.toUpperCase() + ".NS";
    setSymbolOverrides((prev) => ({ ...prev, [idx]: updated }));
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx
          ? { ...r, resolved_symbol: updated, is_unresolved: false, resolution_method: "manual" }
          : r
      )
    );
  };

  const handleConfirm = () => {
    const confirmed = rows
      .filter((r) => !r.is_unresolved && r.resolved_symbol)
      .map((r) => ({
        symbol:       r.resolved_symbol,
        isin:         r.isin || null,
        company_name: r.resolved_name || r.company_name,
        quantity:     r.quantity,
        avg_price:    r.avg_price,
      }));
    onConfirm(confirmed);
  };

  const confirmedCount = rows.filter((r) => !r.is_unresolved && r.resolved_symbol).length;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Preview Holdings</h2>
          <p className="text-sm text-text-muted mt-0.5">
            Review parsed holdings before importing. Fix any unresolved symbols below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full bg-bg-elevated border border-border-primary text-xs text-text-muted capitalize">
            {broker}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-positive-bg border border-positive/20 text-xs text-positive">
            {confirmedCount} ready
          </span>
          {unresolvedCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-neutral-bg border border-neutral/20 text-xs text-neutral">
              {unresolvedCount} unresolved
            </span>
          )}
        </div>
      </div>

      {/* Integrity warning */}
      {integrityWarning && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-neutral-bg border border-neutral/20">
          <AlertTriangle className="w-4 h-4 text-neutral shrink-0 mt-0.5" />
          <p className="text-sm text-neutral">{integrityWarning}</p>
        </div>
      )}

      {/* Groww metadata summary */}
      {previewData?.metadata && Object.keys(previewData.metadata).length > 0 && (
        <div className="flex flex-wrap gap-3">
          {previewData.metadata.statement_date && (
            <div className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border-primary text-xs text-text-muted">
              📅 Statement: {previewData.metadata.statement_date}
            </div>
          )}
          {previewData.metadata.invested_value && (
            <div className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border-primary text-xs text-text-muted">
              💰 Invested: ₹{Number(previewData.metadata.invested_value).toLocaleString("en-IN")}
            </div>
          )}
          {previewData.metadata.closing_value && (
            <div className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border-primary text-xs text-text-muted">
              📊 Current: ₹{Number(previewData.metadata.closing_value).toLocaleString("en-IN")}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-elevated border border-border-primary rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-primary bg-bg-tertiary/50">
                <th className="text-left px-4 py-3 text-xs text-text-muted font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs text-text-muted font-semibold uppercase tracking-wider">Company</th>
                <th className="text-left px-4 py-3 text-xs text-text-muted font-semibold uppercase tracking-wider">Symbol</th>
                <th className="text-left px-4 py-3 text-xs text-text-muted font-semibold uppercase tracking-wider">ISIN</th>
                <th className="text-right px-4 py-3 text-xs text-text-muted font-semibold uppercase tracking-wider">Qty</th>
                <th className="text-right px-4 py-3 text-xs text-text-muted font-semibold uppercase tracking-wider">Avg Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-primary">
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  className={`transition-colors ${row.is_unresolved ? "bg-neutral-bg/30" : "hover:bg-bg-tertiary/30"}`}
                >
                  {/* Status */}
                  <td className="px-4 py-3">
                    {row.is_unresolved ? (
                      <AlertCircle className="w-4 h-4 text-neutral" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-positive" />
                    )}
                  </td>

                  {/* Company name */}
                  <td className="px-4 py-3 text-text-primary font-medium max-w-48 truncate">
                    {row.resolved_name || row.company_name || "—"}
                  </td>

                  {/* Symbol — editable if unresolved */}
                  <td className="px-4 py-3">
                    {row.is_unresolved ? (
                      <input
                        type="text"
                        placeholder="e.g. RELIANCE"
                        defaultValue={row.resolved_symbol || ""}
                        onBlur={(e) => handleSymbolOverride(idx, e.target.value)}
                        className="w-32 px-2 py-1 rounded-lg border border-neutral/30 bg-bg-tertiary text-text-primary text-xs focus:outline-none focus:border-neutral"
                      />
                    ) : (
                      <span className="font-mono text-xs text-accent-primary">
                        {row.resolved_symbol}
                      </span>
                    )}
                  </td>

                  {/* ISIN */}
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">
                    {row.isin || "—"}
                  </td>

                  {/* Qty */}
                  <td className="px-4 py-3 text-right text-text-primary">
                    {row.quantity?.toLocaleString("en-IN") || "—"}
                  </td>

                  {/* Avg price */}
                  <td className="px-4 py-3 text-right text-text-primary">
                    {row.avg_price ? `₹${Number(row.avg_price).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Note about unresolved */}
      {unresolvedCount > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-neutral-bg border border-neutral/20">
          <AlertTriangle className="w-4 h-4 text-neutral shrink-0 mt-0.5" />
          <p className="text-sm text-neutral">
            <strong>{unresolvedCount} holding{unresolvedCount > 1 ? "s" : ""}</strong> could not be automatically resolved.
            Type the NSE symbol directly in the Symbol column above to fix them before importing.
            Unresolved rows will be skipped on import.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border-primary rounded-lg transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={confirmedCount === 0 || loading}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-accent-primary rounded-xl hover:bg-accent-primary/90 disabled:opacity-40 transition-all shadow-lg shadow-accent-primary/20"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</>
          ) : (
            <>Import {confirmedCount} Holdings <ChevronRight className="w-4 h-4" /></>
          )}
        </button>
      </div>
    </div>
  );
}
