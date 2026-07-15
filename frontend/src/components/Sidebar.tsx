"use client";

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
} from "lucide-react";
import { useTheme } from "./ThemeContext";

export default function Sidebar() {
  const pathname = usePathname();
  const { theme } = useTheme();

  const menuItems = [
    {
      name: "Market Overview",
      href: "/market",
      icon: LayoutDashboard,
    },
    {
      name: "Ticker Deep-Dive",
      href: "/ticker/RELIANCE",
      icon: TrendingUp,
      match: (path: string) => path.startsWith("/ticker"),
    },
    {
      name: "Screener",
      href: "/intraday-screener",
      icon: ScanLine,
      match: (path: string) => path.startsWith("/intraday-screener"),
    },
    {
      name: "Watchlist",
      href: "/screener",
      icon: Star,
    },
    {
      name: "Alerts Feed",
      href: "/alerts",
      icon: Bell,
    },
  ];

  return (
    <aside className="w-64 bg-bg-secondary border-r border-border-primary flex flex-col h-screen sticky top-0 shrink-0">
      {/* Brand Header */}
      <div className="p-6 border-b border-border-primary flex items-center space-x-3">
        <div className="w-9 h-9 rounded-lg bg-accent-primary flex items-center justify-center shadow-lg shadow-accent-primary/20">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wider uppercase text-text-primary font-sans">Market Rover</h1>
          <span className="text-[10px] text-text-muted font-mono">AI EQUITY HUB</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = item.match 
            ? item.match(pathname) 
            : pathname === item.href;
            
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group text-sm ${
                isActive
                  ? theme === "light"
                    ? "bg-accent-primary text-white border border-transparent shadow-sm font-semibold"
                    : "bg-accent-primary/10 text-accent-primary border border-accent-primary/20 font-semibold"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${
                  isActive
                    ? theme === "light"
                      ? "text-white"
                      : "text-accent-primary"
                    : "text-text-secondary group-hover:text-text-primary"
                }`} />
                <span>{item.name}</span>
              </div>
              <ChevronRight className={`w-3 h-3 transition-transform duration-200 opacity-0 group-hover:opacity-100 ${
                isActive
                  ? theme === "light"
                    ? "opacity-100 text-white"
                    : "opacity-100 text-accent-primary"
                  : "text-text-muted"
              }`} />
            </Link>
          );
        })}
      </nav>

      {/* Bottom Profile Info / Connection Status */}
      <div className="p-4 border-t border-border-primary bg-bg-primary/50">
        <div className="flex items-center space-x-3 p-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          <span className="text-xs text-text-muted font-mono">FastAPI API Connected</span>
        </div>
      </div>
    </aside>
  );
}
