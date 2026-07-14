"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { 
  Bell, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Activity,
  ArrowRight,
  Eye,
  CheckCircle,
  Info
} from "lucide-react";

interface SystemAlert {
  id: string;
  symbol: string;
  type: "RSI_OVERBOUGHT" | "RSI_OVERSOLD" | "BULLISH_ORB" | "BEARISH_ORB" | "EMA_CROSSOVER";
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export default function AlertsFeedPage() {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");
  const [usingMock, setUsingMock] = useState(false);

  useEffect(() => {
    async function loadAlerts() {
      setLoading(true);
      try {
        const activeSymbols = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"];
        const dynamicAlerts: SystemAlert[] = [];

        for (const sym of activeSymbols) {
          try {
            const indRes = await fetch(`http://127.0.0.1:8000/api/ticker/${sym}/indicators`);
            if (indRes.ok) {
              const indData = await indRes.json();
              const indicatorsList = indData.indicators;
              if (indicatorsList.length > 0) {
                const latest = indicatorsList[indicatorsList.length - 1];
                
                if (latest.rsi && latest.rsi > 70) {
                  dynamicAlerts.push({
                    id: `rsi-ob-${sym}`, symbol: sym, type: "RSI_OVERBOUGHT", severity: "HIGH",
                    message: `${sym} is trading at overbought levels with an RSI of ${latest.rsi.toFixed(1)}.`,
                    timestamp: new Date().toISOString(), acknowledged: false
                  });
                } else if (latest.rsi && latest.rsi < 30) {
                  dynamicAlerts.push({
                    id: `rsi-os-${sym}`, symbol: sym, type: "RSI_OVERSOLD", severity: "HIGH",
                    message: `${sym} is trading at oversold levels with an RSI of ${latest.rsi.toFixed(1)}.`,
                    timestamp: new Date().toISOString(), acknowledged: false
                  });
                }

                if (indData.orb_signal && indData.orb_signal.signal === "BULLISH_BREAKOUT") {
                  dynamicAlerts.push({
                    id: `orb-bull-${sym}`, symbol: sym, type: "BULLISH_ORB", severity: "MEDIUM",
                    message: `${sym} triggered a Bullish 30M Opening Range Breakout above ₹${indData.orb_signal.opening_high.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`,
                    timestamp: new Date().toISOString(), acknowledged: false
                  });
                } else if (indData.orb_signal && indData.orb_signal.signal === "BEARISH_BREAKOUT") {
                  dynamicAlerts.push({
                    id: `orb-bear-${sym}`, symbol: sym, type: "BEARISH_ORB", severity: "MEDIUM",
                    message: `${sym} triggered a Bearish 30M Opening Range Breakout below ₹${indData.orb_signal.opening_low.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`,
                    timestamp: new Date().toISOString(), acknowledged: false
                  });
                }
              }
            }
          } catch { /* skip */ }
        }

        if (dynamicAlerts.length === 0) throw new Error("No alerts found");
        setAlerts(dynamicAlerts);
        setUsingMock(false);
      } catch {
        setAlerts([
          { id: "1", symbol: "ICICIBANK", type: "RSI_OVERBOUGHT", severity: "HIGH",
            message: "ICICI Bank is trading at extreme overbought conditions with a daily RSI (14) of 72.80.",
            timestamp: new Date(Date.now() - 45 * 60000).toISOString(), acknowledged: false },
          { id: "2", symbol: "TCS", type: "BULLISH_ORB", severity: "MEDIUM",
            message: "TCS triggered a Bullish 30M Opening Range Breakout, breaking above the opening high of ₹3,810.00 to trade at ₹3,825.50.",
            timestamp: new Date(Date.now() - 2 * 3600000).toISOString(), acknowledged: false },
          { id: "3", symbol: "RELIANCE", type: "BEARISH_ORB", severity: "MEDIUM",
            message: "Reliance triggered a Bearish 30M Opening Range Breakout, breaking below the opening low of ₹2,530.00 to trade at ₹2,525.00.",
            timestamp: new Date(Date.now() - 4 * 3600000).toISOString(), acknowledged: false },
          { id: "4", symbol: "INFY", type: "EMA_CROSSOVER", severity: "LOW",
            message: "Infosys price crossed below the EMA 50 support line, currently trading at ₹1,542.80.",
            timestamp: new Date(Date.now() - 12 * 3600000).toISOString(), acknowledged: true },
        ]);
        setUsingMock(true);
      } finally {
        setLoading(false);
      }
    }
    loadAlerts();
  }, []);

  const handleAcknowledge = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
  };

  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => filterSeverity === "ALL" || a.severity === filterSeverity);
  }, [alerts, filterSeverity]);

  return (
    <div className="p-8 space-y-8 flex-1 bg-bg-primary">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">Alerts Feed</h2>
          <p className="text-sm text-text-muted font-mono">AUTOMATED TECHNICAL MOMENTUM MONITORS</p>
        </div>
        <Bell className="w-5 h-5 text-text-muted" />
      </div>

      {/* Connection Notice */}
      {usingMock && (
        <div className="bg-accent-primary/10 border border-accent-primary/20 text-accent-primary rounded-xl p-4 flex items-start space-x-3 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Displaying Offline Demo Alerts:</span>{" "}
            Start your FastAPI server on port 8000 to enable real-time calculation and listing of technical indicators alerts.
          </div>
        </div>
      )}

      {/* Severity Filter Controls */}
      <div className="flex space-x-2 bg-bg-secondary border border-border-primary rounded-2xl p-2.5 w-max">
        {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map((sev) => (
          <button
            key={sev}
            onClick={() => setFilterSeverity(sev)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wider cursor-pointer transition-all duration-200 uppercase ${
              filterSeverity === sev
                ? "bg-accent-primary text-white shadow-lg shadow-accent-primary/25"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
            }`}
          >
            {sev}
          </button>
        ))}
      </div>

      {/* Alerts Feed */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center space-y-3">
            <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-text-muted font-mono">Scanning Market Activity...</span>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="glass-panel py-20 text-center flex flex-col items-center justify-center space-y-2">
            <CheckCircle className="w-12 h-12 text-positive opacity-30" />
            <h4 className="text-sm font-bold text-text-primary font-mono">No Active Alerts</h4>
            <p className="text-xs text-text-muted max-w-sm">No momentum extremes or breakouts detected on the tracked stocks.</p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isOb = alert.type === "RSI_OVERBOUGHT";
            const isOs = alert.type === "RSI_OVERSOLD";
            const isBull = alert.type === "BULLISH_ORB";
            
            return (
              <div
                key={alert.id}
                className={`glass-panel p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 transition-all duration-200 border-l-4 ${
                  alert.acknowledged ? "opacity-60 border-l-border-subtle" :
                  alert.severity === "HIGH" ? "border-l-negative" :
                  alert.severity === "MEDIUM" ? "border-l-neutral" : "border-l-accent-primary"
                }`}
              >
                <div className="flex items-start space-x-4">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    alert.acknowledged ? "bg-bg-tertiary" :
                    isOb || isOs ? "bg-negative-bg" : "bg-positive-bg"
                  }`}>
                    {isOb || isOs ? (
                      <AlertTriangle className={`w-5 h-5 ${alert.acknowledged ? "text-text-muted" : "text-negative"}`} />
                    ) : isBull ? (
                      <TrendingUp className={`w-5 h-5 ${alert.acknowledged ? "text-text-muted" : "text-positive"}`} />
                    ) : (
                      <TrendingDown className={`w-5 h-5 ${alert.acknowledged ? "text-text-muted" : "text-negative"}`} />
                    )}
                  </div>

                  {/* Message */}
                  <div className="space-y-1">
                    <div className="flex items-center space-x-3">
                      <span className="text-xs font-mono font-bold text-text-primary tracking-wide">{alert.symbol}</span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        alert.severity === "HIGH" ? "bg-negative-bg text-negative" :
                        alert.severity === "MEDIUM" ? "bg-neutral-bg text-neutral" :
                        "bg-accent-primary/10 text-accent-primary"
                      }`}>
                        {alert.severity}
                      </span>
                      <span className="text-[10px] text-text-muted font-mono">
                        {new Date(alert.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed font-sans">{alert.message}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-3 w-full sm:w-auto justify-end border-t border-border-primary sm:border-none pt-3 sm:pt-0">
                  {!alert.acknowledged && (
                    <button
                      onClick={() => handleAcknowledge(alert.id)}
                      className="px-3.5 py-1.5 rounded-lg bg-bg-tertiary hover:bg-bg-elevated text-text-secondary text-xs font-semibold tracking-wide cursor-pointer transition-all duration-200 border border-border-primary"
                    >
                      Acknowledge
                    </button>
                  )}
                  
                  <Link
                    href={`/ticker/${alert.symbol}`}
                    className="inline-flex items-center space-x-1 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white text-xs font-semibold tracking-wide transition-all duration-200"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Terminal</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
