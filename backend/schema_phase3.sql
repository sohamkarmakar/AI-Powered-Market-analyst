-- Phase 3 Schema: Caching Tables for AI Analysis

-- 1. TICKER ANALYSIS CACHE TABLE
CREATE TABLE IF NOT EXISTS ticker_analysis (
    ticker_symbol TEXT PRIMARY KEY REFERENCES tickers(symbol) ON DELETE CASCADE,
    news_summary JSONB NOT NULL,
    research_note JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. MARKET PULSE CACHE TABLE
CREATE TABLE IF NOT EXISTS market_pulse (
    id BIGSERIAL PRIMARY KEY,
    pulse_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create index on created_at for fast retrieval of the latest market pulse
CREATE INDEX IF NOT EXISTS market_pulse_created_at_idx ON market_pulse (created_at DESC);

-- Disable Row Level Security (RLS) so the API can read/write using the anon public key
ALTER TABLE ticker_analysis DISABLE ROW LEVEL SECURITY;
ALTER TABLE market_pulse DISABLE ROW LEVEL SECURITY;
