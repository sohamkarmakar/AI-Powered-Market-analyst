-- ============================================================
-- Portfolio Feature Schema — AI Powered Market Analyst
-- Run this in your Supabase SQL Editor AFTER the base schema.sql
-- ============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- 1. PORTFOLIOS TABLE
--    Represents a named collection of holdings (e.g. "Zerodha")
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    broker_source TEXT,          -- 'zerodha' | 'groww' | 'dhan' | 'manual' | 'mixed'
    created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Trigger: auto-update updated_at
DROP TRIGGER IF EXISTS update_portfolios_modtime ON portfolios;
CREATE TRIGGER update_portfolios_modtime
    BEFORE UPDATE ON portfolios
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- ─────────────────────────────────────────────────────────────
-- 2. HOLDINGS TABLE
--    One row per stock position inside a portfolio.
--    Live fields (current price, P&L, sector) are NOT stored —
--    they're computed at view-time from Yahoo Finance.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holdings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE NOT NULL,
    symbol       TEXT NOT NULL,      -- Yahoo ticker, e.g. 'RELIANCE.NS'
    isin         TEXT,               -- Optional — used for resolution
    company_name TEXT,               -- Display name
    quantity     NUMERIC NOT NULL,
    avg_price    NUMERIC NOT NULL,
    buy_date     DATE,               -- Nullable — used only for XIRR
    entry_source TEXT NOT NULL DEFAULT 'manual',  -- 'upload' | 'manual'
    broker_source TEXT,              -- Which broker this row came from
    created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast lookup by portfolio
CREATE INDEX IF NOT EXISTS holdings_portfolio_id_idx ON holdings (portfolio_id);

-- Trigger: auto-update updated_at
DROP TRIGGER IF EXISTS update_holdings_modtime ON holdings;
CREATE TRIGGER update_holdings_modtime
    BEFORE UPDATE ON holdings
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- ─────────────────────────────────────────────────────────────
-- 3. ISIN → YAHOO SYMBOL MAP
--    Static reference table — seeded once from NSE data.
--    Not user-scoped. Shared across all portfolios.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS isin_symbol_map (
    isin         TEXT PRIMARY KEY,
    yahoo_symbol TEXT NOT NULL,
    company_name TEXT NOT NULL,
    updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- 4. PORTFOLIO AI NARRATIVES (cache)
--    Same pattern as market_pulse — one row per generate call.
--    Frontend fetches the latest row for the portfolio.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_ai_narratives (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE NOT NULL,
    narrative    JSONB NOT NULL,   -- { summary, key_observations, warnings, top_picks, laggards }
    generated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast retrieval of the latest narrative per portfolio
CREATE INDEX IF NOT EXISTS portfolio_narratives_portfolio_id_idx
    ON portfolio_ai_narratives (portfolio_id, generated_at DESC);

-- ─────────────────────────────────────────────────────────────
-- RLS: Disable (matching existing app pattern — no auth layer)
-- All tables use the anon key via the app server.
-- Enable RLS + per-user policies when auth is added later.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE portfolios              DISABLE ROW LEVEL SECURITY;
ALTER TABLE holdings                DISABLE ROW LEVEL SECURITY;
ALTER TABLE isin_symbol_map         DISABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_ai_narratives DISABLE ROW LEVEL SECURITY;
