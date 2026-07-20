"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload, FileText, CheckCircle2, AlertTriangle, XCircle,
  Loader2, Info, ChevronDown, ChevronUp
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface UploadWidgetProps {
  onResult: (result: any) => void;
}

const BROKER_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  zerodha: { label: "Zerodha Console", color: "text-blue-400", icon: "Z" },
  groww:   { label: "Groww",            color: "text-green-400", icon: "G" },
  dhan:    { label: "Dhan",             color: "text-purple-400", icon: "D" },
  unknown: { label: "Unknown Broker",   color: "text-neutral",    icon: "?" },
};

export default function UploadWidget({ onResult }: UploadWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedBroker, setDetectedBroker] = useState<string | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({
    symbol: "", quantity: "", avg_price: "", isin: ""
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const REQUIRED_FIELDS = [
    { key: "symbol",    label: "Stock Symbol / Name", required: true },
    { key: "isin",      label: "ISIN Code",            required: false },
    { key: "quantity",  label: "Quantity / Shares",    required: true },
    { key: "avg_price", label: "Avg Buy Price (₹)",    required: true },
  ];

  const uploadFile = useCallback(async (f: File, map?: Record<string, string>) => {
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", f);
    if (map) {
      const validMap = Object.fromEntries(Object.entries(map).filter(([, v]) => v));
      if (Object.keys(validMap).length > 0) {
        formData.append("field_map", JSON.stringify(validMap));
      }
    }
    try {
      const res = await fetch(`${API}/api/portfolio/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Upload failed");
        return;
      }
      if (data.requires_column_mapping) {
        setRawHeaders(data.headers || []);
        setShowMapping(true);
        setDetectedBroker("unknown");
        return;
      }
      setDetectedBroker(data.broker_detected);
      onResult(data);
    } catch (e) {
      setError("Could not connect to server. Is the backend running?");
    } finally {
      setUploading(false);
    }
  }, [onResult]);

  const handleFile = useCallback((f: File) => {
    if (!f.name.match(/\.(csv|xlsx|xls)$/i)) {
      setError("Please upload a CSV or XLSX file.");
      return;
    }
    setFile(f);
    setShowMapping(false);
    setRawHeaders([]);
    uploadFile(f);
  }, [uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleMappingSubmit = () => {
    const missing = REQUIRED_FIELDS
      .filter((f) => f.required && !fieldMap[f.key])
      .map((f) => f.label);
    if (missing.length > 0) {
      setError(`Please map: ${missing.join(", ")}`);
      return;
    }
    if (file) uploadFile(file, fieldMap);
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 group
          ${isDragging
            ? "border-accent-primary bg-accent-primary/10 scale-[1.01]"
            : "border-border-primary hover:border-accent-primary/50 hover:bg-bg-elevated/50 bg-bg-elevated"
          }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center transition-all
          ${isDragging ? "bg-accent-primary text-white scale-110" : "bg-bg-tertiary text-text-secondary group-hover:text-accent-primary group-hover:bg-accent-primary/10"}`}>
          {uploading ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : file ? (
            <FileText className="w-7 h-7" />
          ) : (
            <Upload className="w-7 h-7" />
          )}
        </div>

        {uploading ? (
          <div>
            <p className="text-text-primary font-semibold">Parsing file…</p>
            <p className="text-text-muted text-sm mt-1">Detecting broker format and resolving symbols</p>
          </div>
        ) : file ? (
          <div>
            <p className="text-text-primary font-semibold">{file.name}</p>
            <p className="text-text-muted text-sm mt-1">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
          </div>
        ) : (
          <div>
            <p className="text-text-primary font-semibold">Drag & drop your holdings file</p>
            <p className="text-text-muted text-sm mt-1">Or click to browse · CSV, XLSX supported</p>
            <div className="flex items-center justify-center gap-3 mt-4">
              {["Zerodha", "Groww", "Dhan"].map((b) => (
                <span key={b} className="px-2.5 py-1 rounded-full bg-bg-tertiary border border-border-primary text-xs text-text-muted">
                  {b}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Animated border glow on drag */}
        {isDragging && (
          <div className="absolute inset-0 rounded-2xl border-2 border-accent-primary animate-pulse pointer-events-none" />
        )}
      </div>

      {/* Broker detected badge */}
      {detectedBroker && detectedBroker !== "unknown" && !uploading && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-positive-bg border border-positive/20">
          <CheckCircle2 className="w-4 h-4 text-positive shrink-0" />
          <span className="text-sm text-positive font-medium">
            Detected: {BROKER_LABELS[detectedBroker]?.label || detectedBroker}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-negative-bg border border-negative/20">
          <XCircle className="w-4 h-4 text-negative shrink-0 mt-0.5" />
          <p className="text-sm text-negative">{error}</p>
        </div>
      )}

      {/* Column Mapping UI (for unknown broker) */}
      {showMapping && rawHeaders.length > 0 && (
        <div className="bg-bg-elevated border border-border-primary rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-neutral shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-text-primary">Broker format not recognised</p>
              <p className="text-xs text-text-muted mt-0.5">
                Map your file's column names to the required fields below.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {REQUIRED_FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-3">
                <label className="text-sm text-text-secondary w-44 shrink-0">
                  {field.label}
                  {field.required && <span className="text-negative ml-1">*</span>}
                </label>
                <select
                  value={fieldMap[field.key]}
                  onChange={(e) => setFieldMap((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  className="flex-1 px-3 py-2 rounded-lg border border-border-primary bg-bg-tertiary text-text-primary text-sm focus:outline-none focus:border-accent-primary/60"
                >
                  <option value="">— Select column —</option>
                  {rawHeaders.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button
            onClick={handleMappingSubmit}
            disabled={uploading}
            className="w-full py-2.5 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition-all disabled:opacity-40"
          >
            {uploading ? "Processing…" : "Apply Mapping & Preview"}
          </button>
        </div>
      )}

      {/* Help note */}
      <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-neutral-bg border border-neutral/10">
        <Info className="w-4 h-4 text-neutral shrink-0 mt-0.5" />
        <p className="text-xs text-text-muted leading-relaxed">
          <strong className="text-text-secondary">Where to export:</strong> Zerodha → Console → Portfolio → Holdings → Download CSV.
          Groww → Profile → Reports → Holdings. Your file is parsed locally and never stored in raw form.
        </p>
      </div>
    </div>
  );
}
