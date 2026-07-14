"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  TrendingUp, 
  LayoutDashboard, 
  Star, 
  Bell, 
  Activity,
  ChevronRight
} from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();

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
      // Matches subpaths like /ticker/RELIANCE or /ticker/TCS
      match: (path: string) => path.startsWith("/ticker"),
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
    <aside className="w-64 bg-[#0a0d1a] border-r border-[rgba(255,255,255,0.06)] flex flex-col h-screen sticky top-0 shrink-0">
      {/* Brand Header */}
      <div className="p-6 border-b border-[rgba(255,255,255,0.06)] flex items-center space-x-3">
        <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wider uppercase text-white">Market Rover</h1>
          <span className="text-[10px] text-gray-500 font-mono">AI EQUITY HUB</span>
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
                  ? "bg-blue-600/10 text-blue-400 border border-blue-500/20"
                  : "text-gray-400 hover:text-white hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${
                  isActive ? "text-blue-400" : "text-gray-400 group-hover:text-white"
                }`} />
                <span className="font-medium">{item.name}</span>
              </div>
              <ChevronRight className={`w-3 h-3 transition-transform duration-200 opacity-0 group-hover:opacity-100 ${
                isActive ? "opacity-100 text-blue-400" : "text-gray-500"
              }`} />
            </Link>
          );
        })}
      </nav>

      {/* Bottom Profile Info / Connection Status */}
      <div className="p-4 border-t border-[rgba(255,255,255,0.06)] bg-[#070912]/50">
        <div className="flex items-center space-x-3 p-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          <span className="text-xs text-gray-500 font-mono">FastAPI API Connected</span>
        </div>
      </div>
    </aside>
  );
}
