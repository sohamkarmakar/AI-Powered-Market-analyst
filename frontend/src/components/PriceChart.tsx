"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface ChartDataPoint {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
  vwap?: number;
}

interface PriceChartProps {
  data: ChartDataPoint[];
  symbol?: string;
  /** If provided, the chart will fetch its own intraday data for 1d/5d/1wk */
  liveSymbol?: string;
}

const TIMEFRAMES = [
  { key: "1d",   label: "1D",  period: "1d",   interval: "5m"  },
  { key: "5d",   label: "5D",  period: "5d",   interval: "15m" },
  { key: "1wk",  label: "1W",  period: "1mo",  interval: "1h"  },
  { key: "1mo",  label: "1M",  period: "1mo",  interval: "1d"  },
  { key: "3mo",  label: "3M",  period: "3mo",  interval: "1d"  },
  { key: "6mo",  label: "6M",  period: "6mo",  interval: "1d"  },
  { key: "1y",   label: "1Y",  period: "1y",   interval: "1d"  },
];

const API = "http://127.0.0.1:8000";

function formatTick(dateStr: string, tfKey: string): string {
  try {
    const d = new Date(dateStr);
    if (tfKey === "1d" || tfKey === "5d") {
      return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    if (tfKey === "1wk" || tfKey === "1mo") {
      return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    }
    return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatTooltipLabel(dateStr: string, tfKey: string): string {
  try {
    const d = new Date(dateStr);
    if (tfKey === "1d" || tfKey === "5d" || tfKey === "1wk") {
      return d.toLocaleString("en-IN", {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: "Asia/Kolkata"
      }) + " IST";
    }
    return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
  } catch {
    return dateStr;
  }
}

export default function PriceChart({ data, liveSymbol }: PriceChartProps) {
  const [tfKey, setTfKey] = useState("1y");
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showVwap, setShowVwap] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [intradayData, setIntradayData] = useState<ChartDataPoint[]>([]);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [intradayError, setIntradayError] = useState(false);

  const isIntraday = tfKey === "1d" || tfKey === "5d" || tfKey === "1wk";

  // Fetch intraday / short-interval data from backend
  const fetchIntraday = useCallback(async (key: string) => {
    if (!liveSymbol) return;
    const tf = TIMEFRAMES.find(t => t.key === key);
    if (!tf) return;
    setIntradayLoading(true);
    setIntradayError(false);
    try {
      // Use /intraday for 1d/5d, else use /ticker for 1wk/1mo
      let url = "";
      if (key === "1d") {
        url = `${API}/api/ticker/${liveSymbol}/intraday?period=1d`;
      } else if (key === "5d") {
        url = `${API}/api/ticker/${liveSymbol}/intraday?period=5d`;
      } else {
        url = `${API}/api/ticker/${liveSymbol}?period=${tf.period}&interval=${tf.interval}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const raw = await res.json();

      let candles: ChartDataPoint[] = [];
      if (key === "1d" || key === "5d") {
        candles = (raw.candles || []).map((c: any) => ({
          date: c.t,
          close: c.c,
          open: c.o,
          high: c.h,
          low: c.l,
          volume: c.v,
        }));
      } else {
        candles = (raw.price_history || []).map((c: any) => ({
          date: c.date,
          close: c.close,
          open: c.open,
          high: c.high,
          low: c.low,
          volume: c.volume,
        }));
      }
      setIntradayData(candles);
    } catch {
      setIntradayError(true);
      setIntradayData([]);
    } finally {
      setIntradayLoading(false);
    }
  }, [liveSymbol]);

  useEffect(() => {
    if (isIntraday || (tfKey !== "1mo" && tfKey !== "3mo" && tfKey !== "6mo" && tfKey !== "1y")) {
      // For 1wk we also fetch
      fetchIntraday(tfKey);
    } else {
      setIntradayData([]);
    }
  }, [tfKey, fetchIntraday, isIntraday]);

  // Choose data source
  const activeData = useMemo((): ChartDataPoint[] => {
    if ((isIntraday || tfKey === "1wk") && intradayData.length > 0) return intradayData;
    return data.map(d => ({
      ...d,
      close: parseFloat(d.close.toFixed(2)),
      ema20: d.ema20 ? parseFloat(d.ema20.toFixed(2)) : undefined,
      ema50: d.ema50 ? parseFloat(d.ema50.toFixed(2)) : undefined,
      vwap: d.vwap ? parseFloat(d.vwap.toFixed(2)) : undefined,
    }));
  }, [data, intradayData, isIntraday, tfKey]);

  const yDomain = useMemo(() => {
    if (activeData.length === 0) return [0, 100];
    const prices = activeData.map(d => d.close).filter(Boolean);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.04;
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
  }, [activeData]);

  const maxVol = useMemo(() => {
    if (!showVolume) return 0;
    const vols = activeData.map(d => d.volume || 0);
    return Math.max(...vols, 1);
  }, [activeData, showVolume]);

  const isPositive = useMemo(() => {
    if (activeData.length < 2) return true;
    return activeData[activeData.length - 1].close >= activeData[0].close;
  }, [activeData]);

  const priceColor = isPositive ? "#10b981" : "#ef4444";
  const gradientId = `priceGrad-${isPositive ? "up" : "down"}`;

  return (
    <div className="flex flex-col h-full bg-[#0c1020]/45 border border-[rgba(255,255,255,0.06)] rounded-2xl p-5">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
        <div>
          <h3 className="text-sm font-bold text-white">Price History & Indicators</h3>
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
            {isIntraday ? "INTRADAY · IST" : tfKey === "1wk" ? "HOURLY" : "DAILY OHLCV"}
          </p>
        </div>

        {/* Timeframe buttons */}
        <div className="flex items-center gap-1 bg-black/20 rounded-xl p-1 border border-white/[0.05]">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.key}
              onClick={() => setTfKey(tf.key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all duration-150 ${
                tfKey === tf.key
                  ? "bg-blue-600 text-white shadow shadow-blue-500/30"
                  : "text-gray-500 hover:text-white hover:bg-white/[0.05]"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Overlay toggles ─────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: "ema20",   label: "EMA 20", color: "amber",   active: showEma20,  toggle: () => setShowEma20(p => !p) },
          { key: "ema50",   label: "EMA 50", color: "fuchsia", active: showEma50,  toggle: () => setShowEma50(p => !p) },
          { key: "vwap",    label: "VWAP",   color: "cyan",    active: showVwap,   toggle: () => setShowVwap(p => !p) },
          { key: "volume",  label: "Volume", color: "indigo",  active: showVolume, toggle: () => setShowVolume(p => !p) },
        ].map(({ key, label, color, active, toggle }) => (
          <button
            key={key}
            onClick={toggle}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium cursor-pointer transition-all duration-200 ${
              active
                ? `bg-${color}-500/10 text-${color}-400 border-${color}-500/30`
                : "bg-transparent text-gray-600 border-gray-800 hover:border-gray-700 hover:text-gray-400"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${active ? `bg-${color}-400` : "bg-gray-700"}`} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* ── Chart Canvas ────────────────────────────────── */}
      <div className="flex-1 w-full min-h-[260px]">
        {intradayLoading ? (
          <div className="flex items-center justify-center h-full space-x-2">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono text-gray-500">Loading {TIMEFRAMES.find(t=>t.key===tfKey)?.label} data…</span>
          </div>
        ) : intradayError && (isIntraday || tfKey === "1wk") ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs font-mono text-gray-600">Failed to load intraday data. Try another timeframe.</p>
          </div>
        ) : activeData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs font-mono text-gray-600">No chart data available.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={activeData} margin={{ top: 4, right: 4, left: -22, bottom: 4 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={priceColor} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={priceColor} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={d => formatTick(d, tfKey)}
                stroke="rgba(255,255,255,0.12)"
                tick={{ fill: "#4b5563", fontSize: 9, fontFamily: "monospace" }}
                dy={8}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                domain={yDomain}
                stroke="rgba(255,255,255,0.12)"
                tick={{ fill: "#4b5563", fontSize: 9, fontFamily: "monospace" }}
                dx={-4}
                tickFormatter={v => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#080d1a",
                  borderColor: "rgba(255,255,255,0.08)",
                  borderRadius: "10px",
                  color: "#f1f5f9",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                }}
                labelFormatter={l => formatTooltipLabel(l, tfKey)}
                formatter={(value: any, name: any) => [`₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, String(name)]}
              />

              {/* Volume bars (background layer) */}
              {showVolume && (
                <Bar
                  dataKey="volume"
                  name="Volume"
                  yAxisId="vol"
                  fill="rgba(99,102,241,0.12)"
                  stroke="rgba(99,102,241,0.3)"
                  strokeWidth={0}
                />
              )}

              {/* Price area */}
              <Area
                type="monotone"
                dataKey="close"
                name="Price"
                stroke={priceColor}
                strokeWidth={1.8}
                fillOpacity={1}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: priceColor }}
              />

              {/* EMA 20 */}
              {showEma20 && !isIntraday && (
                <Line type="monotone" dataKey="ema20" name="EMA 20"
                  stroke="#f59e0b" strokeWidth={1.2} dot={false} activeDot={{ r: 3 }} />
              )}
              {/* EMA 50 */}
              {showEma50 && !isIntraday && (
                <Line type="monotone" dataKey="ema50" name="EMA 50"
                  stroke="#d946ef" strokeWidth={1.2} dot={false} activeDot={{ r: 3 }} />
              )}
              {/* VWAP */}
              {showVwap && (
                <Line type="monotone" dataKey="vwap" name="VWAP"
                  stroke="#06b6d4" strokeWidth={1.2} dot={false} activeDot={{ r: 3 }} />
              )}

              {showVolume && <YAxis yAxisId="vol" orientation="right" hide />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
