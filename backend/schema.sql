-- Schema definition for AI Powered Market Analyst
-- You can copy-paste and run these statements in your Supabase SQL Editor.

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TICKERS TABLE
CREATE TABLE IF NOT EXISTS tickers (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sector TEXT,
    industry TEXT,
    market_cap BIGINT,
    pe_ratio NUMERIC,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index on symbol (already primary key, but good to note)
CREATE UNIQUE INDEX IF NOT EXISTS tickers_symbol_idx ON tickers (symbol);

-- 2. PRICE HISTORY TABLE
CREATE TABLE IF NOT EXISTS price_history (
    id BIGSERIAL PRIMARY KEY,
    ticker_symbol TEXT NOT NULL REFERENCES tickers(symbol) ON DELETE CASCADE,
    date DATE NOT NULL,
    open NUMERIC NOT NULL,
    high NUMERIC NOT NULL,
    low NUMERIC NOT NULL,
    close NUMERIC NOT NULL,
    volume BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (ticker_symbol, date)
);

-- Index for fast retrieval of historical pricing charts
CREATE INDEX IF NOT EXISTS price_history_ticker_date_idx ON price_history (ticker_symbol, date DESC);

-- 3. NEWS TABLE
CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY, -- yfinance uuid or similar external id
    ticker_symbol TEXT NOT NULL REFERENCES tickers(symbol) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source TEXT,
    url TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for sorting news by published time
CREATE INDEX IF NOT EXISTS news_ticker_published_idx ON news (ticker_symbol, published_at DESC);

-- Create a helper function to automatically update `updated_at` column
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for tickers table update
DROP TRIGGER IF EXISTS update_tickers_modtime ON tickers;
CREATE TRIGGER update_tickers_modtime
    BEFORE UPDATE ON tickers
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
-- Disable Row Level Security (RLS) so the API can read/write using the anon public key
ALTER TABLE tickers DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE news DISABLE ROW LEVEL SECURITY;
