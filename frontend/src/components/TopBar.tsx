"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Sun, Moon, Waves, Clock, LayoutDashboard, Briefcase, 
  TrendingUp, ScanLine, Star, Bell 
} from "lucide-react";
import { useTheme } from "./ThemeContext";

const THEMES = [
  { id: "light" as const, label: "Light", icon: Sun },
  { id: "dark" as const, label: "Dark", icon: Moon },
  { id: "deepblue" as const, label: "Deep Blue", icon: Waves },
];

const menuItems = [
  { name: "Market", href: "/market", icon: LayoutDashboard, match: (p: string) => p === "/market" },
  { name: "Portfolio", href: "/portfolio", icon: Briefcase, match: (p: string) => p.startsWith("/portfolio") },
  { name: "Deep-Dive", href: "/ticker/RELIANCE", icon: TrendingUp, match: (p: string) => p.startsWith("/ticker") },
  { name: "Screener", href: "/intraday-screener", icon: ScanLine, match: (p: string) => p.startsWith("/intraday-screener") },
  { name: "Watchlist", href: "/screener", icon: Star, match: (p: string) => p === "/screener" },
  { name: "Alerts", href: "/alerts", icon: Bell, match: (p: string) => p.startsWith("/alerts") },
];

function useClock() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
      setDate(
        now.toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "short",
          day: "2-digit",
          month: "short",
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return { time, date };
}

interface TopBarProps {
  /** Main page title shown on the left */
  title: string;
  /** Optional subtitle / description */
  subtitle?: string;
  /** Optional icon (React node) placed before the title */
  icon?: React.ReactNode;
  /** Additional controls to render on the right (before theme switcher) */
  actions?: React.ReactNode;
}

export default function TopBar({ title, subtitle, icon, actions }: TopBarProps) {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const { time, date } = useClock();

  return (
    <header className="sticky top-0 z-30 flex flex-col border-b border-border-primary bg-bg-secondary/90 backdrop-blur-xl">
      {/* ── Main Header Row ── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3 min-w-0">
        
        {/* ── Left: icon + title ── */}
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-accent-primary/15 flex items-center justify-center shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-text-primary leading-none truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] text-text-muted mt-0.5 truncate hidden sm:block">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* ── Right: clock + actions + theme ── */}
        <div className="flex items-center gap-2 shrink-0">
          
          {/* Live clock — hidden on very small screens */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-bg-tertiary border border-border-primary">
            <Clock className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <div className="text-right leading-none">
              <p className="text-xs font-bold font-mono text-text-primary tabular-nums">
                {time || "──:──:──"}
              </p>
              <p className="text-[9px] text-text-muted mt-0.5">{date} IST</p>
            </div>
          </div>

          {/* Caller-supplied action buttons */}
          {actions}

          {/* Theme switcher */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-border-primary bg-bg-secondary hidden sm:flex">
            {THEMES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                title={`${label} theme`}
                className={`p-1.5 rounded-lg transition-all duration-200 ${
                  theme === id
                    ? "bg-accent-primary text-white shadow-md"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                }`}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Navigation Row ── */}
      <nav className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 pb-2 no-scrollbar border-t border-border-primary/50 pt-2 shadow-inner shadow-black/5">
        {menuItems.map((item) => {
          const isActive = pathname ? item.match(pathname) : false;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-medium transition-colors ${
                isActive
                  ? "bg-accent-primary/10 text-accent-primary border border-accent-primary/20"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border border-transparent"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? "text-accent-primary" : "text-text-muted"}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
