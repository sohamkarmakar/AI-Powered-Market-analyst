"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
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

function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatTick(dateStr: string, tfKey: string): string {
  try {
    const d = new Date(dateStr);
    if (tfKey === "1d" || tfKey === "5d") {
      return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch { return dateStr; }
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
  } catch { return dateStr; }
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

  const fetchIntraday = useCallback(async (key: string) => {
    if (!liveSymbol) return;
    const tf = TIMEFRAMES.find(t => t.key === key);
    if (!tf) return;
    setIntradayLoading(true);
    setIntradayError(false);
    try {
      let url = "";
      if (key === "1d") url = `${API}/api/ticker/${liveSymbol}/intraday?period=1d`;
      else if (key === "5d") url = `${API}/api/ticker/${liveSymbol}/intraday?period=5d`;
      else url = `${API}/api/ticker/${liveSymbol}?period=${tf.period}&interval=${tf.interval}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const raw = await res.json();
      let candles: ChartDataPoint[] = [];
      if (key === "1d" || key === "5d") {
        candles = (raw.candles || []).map((c: any) => ({ date: c.t, close: c.c, open: c.o, high: c.h, low: c.l, volume: c.v }));
      } else {
        candles = (raw.price_history || []).map((c: any) => ({ date: c.date, close: c.close, open: c.open, high: c.high, low: c.low, volume: c.volume }));
      }
      setIntradayData(candles);
    } catch { setIntradayError(true); setIntradayData([]); }
    finally { setIntradayLoading(false); }
  }, [liveSymbol]);

  useEffect(() => {
    if (isIntraday || (tfKey !== "1mo" && tfKey !== "3mo" && tfKey !== "6mo" && tfKey !== "1y")) {
      fetchIntraday(tfKey);
    } else { setIntradayData([]); }
  }, [tfKey, fetchIntraday, isIntraday]);

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
    const min = Math.min(...prices), max = Math.max(...prices), pad = (max - min) * 0.04;
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
  }, [activeData]);

  const isPositive = useMemo(() => {
    if (activeData.length < 2) return true;
    return activeData[activeData.length - 1].close >= activeData[0].close;
  }, [activeData]);

  const priceColor = isPositive
    ? cssVar("--chart-price-up") || "#10b981"
    : cssVar("--chart-price-down") || "#ef4444";
  const gradientId = `priceGrad-${isPositive ? "up" : "down"}`;

  const INDICATORS = [
    { key: "ema20",  label: "EMA 20", hexColor: "#f59e0b", active: showEma20,  toggle: () => setShowEma20(p => !p) },
    { key: "ema50",  label: "EMA 50", hexColor: "#d946ef", active: showEma50,  toggle: () => setShowEma50(p => !p) },
    { key: "vwap",   label: "VWAP",   hexColor: "#06b6d4", active: showVwap,   toggle: () => setShowVwap(p => !p) },
    { key: "volume", label: "Volume", hexColor: "#6366f1", active: showVolume, toggle: () => setShowVolume(p => !p) },
  ];

  return (
    <div
      className="flex flex-col h-full rounded-2xl p-5"
      style={{ background: "var(--chart-bg)", border: "1px solid var(--chart-border)" }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Price History &amp; Indicators</h3>
          <p className="text-[10px] text-text-muted font-mono uppercase tracking-wider">
            {isIntraday ? "INTRADAY · IST" : tfKey === "1wk" ? "HOURLY" : "DAILY OHLCV"}
          </p>
        </div>
        <div
          className="flex items-center gap-1 rounded-xl p-1"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-primary)" }}
        >
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.key}
              onClick={() => setTfKey(tf.key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all duration-150 ${
                tfKey === tf.key
                  ? "bg-accent-primary text-white shadow shadow-accent-primary/30"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Indicator toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {INDICATORS.map(({ key, label, hexColor, active, toggle }) => (
          <button
            key={key}
            onClick={toggle}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium cursor-pointer transition-all duration-200"
            style={active
              ? { background: `${hexColor}1a`, color: hexColor, borderColor: `${hexColor}55` }
              : { background: "transparent", color: "var(--toggle-inactive-text)", borderColor: "var(--toggle-inactive-border)" }
            }
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? hexColor : "var(--text-muted)" }} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 w-full min-h-[260px]">
        {intradayLoading ? (
          <div className="flex items-center justify-center h-full space-x-2">
            <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono text-text-muted">Loading {TIMEFRAMES.find(t => t.key === tfKey)?.label} data…</span>
          </div>
        ) : intradayError && (isIntraday || tfKey === "1wk") ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs font-mono text-text-muted">Failed to load intraday data. Try another timeframe.</p>
          </div>
        ) : activeData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs font-mono text-text-muted">No chart data available.</p>
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
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={d => formatTick(d, tfKey)}
                stroke="var(--border-subtle)"
                tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: "monospace" }}
                dy={8}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                domain={yDomain}
                stroke="var(--border-subtle)"
                tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: "monospace" }}
                dx={-4}
                tickFormatter={v => `${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-primary)",
                  borderRadius: "10px",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  boxShadow: "var(--shadow)",
                }}
                labelFormatter={l => formatTooltipLabel(l, tfKey)}
                formatter={(value: any, name: any) => [`${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, String(name)]}
              />
              {showVolume && (
                <Bar dataKey="volume" name="Volume" yAxisId="vol"
                  fill="var(--chart-volume-fill)" stroke="var(--chart-volume-stroke)" strokeWidth={0} />
              )}
              <Area
                type="monotone" dataKey="close" name="Price"
                stroke={priceColor} strokeWidth={1.8}
                fillOpacity={1} fill={`url(#${gradientId})`}
                dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: priceColor }}
              />
              {showEma20 && !isIntraday && (
                <Line type="monotone" dataKey="ema20" name="EMA 20"
                  stroke="var(--chart-ema20)" strokeWidth={1.2} dot={false} activeDot={{ r: 3 }} />
              )}
              {showEma50 && !isIntraday && (
                <Line type="monotone" dataKey="ema50" name="EMA 50"
                  stroke="var(--chart-ema50)" strokeWidth={1.2} dot={false} activeDot={{ r: 3 }} />
              )}
              {showVwap && (
                <Line type="monotone" dataKey="vwap" name="VWAP"
                  stroke="var(--chart-vwap)" strokeWidth={1.2} dot={false} activeDot={{ r: 3 }} />
              )}
              {showVolume && <YAxis yAxisId="vol" orientation="right" hide />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
