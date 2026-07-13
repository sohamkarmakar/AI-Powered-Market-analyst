"use client";

import { useMemo } from "react";

interface SentimentGaugeProps {
  score: number; // -1.0 (bearish) to 1.0 (bullish)
  sentimentText?: string;
}

export default function SentimentGauge({ score, sentimentText }: SentimentGaugeProps) {
  // Normalize score from [-1, 1] to a percentage [0, 100]
  const percentage = useMemo(() => {
    const clamped = Math.max(-1, Math.min(1, score));
    return ((clamped + 1) / 2) * 100;
  }, [score]);

  // Map to color hex codes
  const color = useMemo(() => {
    if (score > 0.15) return "#10b981"; // green
    if (score < -0.15) return "#f43f5e"; // red
    return "#64748b"; // gray
  }, [score]);

  // Determine standard categories
  const category = useMemo(() => {
    if (sentimentText) return sentimentText.toUpperCase();
    if (score > 0.15) return "BULLISH";
    if (score < -0.15) return "BEARISH";
    return "NEUTRAL";
  }, [score, sentimentText]);

  // Calculation for the needle angle: percentage from 0 to 100 maps to -90 to 90 degrees
  const angle = useMemo(() => {
    return (percentage / 100) * 180 - 90;
  }, [percentage]);

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="relative w-48 h-28 flex items-end justify-center overflow-hidden">
        {/* Semi-circular gauge track */}
        <svg className="w-48 h-24 overflow-visible" viewBox="0 0 100 50">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f43f5e" /> {/* Red */}
              <stop offset="50%" stopColor="#64748b" /> {/* Gray */}
              <stop offset="100%" stopColor="#10b981" /> {/* Green */}
            </linearGradient>
            <filter id="needleGlow">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={color} floodOpacity="0.8" />
            </filter>
          </defs>

          {/* Track Arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="8"
            strokeLinecap="round"
          />

          {/* Active colored gradient arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.85"
          />

          {/* Needle Base Circle */}
          <circle cx="50" cy="50" r="4" fill="#f8fafc" />

          {/* Needle Pin */}
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="15"
            stroke="#f8fafc"
            strokeWidth="2"
            strokeLinecap="round"
            filter="url(#needleGlow)"
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: "50px 50px",
              transition: "transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)"
            }}
          />
        </svg>
      </div>

      {/* Numerical and Categorical Metrics */}
      <div className="text-center mt-3">
        <span 
          className="text-xs font-semibold tracking-widest px-2.5 py-0.5 rounded-full border"
          style={{ 
            color: color, 
            borderColor: `${color}30`, 
            backgroundColor: `${color}10` 
          }}
        >
          {category}
        </span>
        <div className="text-2xl font-mono font-bold text-white mt-1.5">
          {score > 0 ? "+" : ""}{score.toFixed(2)}
        </div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-mono mt-0.5">Sentiment Score</p>
      </div>
    </div>
  );
}
