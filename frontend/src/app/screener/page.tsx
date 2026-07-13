"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { 
  ArrowUpDown, 
  ArrowUpRight, 
  Search,
  Filter,
  Eye,
  Info
} from "lucide-react";
import SearchAutocomplete from "@/components/SearchAutocomplete";

interface TickerScreenData {
  symbol: string;
  name: string;
  sector: string;
  market_cap: number;
  pe_ratio: number | null;
  price: number;
  rsi: number | null;
  orb_signal: string;
}

export default function StockScreenerPage() {
  const [tickers, setTickers] = useState<TickerScreenData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sectorFilter, setSectorFilter] = useState("ALL");
  const [sortField, setSortField] = useState<keyof TickerScreenData>("symbol");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [usingMock, setUsingMock] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [localSymbols, setLocalSymbols] = useState<string[]>([]);

  const loadScreenerData = async (symbolsOverride?: string[]) => {
    setLoading(true);
    try {
      // Query tracked tickers from Supabase
      const res = await fetch("http://127.0.0.1:8000/api/health"); // check if backend is up
      if (!res.ok) throw new Error("Backend offline");

      // Fetch all tracked symbols from the database dynamically, merging with local storage overrides
      const baseSymbols = ["AAPL", "TSLA", "MSFT", "AMZN", "NVDA", "RELIANCE.NS", "TCS.NS", "INFY.NS"];
      const currentLocal = symbolsOverride !== undefined ? symbolsOverride : localSymbols;
      let activeSymbols = Array.from(new Set([...baseSymbols, ...currentLocal]));

      try {
        const tickersRes = await fetch("http://127.0.0.1:8000/api/tickers");
        if (tickersRes.ok) {
          const tickersData = await tickersRes.json();
          if (tickersData.tickers && tickersData.tickers.length > 0) {
            const dbSymbols = tickersData.tickers.map((t: any) => t.symbol.toUpperCase());
            activeSymbols = Array.from(new Set([...activeSymbols, ...dbSymbols]));
          }
        }
      } catch (err) {
        console.warn("Failed to fetch tickers from database, using defaults & local storage", err);
      }

      const fetchPromises = activeSymbols.map(async (sym) => {
        try {
          const [symRes, indRes] = await Promise.all([
            fetch(`http://127.0.0.1:8000/api/ticker/${sym}`),
            fetch(`http://127.0.0.1:8000/api/ticker/${sym}/indicators`)
          ]);
          
          if (symRes.ok && indRes.ok) {
            const symData = await symRes.json();
            const indData = await indRes.json();
            
            const history = symData.price_history;
            const latestPrice = history && history.length > 0 ? history[history.length - 1].close : 0;
            const indicatorsList = indData.indicators;
            const latestRsi = indicatorsList && indicatorsList.length > 0 ? indicatorsList[indicatorsList.length - 1].rsi : null;

            return {
              symbol: sym,
              name: symData.info ? symData.info.name : sym,
              sector: symData.info ? symData.info.sector : "N/A",
              market_cap: symData.info ? symData.info.market_cap : 0,
              pe_ratio: symData.info ? symData.info.pe_ratio : null,
              price: latestPrice,
              rsi: latestRsi,
              orb_signal: indData.orb_signal ? indData.orb_signal.signal : "NO DATA"
            };
          }
        } catch (err) {
          console.warn(`Failed to fetch screener data for ${sym}`, err);
        }
        return null;
      });

      const results = await Promise.all(fetchPromises);
      const loadedTickers = results.filter((r): r is TickerScreenData => r !== null);

      if (loadedTickers.length === 0) {
        throw new Error("No data fetched");
      }
      setTickers(loadedTickers);
      setUsingMock(false);
    } catch {
      // Fallback mock portfolio data
      const baseMock = [
        { symbol: "AAPL", name: "Apple Inc.", sector: "Technology", market_cap: 3450000000000, pe_ratio: 32.4, price: 226.85, rsi: 63.4, orb_signal: "BEARISH_BREAKOUT" },
        { symbol: "TSLA", name: "Tesla Inc.", sector: "Consumer Discretionary", market_cap: 820000000000, pe_ratio: 68.2, price: 248.50, rsi: 74.2, orb_signal: "BULLISH_BREAKOUT" },
        { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology", market_cap: 3200000000000, pe_ratio: 35.8, price: 418.20, rsi: 48.6, orb_signal: "NO_BREAKOUT" },
        { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer Discretionary", market_cap: 1950000000000, pe_ratio: 42.1, price: 184.10, rsi: 52.1, orb_signal: "NO_BREAKOUT" },
        { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Technology", market_cap: 2900000000000, pe_ratio: 65.4, price: 118.30, rsi: 72.8, orb_signal: "BULLISH_BREAKOUT" },
        { symbol: "JPM", name: "JPMorgan Chase & Co.", sector: "Financials", market_cap: 580000000000, pe_ratio: 12.2, price: 202.40, rsi: 41.5, orb_signal: "NO_BREAKOUT" },
        { symbol: "XOM", name: "Exxon Mobil Corp.", sector: "Energy", market_cap: 490000000000, pe_ratio: 14.1, price: 115.60, rsi: 58.3, orb_signal: "BULLISH_BREAKOUT" },
        { symbol: "RELIANCE.NS", name: "Reliance Industries Ltd.", sector: "Energy", market_cap: 220000000000, pe_ratio: 18.4, price: 2435.50, rsi: 51.4, orb_signal: "NO_BREAKOUT" },
        { symbol: "TCS.NS", name: "Tata Consultancy Services Ltd.", sector: "Technology", market_cap: 165000000000, pe_ratio: 28.6, price: 3840.20, rsi: 61.2, orb_signal: "BULLISH_BREAKOUT" },
        { symbol: "INFY.NS", name: "Infosys Ltd.", sector: "Technology", market_cap: 85000000000, pe_ratio: 24.5, price: 1542.80, rsi: 44.8, orb_signal: "NO_BREAKOUT" }
      ];

      const currentLocal = symbolsOverride !== undefined ? symbolsOverride : localSymbols;
      const mergedMock = [...baseMock];

      for (const customSym of currentLocal) {
        if (!mergedMock.some(m => m.symbol === customSym)) {
          mergedMock.push({
            symbol: customSym,
            name: `${customSym} Corporation`,
            sector: "N/A",
            market_cap: 150000000000,
            pe_ratio: 22.4,
            price: 150.00,
            rsi: 50.0,
            orb_signal: "NO_BREAKOUT"
          });
        }
      }

      setTickers(mergedMock);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let savedList: string[] = [];
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("screener_watch_list");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            savedList = parsed;
            setLocalSymbols(parsed);
          }
        } catch (e) {
          console.warn("Failed to parse local watch list:", e);
        }
      }
    }
    loadScreenerData(savedList);
  }, []);

  const handleFetchAndAddTicker = async (targetSymbol: string) => {
    if (!targetSymbol.trim()) return;
    setSyncing(true);
    try {
      const symbolUpper = targetSymbol.trim().toUpperCase();
      
      // Try to trigger live sync on backend
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/ticker/${symbolUpper}`);
        if (!res.ok) {
          throw new Error(`Failed to sync ticker. Status ${res.status}`);
        }
      } catch (backendErr) {
        console.warn("Backend sync failed during add, using offline mock fallback:", backendErr);
      }

      // Add to local watch list
      const updatedLocal = Array.from(new Set([...localSymbols, symbolUpper]));
      setLocalSymbols(updatedLocal);
      if (typeof window !== "undefined") {
        localStorage.setItem("screener_watch_list", JSON.stringify(updatedLocal));
      }

      // Refresh layout immediately using updated local array
      await loadScreenerData(updatedLocal);
      setSearchTerm(""); // clear search filter
    } catch (err: any) {
      alert(`Error adding ticker: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Unique list of sectors for filter dropdown
  const availableSectors = useMemo(() => {
    const sectors = new Set(tickers.map((t) => t.sector || "N/A"));
    return ["ALL", ...Array.from(sectors)];
  }, [tickers]);

  // Handle header sorting click
  const requestSort = (field: keyof TickerScreenData) => {
    let direction: "asc" | "desc" = "asc";
    if (sortField === field && sortDirection === "asc") {
      direction = "desc";
    }
    setSortField(field);
    setSortDirection(direction);
  };

  // Filter and sort tickers dynamically
  const filteredAndSortedTickers = useMemo(() => {
    const term = (searchTerm || "").toLowerCase().trim();
    return tickers
      .filter((t) => {
        if (!t) return false;
        const symbolStr = (t.symbol || "").toLowerCase();
        const nameStr = (t.name || "").toLowerCase();
        const sectorStr = t.sector || "N/A";
        
        const matchesSearch = symbolStr.includes(term) || nameStr.includes(term);
        const matchesSector = sectorFilter === "ALL" || sectorStr === sectorFilter;
        return matchesSearch && matchesSector;
      })
      .sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];

        if (aVal === null || aVal === undefined) return sortDirection === "asc" ? 1 : -1;
        if (bVal === null || bVal === undefined) return sortDirection === "asc" ? -1 : 1;

        if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
  }, [tickers, searchTerm, sectorFilter, sortField, sortDirection]);

  return (
    <div className="p-8 space-y-8 flex-1">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Stock Screener</h2>
        <p className="text-sm text-gray-500 font-mono">PORTFOLIO ACCUMULATED COMPARISON ENGINE</p>
      </div>

      {/* Connection Notice if displaying Mock data */}
      {usingMock && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl p-4 flex items-start space-x-3 text-xs">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Displaying Offline Demo Data:</span> Start your FastAPI backend and sync tickers (`AAPL`, `TSLA`, `MSFT`, `AMZN`, `NVDA`) to pull direct database comparison records.
          </div>
        </div>
      )}

      {/* Filter and Search Bar Row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#0c1020]/45 border border-[rgba(255,255,255,0.06)] rounded-2xl p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto">
          {/* Local filter input */}
          <div className="flex items-center w-full sm:w-64 relative">
            <input
              type="text"
              placeholder="Filter listed stocks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-black/35 border border-[rgba(255,255,255,0.06)] focus:border-blue-500 focus:outline-none rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-gray-500 font-mono"
            />
            <Search className="absolute left-3.5 top-3.5 text-gray-500 w-4 h-4" />
          </div>

        {/* Sector Filter */}
        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-gray-500 shrink-0" />
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="bg-black/35 border border-[rgba(255,255,255,0.06)] focus:border-blue-500 focus:outline-none rounded-xl px-4 py-2.5 text-xs text-white font-mono cursor-pointer"
          >
            {availableSectors.map((sector) => (
              <option key={sector} value={sector}>
                {sector === "ALL" ? "All Sectors" : sector}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Live Search & Add Dropdown */}
      <div className="w-full sm:w-72">
        <SearchAutocomplete
          placeholder="Search & Add Ticker..."
          clearOnSelect={true}
          onSelect={(sym) => handleFetchAndAddTicker(sym)}
        />
      </div>
    </div>

      {/* Comparison Table */}
      <div className="glass-panel overflow-hidden border border-[rgba(255,255,255,0.06)]">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center space-y-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-500 font-mono">Running Metrics Evaluation...</span>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)] bg-white/[0.01]">
                  <th 
                    onClick={() => requestSort("symbol")}
                    className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center">
                      Symbol
                      <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-gray-600" />
                    </div>
                  </th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono">Company Name</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono">Sector</th>
                  <th 
                    onClick={() => requestSort("price")}
                    className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center">
                      Price
                      <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-gray-600" />
                    </div>
                  </th>
                  <th 
                    onClick={() => requestSort("market_cap")}
                    className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center">
                      Market Cap
                      <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-gray-600" />
                    </div>
                  </th>
                  <th 
                    onClick={() => requestSort("pe_ratio")}
                    className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center">
                      P/E
                      <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-gray-600" />
                    </div>
                  </th>
                  <th 
                    onClick={() => requestSort("rsi")}
                    className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center">
                      RSI (14)
                      <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-gray-600" />
                    </div>
                  </th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono">ORB Signal</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400 font-mono text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {filteredAndSortedTickers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center">
                      <div className="flex flex-col items-center justify-center space-y-3 py-6">
                        <span className="text-xs text-gray-500 font-mono">
                          No assets found matching &ldquo;{searchTerm}&rdquo;
                        </span>
                        
                        {searchTerm.trim().length > 0 && (
                          <button
                            onClick={() => handleFetchAndAddTicker(searchTerm)}
                            disabled={syncing}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded-xl text-xs font-semibold tracking-wider transition-all duration-200 cursor-pointer disabled:cursor-not-allowed flex items-center space-x-2 shadow-lg shadow-blue-500/25"
                          >
                            {syncing ? (
                              <>
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                                <span>Syncing {searchTerm.toUpperCase()}...</span>
                              </>
                            ) : (
                              <span>Fetch & Add {searchTerm.toUpperCase()} Live</span>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedTickers.map((row) => (
                    <tr key={row.symbol} className="hover:bg-white/[0.01] transition-colors">
                      <td className="p-4 text-sm font-mono font-bold text-white tracking-wide">{row.symbol}</td>
                      <td className="p-4 text-xs font-medium text-slate-300">{row.name}</td>
                      <td className="p-4 text-xs text-slate-400">{row.sector}</td>
                      <td className="p-4 text-sm font-mono font-semibold text-white">${row.price.toFixed(2)}</td>
                      <td className="p-4 text-sm font-mono text-slate-300">
                        ${(row.market_cap / 1e9).toFixed(1)}B
                      </td>
                      <td className="p-4 text-sm font-mono text-slate-300">
                        {row.pe_ratio ? row.pe_ratio.toFixed(1) : "-"}
                      </td>
                      <td className="p-4 text-sm font-mono">
                        <span className={`${
                          row.rsi && row.rsi > 70 ? "text-rose-400 font-bold" :
                          row.rsi && row.rsi < 30 ? "text-emerald-400 font-bold" : "text-slate-300"
                        }`}>
                          {row.rsi ? row.rsi.toFixed(1) : "-"}
                        </span>
                      </td>
                      <td className="p-4 text-xs font-mono font-semibold">
                        <span className={`inline-block px-2 py-0.5 rounded-md border ${
                          row.orb_signal === "BULLISH_BREAKOUT" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          row.orb_signal === "BEARISH_BREAKOUT" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                          "bg-slate-500/10 text-slate-400 border-slate-500/20"
                        }`}>
                          {row.orb_signal.replace("_", " ")}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <Link
                          href={`/ticker/${row.symbol}`}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-blue-600/10 border border-blue-500/20 hover:bg-blue-600 text-blue-400 hover:text-white text-[11px] font-semibold tracking-wide transition-all duration-200"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Terminal</span>
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
