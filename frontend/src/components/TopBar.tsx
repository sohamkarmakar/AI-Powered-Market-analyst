"use client";

import { useEffect, useState } from "react";
import { Menu, Sun, Moon, Waves, Clock } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useSidebar } from "./SidebarContext";

const THEMES = [
  { id: "light" as const, label: "Light", icon: Sun },
  { id: "dark" as const, label: "Dark", icon: Moon },
  { id: "deepblue" as const, label: "Deep Blue", icon: Waves },
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
  const { toggle } = useSidebar();
  const { time, date } = useClock();

  return (
    <header className="sticky top-0 z-30 border-b border-border-primary bg-bg-secondary/90 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3 min-w-0">

        {/* ── Left: hamburger + title ── */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Hamburger (always visible — on large screens it re-opens sidebar if needed) */}
          <button
            onClick={toggle}
            className="p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-all shrink-0"
            aria-label="Toggle menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Icon + Title */}
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
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-bg-tertiary border border-border-primary">
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
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-border-primary bg-bg-secondary">
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
    </header>
  );
}
