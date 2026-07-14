"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";

interface SearchAutocompleteProps {
  placeholder: string;
  onSelect: (symbol: string) => void;
  initialValue?: string;
  clearOnSelect?: boolean;
}

interface Suggestion {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export default function SearchAutocomplete({
  placeholder,
  onSelect,
  initialValue = "",
  clearOnSelect = false,
}: SearchAutocompleteProps) {
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with initialValue changes
  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search trigger
  useEffect(() => {
    if (query.trim().length === 0) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    // Don't search if the query exactly matches one of the loaded suggestions to prevent loop
    const isExactMatch = suggestions.some(s => s.symbol.toUpperCase() === query.trim().toUpperCase());
    if (isExactMatch && !showDropdown) return;

    const delayDebounce = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.results || []);
          setShowDropdown(data.results && data.results.length > 0);
          setActiveIndex(-1);
        }
      } catch (err) {
        console.warn("Autocomplete fetch error:", err);
      } finally {
        setLoading(false);
      }
    }, 250); // 250ms debounce

    return () => clearTimeout(delayDebounce);
  }, [query]);

  const handleSelect = (symbol: string) => {
    if (clearOnSelect) {
      setQuery("");
    } else {
      setQuery(symbol);
    }
    setShowDropdown(false);
    onSelect(symbol);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        handleSelect(suggestions[activeIndex].symbol);
      } else if (query.trim()) {
        handleSelect(query.trim().toUpperCase());
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input Input */}
      <div className="relative flex items-center">
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        className="search-input w-full rounded-xl pl-4 pr-10 py-2.5 text-xs font-mono tracking-wide focus:outline-none transition-colors"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
            color: "var(--input-text)",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "var(--input-focus-border)"; setShowDropdown(suggestions.length > 0); }}
          onBlur={e => { e.currentTarget.style.borderColor = "var(--input-border)"; }}
        />
        <div className="absolute right-3.5 flex items-center">
          {loading ? (
            <Loader2 className="w-4 h-4 text-accent-primary animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </div>

      {/* Floating Suggestions List */}
      {showDropdown && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 mt-2 z-50 rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden max-h-60 overflow-y-auto"
          style={{ background: "var(--dropdown-bg)", border: "1px solid var(--dropdown-border)" }}
        >
          <ul className="divide-y" style={{ borderColor: "var(--dropdown-border)" }}>
            {suggestions.map((item, idx) => (
              <li
                key={item.symbol}
                onClick={() => handleSelect(item.symbol)}
                className="p-3 cursor-pointer flex items-center justify-between text-xs transition-colors duration-150"
                style={{
                  background: activeIndex === idx ? "var(--dropdown-active)" : "transparent",
                  color: "var(--text-primary)",
                }}
                onMouseEnter={e => { if (activeIndex !== idx) (e.currentTarget as HTMLElement).style.background = "var(--dropdown-hover)"; }}
                onMouseLeave={e => { if (activeIndex !== idx) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-text-primary tracking-wide">{item.symbol}</span>
                    <span className="text-[9px] uppercase tracking-wider text-text-muted font-medium">
                      {item.exchange}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-secondary truncate max-w-[240px] mt-0.5">{item.name}</div>
                </div>
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "var(--bg-tertiary)", color: "var(--accent-primary)" }}
                >
                  {item.type}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
