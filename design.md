# UI/UX Design System

## 1. Design Philosophy
Market Rover aims to evoke the feeling of a professional Bloomberg terminal merged with the sleek, modern aesthetics of a high-end fintech application. It prioritizes data density without feeling cluttered, utilizing a premium "dark mode first" aesthetic.

## 2. Global Layout Structure
- **Unified Navigation (TopBar):** All primary navigation, global actions (Theme Switcher, Live Clock), and page titles reside in a sticky `TopBar` component. This eliminates the need for sidebars, reclaiming horizontal space on both desktop and mobile screens.
- **Responsive Horizons:** Navigation links in the `TopBar` utilize horizontal scrolling on smaller viewports to prevent cramped UI layouts.
- **Full-Width Data:** The main content area utilizes full width for tables (Screener) and constrained max-widths (`max-w-7xl`) for dashboard layouts (Portfolio) to maintain readability.

## 3. Color Palette & Theming
The application supports multiple themes (Dark, Deep Blue, Light) governed by CSS variables defined in `index.css`.

**Semantic Tokens:**
- `--bg-primary`: Deep background for the main canvas.
- `--bg-secondary`: Slightly elevated background for the TopBar and main structural elements.
- `--bg-tertiary`: Soft backgrounds for inputs and minor UI elements.
- `--bg-elevated`: High-contrast backgrounds for dropdowns, tooltips, and floating cards.
- `--text-primary`: High-contrast text for headers and primary data.
- `--text-secondary`: Muted text for labels and sub-headers.
- `--accent-primary`: The primary brand color (vibrant blue/indigo) used for active states, primary buttons, and highlights.
- `--border-primary`: Subtle borders separating distinct visual components.

**Feedback Colors:**
- **Positive:** Emerald green (`text-positive`, `bg-positive`) for gains and bullish trends.
- **Negative:** Crimson red (`text-negative`, `bg-negative`) for losses and bearish trends.

## 4. Component Anatomy
### 4.1. Cards
Cards are used to display distinct groupings of data (e.g., Portfolio Summary Cards, AI Narratives). They feature rounded corners (`rounded-xl` or `rounded-2xl`), subtle borders (`border-border-primary`), and a background of `bg-bg-secondary`.

### 4.2. Micro-Animations
Interactive elements utilize subtle transitions to feel responsive:
- Buttons have a slight hover state (`hover:bg-bg-tertiary`).
- Live price updates feature "flash" animations (briefly glowing green or red) to draw the user's eye to changing data.
- "Live" badges utilize a pinging dot animation to signify active connections.

### 4.3. Typography
- **Primary Font:** Geist Sans for clean, legible body text and UI elements.
- **Monospace Font:** Geist Mono for all numerical data, stock tickers, and timestamps to ensure tabular alignment and a technical aesthetic.
