"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from "recharts";

interface ChartDataPoint {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
  vwap?: number;
}

interface PriceChartProps {
  data: ChartDataPoint[];
}

export default function PriceChart({ data }: PriceChartProps) {
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showVwap, setShowVwap] = useState(false);

  // Filter out data points that don't have valid close values
  const chartData = useMemo(() => {
    return data.map((d) => ({
      ...d,
      close: parseFloat(d.close.toFixed(2)),
      ema20: d.ema20 ? parseFloat(d.ema20.toFixed(2)) : undefined,
      ema50: d.ema50 ? parseFloat(d.ema50.toFixed(2)) : undefined,
      vwap: d.vwap ? parseFloat(d.vwap.toFixed(2)) : undefined,
    }));
  }, [data]);

  // Determine domain range dynamically for visual spacing
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const prices = chartData.map((d) => d.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.05;
    return [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)];
  }, [chartData]);

  // Format date ticks for XAxis
  const formatXAxis = (tickItem: string) => {
    try {
      const date = new Date(tickItem);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return tickItem;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0c1020]/45 border border-[rgba(255,255,255,0.06)] rounded-2xl p-6">
      {/* Chart Header and Overlay Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 className="text-base font-bold text-white">Price History & Moving Averages</h3>
          <p className="text-xs text-gray-500 font-mono">DAILY OHLCV DATA</p>
        </div>
        
        {/* Toggle checkboxes */}
        <div className="flex flex-wrap gap-3">
          {/* EMA 20 */}
          <button
            onClick={() => setShowEma20(!showEma20)}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all duration-200 ${
              showEma20
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                : "bg-transparent text-gray-500 border-gray-800 hover:border-gray-700"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${showEma20 ? "bg-amber-400" : "bg-gray-600"}`} />
            <span>EMA 20</span>
          </button>

          {/* EMA 50 */}
          <button
            onClick={() => setShowEma50(!showEma50)}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all duration-200 ${
              showEma50
                ? "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30"
                : "bg-transparent text-gray-500 border-gray-800 hover:border-gray-700"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${showEma50 ? "bg-fuchsia-400" : "bg-gray-600"}`} />
            <span>EMA 50</span>
          </button>

          {/* VWAP */}
          <button
            onClick={() => setShowVwap(!showVwap)}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all duration-200 ${
              showVwap
                ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
                : "bg-transparent text-gray-500 border-gray-800 hover:border-gray-700"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${showVwap ? "bg-cyan-400" : "bg-gray-600"}`} />
            <span>VWAP</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="flex-1 w-full min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id="priceGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.03)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#64748b", fontSize: 10, fontFamily: "monospace" }}
              dy={10}
            />
            <YAxis
              domain={yDomain}
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: "#64748b", fontSize: 10, fontFamily: "monospace" }}
              dx={-5}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0a0d1a",
                borderColor: "rgba(255,255,255,0.08)",
                borderRadius: "12px",
                color: "#f8fafc",
                fontSize: "12px",
                fontFamily: "monospace",
                boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)"
              }}
              labelFormatter={(label) => `Date: ${label}`}
            />
            
            {/* Price Area chart */}
            <Area
              type="monotone"
              dataKey="close"
              name="Close Price"
              stroke="#3b82f6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#priceGlow)"
            />
            
            {/* EMA 20 Line overlay */}
            {showEma20 && (
              <Line
                type="monotone"
                dataKey="ema20"
                name="EMA 20"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}

            {/* EMA 50 Line overlay */}
            {showEma50 && (
              <Line
                type="monotone"
                dataKey="ema50"
                name="EMA 50"
                stroke="#d946ef"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}

            {/* VWAP Line overlay */}
            {showVwap && (
              <Line
                type="monotone"
                dataKey="vwap"
                name="VWAP"
                stroke="#06b6d4"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
