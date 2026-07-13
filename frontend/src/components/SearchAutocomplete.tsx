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
          onFocus={() => setShowDropdown(suggestions.length > 0)}
          onKeyDown={handleKeyDown}
          className="w-full bg-[#0c1020]/80 border border-[rgba(255,255,255,0.06)] focus:border-blue-500 focus:outline-none rounded-xl pl-4 pr-10 py-2.5 text-xs text-white placeholder-gray-500 font-mono tracking-wide"
        />
        <div className="absolute right-3.5 flex items-center">
          {loading ? (
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* Floating Suggestions List */}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-2 z-50 bg-[#0e1227]/95 border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden max-h-60 overflow-y-auto">
          <ul className="divide-y divide-white/[0.03]">
            {suggestions.map((item, idx) => (
              <li
                key={item.symbol}
                onClick={() => handleSelect(item.symbol)}
                className={`p-3 cursor-pointer flex items-center justify-between text-xs transition-colors duration-150 ${
                  activeIndex === idx ? "bg-blue-600/30 text-white" : "hover:bg-white/[0.04] text-slate-300"
                }`}
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-white tracking-wide">{item.symbol}</span>
                    <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium">
                      {item.exchange}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400 truncate max-w-[240px] mt-0.5">{item.name}</div>
                </div>

                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-blue-400">
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
