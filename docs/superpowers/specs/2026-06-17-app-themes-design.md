# spear: app themes (Matrix default + Dark + Light)

**Date:** 2026-06-17
**Target version:** v0.1.26 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

Add two new themes — a friendly **Dark (navy/sky-blue)** and a **Light** — alongside the existing
**Matrix** theme (the default). A header selector switches the whole app (all tabs). The choice is
**stored in `~/.spear/config.json`** (synced across CLI/desktop/browser, like `maxLanes`), with
`localStorage` as a fast render-cache to avoid a theme flash on launch.

## A. Theming mechanism

The app styles everything through CSS variables (`--bg`, `--green` accent [used 53×], `--text`,
`--glow`, …) plus Matrix-only effects (digital rain canvas, scanline overlay, neon glow). Theming:

- **Matrix stays the default `:root`** palette (unchanged values).
- Add `[data-theme="dark"]` and `[data-theme="light"]` blocks that override the variables. A
  `data-theme` attribute on `<html>` switches the app; every tab/component inherits automatically.
- **New vars** so the accent + a couple of bespoke backgrounds theme cleanly:
  - `--accent-rgb` — the accent as `r, g, b` (so accent-tinted `rgba()` can theme). Replace the ~20
    hardcoded `rgba(0, 255, 65, X)` spots (progress bars, `.confirm-extract`, `.dup-warn`, image
    thumb, etc.) with `rgba(var(--accent-rgb), X)`. For Matrix `--accent-rgb: 0, 255, 65`, so its look
    is unchanged.
  - `--header-bg` — replaces `header.bar`'s hardcoded `linear-gradient(180deg, rgba(0,30,8,.5), transparent)`.
  - `--narrative-bg` — replaces the Today narrative box's `rgba(0,25,6,.5)`.
  - A few hardcoded green borders (`#1c3a24`) → `var(--border)`.
- **Non-Matrix themes drop the Matrix flourishes:** no digital rain (not rendered), no scanline
  overlay (`body::after` hidden), and `--glow` becomes a soft drop-shadow.

## B. Palettes (full variable sets)

**Matrix** — `:root`, unchanged, plus `--accent-rgb: 0, 255, 65;` and:
`--header-bg: linear-gradient(180deg, rgba(0,30,8,0.5), transparent);`
`--narrative-bg: rgba(0,25,6,0.5);`

**Dark** — `[data-theme="dark"]`:
```
--bg: #0f172a; --panel: #16213b; --panel-solid: #1b2740;
--green: #60a5fa; --accent-rgb: 96, 165, 250; --green-dim: #3b6ea5;
--text: #e5edf7; --text-dim: #93a4bf;
--crit: #fb7185; --high: #fbbf24; --med: #60a5fa; --low: #94a3b8; --cyan: #38bdf8;
--border: rgba(96, 165, 250, 0.22);
--glow: 0 2px 10px rgba(0, 0, 0, 0.5);
--header-bg: linear-gradient(180deg, rgba(96,165,250,0.06), transparent);
--narrative-bg: rgba(96, 165, 250, 0.06);
```

**Light** — `[data-theme="light"]`:
```
--bg: #f8fafc; --panel: #ffffff; --panel-solid: #ffffff;
--green: #2563eb; --accent-rgb: 37, 99, 235; --green-dim: #93b0e8;
--text: #0f1b2d; --text-dim: #5b6678;
--crit: #e11d48; --high: #d97706; --med: #2563eb; --low: #94a3b8; --cyan: #0284c7;
--border: #e3e8ef;
--glow: 0 1px 4px rgba(15, 23, 42, 0.12);
--header-bg: linear-gradient(180deg, rgba(37,99,235,0.05), transparent);
--narrative-bg: rgba(37, 99, 235, 0.05);
```

## C. Persistence (config + cache)

- `SpearConfig.theme: "matrix" | "dark" | "light"` (default `"matrix"`) in `src/config/index.ts`.
- `GET /api/config` → add `theme`: `{ maxLanes, theme }`.
- `POST /api/config/theme` `{ theme }` → validate against the three names; `cfg.theme = theme`;
  `saveConfig(cfg)`; return `{ theme }`. (No re-plan / broadcast needed.)
- `src/util/theme.ts`: `export const THEMES = ["matrix","dark","light"] as const; export type Theme;`
  and `coerceTheme(value: unknown): Theme` (returns the value if valid, else `"matrix"`). Pure +
  unit-tested.

## D. Switcher (web)

- `src/web/api.ts`: `fetchConfig()` returns `{ maxLanes, theme }`; add `setTheme(theme): Promise<{theme}>`.
- `src/web/App.tsx`:
  - `theme` state initialized from `localStorage["spear-theme"]` via `coerceTheme` (fast, no flash).
  - On mount, `fetchConfig()` reconciles `theme` from config (the synced source of truth).
  - A `useEffect` applies `document.documentElement.setAttribute("data-theme", theme)` and writes
    `localStorage["spear-theme"]` whenever `theme` changes.
  - `changeTheme(t)`: optimistic `setTheme(t)` state + `void setTheme(t)` (api) to persist.
  - Header: a compact `<select>` (Matrix / Dark / Light) next to the lanes control.
  - Render `<Rain />` only when `theme === "matrix"`.

## E. Testing

- `src/util/theme.test.ts` — `coerceTheme` returns valid themes; falls back to `"matrix"` for
  unknown/empty/undefined.
- The CSS palette + switching is visual — verified live in the app (each tab in each theme).

## Cross-cutting

- No new runtime dependencies.
- Applies to **all tabs** automatically (global CSS variables on `<html>`).
- **Docs:** `## [0.1.26]` CHANGELOG entry. **Release** v0.1.26 + local refresh.

## Rejected alternatives

- **localStorage-only** — rejected; the user wants the theme synced across the CLI/desktop, so config
  is the source of truth (localStorage is only a render cache).
- **Renaming `--green` → `--accent`** across all CSS — rejected; a 53-site churn for no functional gain;
  overriding the variable's value per theme is enough.
- **Per-component theme props** — rejected; CSS variables on `<html>` theme everything for free.
