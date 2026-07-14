"use client";

import { useTheme } from "./ThemeContext";
import { Sun, Moon, Waves } from "lucide-react";

const THEMES = [
  { id: "light" as const, label: "Light", icon: Sun },
  { id: "dark" as const, label: "Dark", icon: Moon },
  { id: "deepblue" as const, label: "Deep Blue", icon: Waves },
];

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1 rounded-xl border border-border-primary p-0.5 bg-bg-secondary select-none">
      {THEMES.map(({ id, icon: Icon, label }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            onClick={() => setTheme(id)}
            title={`${label} Mode`}
            className={`p-1.5 rounded-lg transition-all duration-200 cursor-pointer ${
              active
                ? "bg-accent-primary text-white shadow-md"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
            }`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
