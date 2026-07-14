"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowUpRight, ArrowDownRight, Compass } from "lucide-react";

interface SectorData {
  name: string;
  change: number; // percentage change e.g. +1.45 or -0.82
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  count: number;
  sparkline?: number[];
}

const API = "http://127.0.0.1:8000";

// Helper to generate SVG polyline points from prices array
function getSparklinePoints(prices: number[] | undefined, width: number = 120, height: number = 24): string {
  if (!prices || prices.length < 2) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min === 0 ? 1 : max - min;
  
  return prices
    .map((price, idx) => {
      const x = (idx / (prices.length - 1)) * width;
      const y = height - ((price - min) / range) * (height - 4) - 2; // pad 2px top/bottom
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function SectorHeatmap() {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSectors = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/market/sectors`);
      if (!res.ok) throw new Error("Failed to fetch sector heatmap");
      const data = await res.json();
      setSectors(data.sectors || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSectors();
    const interval = setInterval(fetchSectors, 10000);
    return () => clearInterval(interval);
  }, [fetchSectors]);

  return (
    <div className="flex flex-col bg-[#0c1020]/45 border border-[rgba(255,255,255,0.06)] rounded-2xl p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-bold text-white">Sector Performance Heatmap</h3>
          <p className="text-xs text-gray-500 font-mono">SECTOR ACCUMULATED MOMENTUM</p>
        </div>
        <Compass className="w-5 h-5 text-gray-500 animate-spin-slow" />
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3 flex-1">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-500 font-mono">Loading Sector Momentum...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 flex-1">
          {sectors.map((sector) => {
            const isPositive = sector.change >= 0;
            const bgIntensity = Math.min(Math.abs(sector.change) * 12, 45); // Color scale
            
            return (
              <div
                key={sector.name}
                className="glass-panel p-4 relative group flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] cursor-pointer hover:border-white/10"
                style={{
                  background: isPositive
                    ? `rgba(16, 185, 129, ${bgIntensity / 250})`
                    : `rgba(244, 63, 94, ${bgIntensity / 250})`,
                  borderColor: isPositive
                    ? `rgba(16, 185, 129, 0.12)`
                    : `rgba(244, 63, 94, 0.12)`,
                }}
              >
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold text-white/90 group-hover:text-white truncate max-w-[70%]">
                    {sector.name}
                  </span>
                  
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-black/40 text-gray-400">
                    {sector.count} Assets
                  </span>
                </div>

                {/* SVG Sparkline */}
                <div className="my-3 h-6 flex items-center justify-center">
                  {sector.sparkline && sector.sparkline.length > 1 ? (
                    <svg width="100%" height="24" className="overflow-visible opacity-80 group-hover:opacity-100 transition-opacity">
                      <polyline
                        fill="none"
                        stroke={isPositive ? "#10b981" : "#f43f5e"}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={getSparklinePoints(sector.sparkline, 140, 24)}
                      />
                    </svg>
                  ) : (
                    <div className="w-full border-b border-dashed border-white/[0.04] h-0" />
                  )}
                </div>

                <div className="flex items-end justify-between mt-2">
                  <div>
                    <span className={`text-[10px] font-bold tracking-wider ${
                      sector.sentiment === "BULLISH" ? "text-emerald-400" :
                      sector.sentiment === "BEARISH" ? "text-rose-400" : "text-gray-400"
                    }`}>
                      {sector.sentiment}
                    </span>
                    <p className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">Sentiment</p>
                  </div>

                  <div className="text-right">
                    <div className={`flex items-center font-mono font-bold text-xs ${
                      isPositive ? "text-emerald-400" : "text-rose-400"
                    }`}>
                      {isPositive ? "+" : ""}{sector.change.toFixed(2)}%
                      {isPositive ? (
                        <ArrowUpRight className="w-3 h-3 ml-0.5 text-emerald-400" />
                      ) : (
                        <ArrowDownRight className="w-3 h-3 ml-0.5 text-rose-400" />
                      )}
                    </div>
                    <p className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">Day Change</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
