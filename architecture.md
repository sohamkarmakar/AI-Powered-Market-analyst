# Technical Architecture Document

## 1. High-Level System Architecture
Market Rover is a decoupled, modern web application consisting of a React-based frontend and a Python-based RESTful API backend, leveraging an SQL database for persistence and third-party APIs for real-time market data and artificial intelligence.

## 2. Technology Stack
### 2.1. Frontend
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS (with arbitrary variables for theming)
- **Icons:** Lucide React
- **Data Visualization:** Recharts (SVG-based charting)

### 2.2. Backend
- **Framework:** FastAPI (Python)
- **Server:** Uvicorn (ASGI)
- **Data Processing:** Pandas (for portfolio aggregation and calculations)
- **Market Data Source:** `yfinance` (Yahoo Finance API wrapper)
- **AI Integration:** Google Generative AI (`google-generativeai` SDK using `gemini-3.1-flash-lite`)

### 2.3. Database
- **Provider:** Supabase (PostgreSQL)
- **Client:** `supabase-py`

## 3. Data Flow & Communication
1. **Client Request:** The Next.js frontend sends REST HTTP requests (`GET`, `POST`, `DELETE`) to the FastAPI backend running on port 8000.
2. **Backend Processing:**
   - **Market Data:** For live ticker prices, the backend queries Yahoo Finance synchronously (or asynchronously via background tasks).
   - **Persistence:** For portfolio creations or updates, the backend communicates with the Supabase PostgreSQL database.
   - **AI Narratives:** When the frontend requests an AI insight (e.g., Portfolio Pulse, Research Note), the backend constructs a structured prompt using recent market data and queries the Google Gemini API.
3. **Response:** The backend returns strongly-typed JSON (validated via Pydantic models) to the frontend, which React components then map into visual states.

## 4. Database Schema (Supabase)
The application relies on four primary tables defined in `schema_portfolio.sql`:

1. **`portfolios`**: Stores the high-level portfolio metadata.
   - `id` (UUID, Primary Key)
   - `name` (String)
   - `broker_source` (String, nullable)
   - `created_at` (Timestamp)

2. **`holdings`**: Stores the individual equity holdings tied to a portfolio.
   - `id` (UUID, Primary Key)
   - `portfolio_id` (UUID, Foreign Key)
   - `symbol` (String)
   - `quantity` (Numeric)
   - `avg_cost` (Numeric)

3. **`isin_symbol_map`**: A mapping table to translate broker ISIN codes (e.g., from CSV uploads) to tradable Yahoo Finance symbols.
   - `isin` (String, Primary Key)
   - `symbol` (String)

4. **`portfolio_ai_narratives`**: Caches the AI-generated analysis for a specific portfolio to avoid redundant API calls to Gemini.
   - `id` (UUID, Primary Key)
   - `portfolio_id` (UUID, Foreign Key)
   - `narrative_json` (JSONB)
   - `generated_at` (Timestamp)
