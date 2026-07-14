"use client";

import { useMemo } from "react";
import { ArrowUpRight, ArrowDownRight, Compass } from "lucide-react";

interface SectorData {
  name: string;
  change: number; // percentage change e.g. +1.45 or -0.82
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  count: number;
}

export default function SectorHeatmap() {
  // Preset list of financial sectors with mock metrics to show a highly complete Bloomberg-grade heatmap
  const sectors: SectorData[] = useMemo(() => {
    return [
      { name: "IT & Software", change: 2.14, sentiment: "BULLISH", count: 8 },
      { name: "Financial Services", change: 1.05, sentiment: "BULLISH", count: 4 },
      { name: "Healthcare & Pharma", change: -0.42, sentiment: "NEUTRAL", count: 5 },
      { name: "Automobile", change: 0.88, sentiment: "BULLISH", count: 6 },
      { name: "FMCG", change: -1.25, sentiment: "BEARISH", count: 3 },
      { name: "Energy & Power", change: 3.42, sentiment: "BULLISH", count: 4 },
      { name: "Metals & Mining", change: 0.12, sentiment: "NEUTRAL", count: 4 },
      { name: "Infrastructure", change: -0.75, sentiment: "BEARISH", count: 2 },
      { name: "Real Estate", change: -0.18, sentiment: "NEUTRAL", count: 3 },
    ];
  }, []);

  return (
    <div className="flex flex-col bg-[#0c1020]/45 border border-[rgba(255,255,255,0.06)] rounded-2xl p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-bold text-white">Sector Performance Heatmap</h3>
          <p className="text-xs text-gray-500 font-mono">SECTOR ACCUMULATED MOMENTUM</p>
        </div>
        <Compass className="w-5 h-5 text-gray-500 animate-spin-slow" />
      </div>

      {/* Grid of Sector Cells */}
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
                <span className="text-xs font-semibold text-white/90 group-hover:text-white truncate max-w-[80%]">
                  {sector.name}
                </span>
                
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-black/40 text-gray-400">
                  {sector.count} Assets
                </span>
              </div>

              <div className="flex items-end justify-between mt-6">
                <div>
                  <span className={`text-xs font-semibold tracking-wider ${
                    sector.sentiment === "BULLISH" ? "text-emerald-400" :
                    sector.sentiment === "BEARISH" ? "text-rose-400" : "text-gray-400"
                  }`}>
                    {sector.sentiment}
                  </span>
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">Sentiment</p>
                </div>

                <div className="text-right">
                  <div className={`flex items-center font-mono font-bold text-sm ${
                    isPositive ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {isPositive ? "+" : ""}{sector.change.toFixed(2)}%
                    {isPositive ? (
                      <ArrowUpRight className="w-3.5 h-3.5 ml-0.5 text-emerald-400" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 ml-0.5 text-rose-400" />
                    )}
                  </div>
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">Day Change</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
