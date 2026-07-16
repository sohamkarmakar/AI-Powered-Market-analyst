# Project Rules & Conventions

## 1. Frontend Standards (Next.js)
- **Client Components:** Any component utilizing React hooks (`useState`, `useEffect`, `useContext`) MUST begin with the `"use client";` directive at the top of the file to prevent server-side compilation errors.
- **Component Architecture:** Reusable UI elements should be modularized inside `frontend/src/components`. Pages are strictly routed via `frontend/src/app`.
- **State Management:** Use React Context for global UI states (e.g., `ThemeContext.tsx`).
- **Styling:** Adhere strictly to the Tailwind CSS utility classes defined in the global theme. Avoid hardcoding colors (e.g., `bg-blue-500`); instead, use semantic variables (e.g., `bg-accent-primary`, `text-text-primary`).

## 2. Backend Standards (FastAPI)
- **Router Segregation:** Define endpoints logically in separate router files within `backend/app/routers/` (e.g., `market.py`, `portfolio.py`, `ai.py`) and include them in `main.py`.
- **Data Validation:** All incoming payloads and outgoing responses must be strictly typed using Pydantic schemas.
- **Error Handling:** Use `HTTPException` appropriately for failed API calls, missing DB records, or invalid CSV uploads. Do not return raw stack traces to the client.
- **AI Integration:** When interacting with the Gemini API, enforce structured JSON output by utilizing the `response_schema` parameter with a Pydantic model to guarantee consistent parsing by the frontend.

## 3. Database Conventions (Supabase)
- **Migrations:** All schema changes must be documented in raw SQL files (e.g., `schema_portfolio.sql`) and manually applied to the Supabase SQL editor.
- **RLS (Row Level Security):** Currently, RLS is disabled as the application operates without a user authentication layer. If auth is introduced, RLS must be enabled with strict user-bound policies.

## 4. General Code Quality
- **Formatting:** Ensure clean, readable code with descriptive variable names.
- **Comments:** Use inline comments to explain complex logic (e.g., financial calculations, pandas merging logic). Avoid over-commenting obvious structural code.
- **Types:** Embrace TypeScript for the frontend to prevent runtime errors and provide robust autocomplete for developer experience.
