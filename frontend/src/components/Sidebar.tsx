"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TrendingUp,
  LayoutDashboard,
  Star,
  Bell,
  Activity,
  ChevronRight,
  ScanLine,
  Briefcase,
  X,
  Sun,
  Moon,
  Waves,
  Clock,
} from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useSidebar } from "./SidebarContext";

const THEMES = [
  { id: "light" as const, label: "Light", icon: Sun },
  { id: "dark" as const, label: "Dark", icon: Moon },
  { id: "deepblue" as const, label: "Deep Blue", icon: Waves },
];

const menuItems = [
  {
    name: "Market Overview",
    href: "/market",
    icon: LayoutDashboard,
    match: (p: string) => p === "/market",
  },
  {
    name: "Portfolio",
    href: "/portfolio",
    icon: Briefcase,
    match: (p: string) => p.startsWith("/portfolio"),
  },
  {
    name: "Ticker Deep-Dive",
    href: "/ticker/RELIANCE",
    icon: TrendingUp,
    match: (p: string) => p.startsWith("/ticker"),
  },
  {
    name: "Screener",
    href: "/intraday-screener",
    icon: ScanLine,
    match: (p: string) => p.startsWith("/intraday-screener"),
  },
  {
    name: "Watchlist",
    href: "/screener",
    icon: Star,
    match: (p: string) => p === "/screener",
  },
  {
    name: "Alerts Feed",
    href: "/alerts",
    icon: Bell,
    match: (p: string) => p.startsWith("/alerts"),
  },
];

function useClock() {
  const [time, setTime] = useState<string>("");
  const [date, setDate] = useState<string>("");

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

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { open, setOpen } = useSidebar();
  const { time, date } = useClock();

  // Close sidebar on route change (mobile UX)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* ── Backdrop overlay (mobile) ── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Sidebar drawer ── */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-full w-72
          bg-bg-secondary border-r border-border-primary
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${open ? "translate-x-0 shadow-2xl" : "-translate-x-full"}
          lg:relative lg:translate-x-0 lg:shadow-none lg:w-64 lg:shrink-0 lg:z-auto
        `}
      >
        {/* ── Brand Header ── */}
        <div className="p-5 border-b border-border-primary flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-accent-primary flex items-center justify-center shadow-lg shadow-accent-primary/25 shrink-0">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wider uppercase text-text-primary font-sans leading-none">
                Market Rover
              </h1>
              <span className="text-[10px] text-text-muted font-mono">AI EQUITY HUB</span>
            </div>
          </div>
          {/* Close button (visible always on mobile, hidden on lg when always-open) */}
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-all"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Live Clock ── */}
        <div className="mx-4 mt-4 px-4 py-3 rounded-xl bg-bg-tertiary border border-border-primary flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-accent-primary/15 flex items-center justify-center shrink-0">
            <Clock className="w-3.5 h-3.5 text-accent-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold font-mono text-text-primary leading-none tabular-nums">
              {time || "──:──:──"}
            </p>
            <p className="text-[10px] text-text-muted mt-0.5">{date || "IST"} · IST</p>
          </div>
        </div>

        {/* ── Navigation Links ── */}
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all duration-200 group text-sm ${
                  isActive
                    ? theme === "light"
                      ? "bg-accent-primary text-white border border-transparent shadow-sm font-semibold"
                      : "bg-accent-primary/10 text-accent-primary border border-accent-primary/20 font-semibold"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                      isActive
                        ? theme === "light"
                          ? "text-white"
                          : "text-accent-primary"
                        : "text-text-secondary group-hover:text-text-primary"
                    }`}
                  />
                  <span className="truncate">{item.name}</span>
                </div>
                <ChevronRight
                  className={`w-3 h-3 shrink-0 transition-transform duration-200 ${
                    isActive
                      ? theme === "light"
                        ? "opacity-100 text-white"
                        : "opacity-100 text-accent-primary"
                      : "opacity-0 group-hover:opacity-100 text-text-muted"
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        {/* ── Theme Switcher ── */}
        <div className="mx-4 mb-3 p-3 rounded-xl bg-bg-tertiary border border-border-primary">
          <p className="text-[10px] text-text-muted uppercase tracking-widest mb-2 px-0.5 font-semibold">
            Theme
          </p>
          <div className="flex gap-1.5">
            {THEMES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                title={label}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  theme === id
                    ? "bg-accent-primary text-white shadow-md shadow-accent-primary/25"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
                }`}
              >
                <Icon size={12} />
                <span className="hidden sm:inline">{label.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Status Footer ── */}
        <div className="px-4 pb-4 border-t border-border-primary pt-3">
          <div className="flex items-center space-x-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs text-text-muted font-mono">API Connected</span>
          </div>
        </div>
      </aside>
    </>
  );
}
