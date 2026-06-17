# spear v0.1.26 — app themes (Matrix / Dark / Light)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a friendly Dark (navy/sky-blue) and Light theme alongside the default Matrix theme, switchable from the header across all tabs, persisted in `~/.spear/config.json` (synced) with a localStorage render-cache.

**Architecture:** Theme = a `data-theme` attribute on `<html>` that overrides the existing CSS variables; Matrix is the default `:root`. The accent and a couple of bespoke backgrounds are made theme-aware via new vars. Theme is stored in config (server) and applied client-side.

**Tech Stack:** React/Vite, CSS custom properties, Fastify, vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-app-themes-design.md`

---

## File Structure
**New:** `src/util/theme.ts` (+ test).
**Modified:** `src/config/index.ts`, `src/server/app.ts`, `src/web/api.ts`, `src/web/App.tsx`,
`src/web/styles.css`, `CHANGELOG.md`, `package.json`.

---

## Task 1: `coerceTheme` util

**Files:** Create `src/util/theme.ts`, `src/util/theme.test.ts`

- [ ] **Step 1: Write the failing test** — `src/util/theme.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { coerceTheme, THEMES } from "./theme.js";

describe("coerceTheme", () => {
  it("keeps valid themes", () => {
    for (const t of THEMES) expect(coerceTheme(t)).toBe(t);
  });
  it("falls back to matrix for unknown/empty values", () => {
    expect(coerceTheme("neon")).toBe("matrix");
    expect(coerceTheme(null)).toBe("matrix");
    expect(coerceTheme(undefined)).toBe("matrix");
    expect(coerceTheme("")).toBe("matrix");
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/util/theme.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement** — `src/util/theme.ts`:
```ts
export const THEMES = ["matrix", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** Validate a stored/inbound theme value, defaulting to "matrix". */
export function coerceTheme(value: unknown): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "matrix";
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/util/theme.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/util/theme.ts src/util/theme.test.ts
git commit -m "feat(util): coerceTheme + THEMES list"
```

---

## Task 2: Config theme + routes

**Files:** Modify `src/config/index.ts`, `src/server/app.ts`

- [ ] **Step 1: Config field.** In `src/config/index.ts`, add to the `SpearConfig` interface (after `maxLanes`):
```ts
  /** Active UI theme. */
  theme: "matrix" | "dark" | "light";
```
In `DEFAULT_CONFIG`, add (after `maxLanes: 6,`):
```ts
  theme: "matrix",
```
(`mergeConfig` does a top-level spread, so older config files without `theme` fall back to the default.)

- [ ] **Step 2: Routes.** In `src/server/app.ts`:

Add the import near the other util imports:
```ts
import { coerceTheme, THEMES } from "../util/theme.js";
```

Change `GET /api/config` to include the theme — replace:
```ts
  app.get("/api/config", async () => ({ maxLanes: cfg.maxLanes }));
```
with:
```ts
  app.get("/api/config", async () => ({ maxLanes: cfg.maxLanes, theme: cfg.theme }));
```

Add a theme route right after the `POST /api/config/lanes` handler:
```ts
  app.post("/api/config/theme", async (req, reply) => {
    const body = (req.body ?? {}) as { theme?: string };
    if (!THEMES.includes(body.theme as never)) {
      reply.code(400);
      return { error: "invalid theme" };
    }
    cfg.theme = coerceTheme(body.theme);
    saveConfig(cfg);
    return { theme: cfg.theme };
  });
```

- [ ] **Step 3: Verify** — `npm run typecheck && npx vitest run` → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/config/index.ts src/server/app.ts
git commit -m "feat(config): persist theme + /api/config/theme route"
```

---

## Task 3: Web API — theme

**Files:** Modify `src/web/api.ts`

- [ ] **Step 1: Implement.** In `src/web/api.ts`:

Change `fetchConfig`'s return type — replace:
```ts
export async function fetchConfig(): Promise<{ maxLanes: number }> {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}
```
with:
```ts
export async function fetchConfig(): Promise<{ maxLanes: number; theme: string }> {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

/** Persist the UI theme to config (synced across clients). */
export async function setTheme(theme: string): Promise<{ theme: string }> {
  const r = await fetch("/api/config/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  });
  if (!r.ok) throw new Error(`theme ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Verify** — `npm run build:web` → no type errors.

- [ ] **Step 3: Commit**
```bash
git add src/web/api.ts
git commit -m "feat(web): fetchConfig theme + setTheme client"
```

---

## Task 4: CSS — theme variable blocks + accent-aware conversions

**Files:** Modify `src/web/styles.css`

- [ ] **Step 1: Add the new vars to `:root`.** In `src/web/styles.css`, in the `:root { … }` block, add after the `--mono:` line (keep all existing vars):
```css
  --accent-rgb: 0, 255, 65;
  --header-bg: linear-gradient(180deg, rgba(0, 30, 8, 0.5), transparent);
  --panel-tint: rgba(0, 25, 6, 0.5);
```

- [ ] **Step 2: Point the bespoke backgrounds + border at vars.**

`header.bar`'s background — replace:
```css
  background: linear-gradient(180deg, rgba(0, 30, 8, 0.5), transparent);
```
with:
```css
  background: var(--header-bg);
```

The `.confirm-title, .confirm-details` border — replace `border: 1px solid #1c3a24;` with:
```css
  border: 1px solid var(--border);
```

- [ ] **Step 3: Bulk-convert the accent + tint colors to vars.** Run these from the repo root:
```bash
# accent green → themeable accent (covers ~24 spots incl. the --border/--glow/drop-shadow defs)
sed -i '' 's/rgba(0, 255, 65,/rgba(var(--accent-rgb),/g' src/web/styles.css
# the bespoke dark panel tint (Today narrative + the goals panel) → var
sed -i '' 's/rgba(0, 25, 6, 0.5)/var(--panel-tint)/g' src/web/styles.css
echo "remaining literal accent greens (expect 0): $(grep -c 'rgba(0, 255, 65,' src/web/styles.css)"
```
Expected: `remaining literal accent greens (expect 0): 0`.

- [ ] **Step 4: Append the Dark + Light theme blocks and effect toggles.** Append to the end of `src/web/styles.css`:
```css

/* ===== Themes (Matrix = default :root) ===== */
[data-theme="dark"] {
  --bg: #0f172a;
  --panel: #16213b;
  --panel-solid: #1b2740;
  --green: #60a5fa;
  --accent-rgb: 96, 165, 250;
  --green-dim: #3b6ea5;
  --text: #e5edf7;
  --text-dim: #93a4bf;
  --crit: #fb7185;
  --high: #fbbf24;
  --med: #60a5fa;
  --low: #94a3b8;
  --cyan: #38bdf8;
  --border: rgba(96, 165, 250, 0.22);
  --glow: 0 2px 10px rgba(0, 0, 0, 0.5);
  --header-bg: linear-gradient(180deg, rgba(96, 165, 250, 0.06), transparent);
  --panel-tint: rgba(96, 165, 250, 0.06);
}
[data-theme="light"] {
  --bg: #f8fafc;
  --panel: #ffffff;
  --panel-solid: #ffffff;
  --green: #2563eb;
  --accent-rgb: 37, 99, 235;
  --green-dim: #93b0e8;
  --text: #0f1b2d;
  --text-dim: #5b6678;
  --crit: #e11d48;
  --high: #d97706;
  --med: #2563eb;
  --low: #94a3b8;
  --cyan: #0284c7;
  --border: #e3e8ef;
  --glow: 0 1px 4px rgba(15, 23, 42, 0.12);
  --header-bg: linear-gradient(180deg, rgba(37, 99, 235, 0.05), transparent);
  --panel-tint: rgba(37, 99, 235, 0.05);
}
/* Matrix-only flourishes off for the calmer themes (rain is also not rendered). */
[data-theme="dark"] body::after,
[data-theme="light"] body::after { display: none; }
```

- [ ] **Step 5: Verify build + spot-check.** Run: `npm run build:web` — Expected: builds clean.

- [ ] **Step 6: Commit**
```bash
git add src/web/styles.css
git commit -m "feat(web): Dark + Light theme variable blocks; accent-aware vars"
```

---

## Task 5: App — theme state, apply, switcher, conditional rain

**Files:** Modify `src/web/App.tsx`

- [ ] **Step 1: Imports + state.** In `src/web/App.tsx`:

Add to the api import the `setTheme` value and update `fetchConfig` usage (already imported). Add:
```ts
import { coerceTheme, THEMES, type Theme } from "../util/theme";
import { setTheme as persistTheme } from "./api";
```
(If `setMaxLanes`/`fetchConfig` are imported from `./api` in one block, add `setTheme as persistTheme` there instead of a second import line.)

Add state (after `const [redate, setRedate] = …` / near the other useState):
```ts
  const [theme, setTheme] = useState<Theme>(() => coerceTheme(localStorage.getItem("spear-theme")));
```

- [ ] **Step 2: Apply + persist effect.** Add a `useEffect` (near the others):
```ts
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("spear-theme", theme);
  }, [theme]);
```

- [ ] **Step 3: Reconcile from config on mount.** In the existing mount `useEffect`, where `fetchConfig()` is already called for lanes, extend it to also set the theme — replace:
```ts
    fetchConfig()
      .then((c) => setLanes(c.maxLanes))
      .catch(() => {});
```
with:
```ts
    fetchConfig()
      .then((c) => {
        setLanes(c.maxLanes);
        setTheme(coerceTheme(c.theme));
      })
      .catch(() => {});
```

- [ ] **Step 4: Change handler.** Add (near `changeLanes`):
```ts
  const changeTheme = useCallback((t: Theme) => {
    setTheme(t); // optimistic + applied by the effect
    void persistTheme(t).catch(() => {});
  }, []);
```

- [ ] **Step 5: Header switcher.** In the header `.bar`, right before the `<label className="lanes-ctl" …>` element, add:
```tsx
        <label className="lanes-ctl" title="App theme">
          theme
          <select value={theme} onChange={(e) => changeTheme(e.target.value as Theme)}>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
```

- [ ] **Step 6: Rain only in Matrix.** Replace:
```tsx
      <Rain />
```
with:
```tsx
      {theme === "matrix" && <Rain />}
```

- [ ] **Step 7: Verify build.** Run: `npm run build:web` — Expected: no type errors.

- [ ] **Step 8: Commit**
```bash
git add src/web/App.tsx
git commit -m "feat(web): header theme switcher (Matrix/Dark/Light) + config sync"
```

---

## Task 6: CHANGELOG, version, verify, smoke, release, local refresh

**Files:** Modify `CHANGELOG.md`, `package.json`

- [ ] **Step 1: CHANGELOG.** Insert above `## [0.1.25]`:
```markdown
## [0.1.26] — 2026-06-17
### Added
- **Light and friendly-dark themes** alongside the default Matrix theme — switch from the header; the
  choice is saved to `~/.spear/config.json` (synced across CLI/desktop/browser) and applies to all tabs.

```

- [ ] **Step 2: Version.** Set `"version": "0.1.26"` in `package.json`.

- [ ] **Step 3: Full verification.** Run: `npm run typecheck && npm test && npm run build` — Expected: all PASS.

- [ ] **Step 4: Live smoke (config theme route, throwaway home).**
```bash
export SPEAR_HOME=/tmp/spear-v26-$$
mkdir -p "$SPEAR_HOME"
node dist/cli.js serve --port 4407 >/tmp/spear-v26.log 2>&1 &
SRV=$!; sleep 2
echo "default: $(curl -s localhost:4407/api/config)"
echo "set dark: $(curl -s -X POST localhost:4407/api/config/theme -H 'content-type: application/json' -d '{"theme":"dark"}')"
echo "persisted: $(curl -s localhost:4407/api/config)"
echo "reject bad: $(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4407/api/config/theme -H 'content-type: application/json' -d '{"theme":"neon"}')"
echo "config.json theme: $(grep -o '\"theme\":[^,}]*' "$SPEAR_HOME/config.json")"
kill $SRV 2>/dev/null; rm -rf "$SPEAR_HOME"; unset SPEAR_HOME
```
Expected: default shows `"theme":"matrix"`, set-dark returns `{"theme":"dark"}`, persisted shows `"theme":"dark"`, bad theme returns `400`, and config.json has `"theme": "dark"`.

- [ ] **Step 5: Commit.**
```bash
git add CHANGELOG.md package.json
git commit -m "chore: release v0.1.26 — Matrix/Dark/Light themes"
```

- [ ] **Step 6: Install locally.** `npm run build && npm link` → `spear --version` = `0.1.26`.

- [ ] **Step 7: Push + tag.**
```bash
git push origin main
git tag v0.1.26
git push origin v0.1.26
```

- [ ] **Step 8: Confirm release + refresh local app.** Poll the run to `completed/success`; `gh release view v0.1.26 --json assets --jq '.assets[].name'` (expect `spear-0.1.26-arm64.dmg`). Refresh the installed app (download → verify sha512 → quit → swap → de-quarantine → relaunch). In the app, switch the header theme to Dark and Light and confirm all tabs (Today/Board/Week/Goals) restyle and the choice survives a relaunch.

---

## Self-Review

**Spec coverage:**
- A (mechanism: data-theme override, --accent-rgb/--header-bg/--panel-tint, drop rain/scanlines/glow): Tasks 4, 5. ✔
- B (palettes): Task 4 (the dark/light blocks match the spec values). ✔
- C (persistence: config theme + GET/POST + coerceTheme): Tasks 1, 2; reconcile+cache in Task 5. ✔
- D (switcher: fetchConfig/setTheme, App state/effect/select, Rain conditional): Tasks 3, 5. ✔
- E (coerceTheme test): Task 1. ✔
- Release v0.1.26: Task 6. ✔

**Placeholder scan:** none. The `sed` commands are exact; the import-placement notes are concrete guidance.

**Type consistency:** `Theme` / `THEMES` / `coerceTheme` (Task 1) reused in config-route validation (Task 2) and App (Task 5). `setTheme` (api, Task 3) imported as `persistTheme` in App (Task 5) to avoid clashing with the `setTheme` state setter. `fetchConfig` returns `{ maxLanes, theme }` (Task 3) consumed in Task 5. `--accent-rgb`/`--header-bg`/`--panel-tint` defined in `:root` (Task 4 Step 1) and overridden per theme (Task 4 Step 4); the `sed` (Step 3) makes rules reference them.
```
