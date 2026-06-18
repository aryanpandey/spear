# Changelog

All notable changes to spear. Format loosely follows [Keep a Changelog](https://keepachangelog.com);
versions are the `vX.Y.Z` git tags that trigger a dmg/exe release.

## [0.1.28] — 2026-06-18
### Added
- **Build tasks from a link.** Paste a page URL into the add bar and spear reads it and derives tasks —
  using the page's full contents together with your prompt (the page need not already be a task list).
  Public pages via WebFetch; Notion workspace share-links via the Notion connector.
### Changed
- **Lane ordering**: in-progress first, then by due date (soonest first), then priority.
- **Replan dates** now assigns earlier completion dates to higher-priority tasks within a lane.

## [0.1.27] — 2026-06-18
### Added
- **Click a task to open its detail** (from Board, Today, or Week) — a sub-view with the task's info, an
  editable **Notes & details** field, and **image attachments** (paste / drag / pick; stored under
  `~/.spear/attachments/`).

## [0.1.26] — 2026-06-17
### Added
- **Light and friendly-dark themes** alongside the default Matrix theme — switch from the header; the
  choice is saved to `~/.spear/config.json` (synced across CLI/desktop/browser) and applies to all tabs.

## [0.1.25] — 2026-06-17
### Changed
- **Renaming a task is now a card-name edit on the Today flow.** The card's prominent name is the
  editable task title (matching Board/Week); a lone generic stage's name (which just duplicated the
  title) is no longer shown as a separate name. Renaming keeps a single generic stage's name in sync,
  and a one-off backfill fixes tasks whose title and stage name had already diverged.

## [0.1.24] — 2026-06-17
### Added
- **Replan dates.** A "⟳ replan dates" button on the Today flow re-decides every task's completion date
  from the current lane order (without changing the order), assuming ~2 tasks per lane per day, via one
  LLM call per lane with a live percentage progress bar. Within-lane dates are clamped non-decreasing.
  It also runs automatically after a lane-count change. New `models.dates` / `effort.dates` config keys.
- **Drag-and-drop an image** onto the add-task box (in addition to pasting).
### Changed
- The add-task progress bar is now a **determinate percentage fill** (fills left→right with the
  capture's completion) instead of an animated sweeping light.

## [0.1.23] — 2026-06-17
### Added
- **Green progress bar across the add box** while a capture is generating and being assigned — it's on
  from the moment you hit Add, through extraction / duplicate-check / breakdown, and through the re-plan,
  so the whole ~generation+assignment window now has a visible indicator (the old bar only covered the
  re-plan and sat as a thin line at the top of the window).

## [0.1.22] — 2026-06-17
### Fixed
- **Image paste no longer 413s.** The server body limit is raised to 32 MB so a pasted screenshot
  (base64-encoded in the request) is accepted (Fastify defaulted to 1 MB).
### Changed
- The add bar's pasted-image thumbnail now sits to the **left** of the textbox, and the textbox is an
  auto-growing textarea that expands as you type multiple lines (Enter submits, Shift+Enter for a newline).

## [0.1.21] — 2026-06-17
### Added
- **Confirm-and-edit before creating** — when a capture is uncertain (an image was used, 2+ tasks were
  extracted, or a duplicate was flagged) the add bar shows an editable popup: tweak each task's title
  and details or remove it, then create. A single typed task with no duplicate still creates instantly.
- **Rename a task inline** from the Board, Today, and Week views (click the title).

## [0.1.20] — 2026-06-16
### Added
- **Duplicate detection.** Adding a task that semantically matches an existing one (open or done)
  now warns with the match + reason and an **Add anyway** button; the CLI `spear add` aborts unless
  `--force`. Uses a Claude **Sonnet** call (`models.duplicate`, default `claude-sonnet-4-6`).
- `models.duplicate` / `effort.duplicate` config keys.
### Changed
- GUI intake is now a two-step **check → create** so duplicates are flagged before anything is created.
- README overhauled to match the LLM-only design; added this changelog.

## [0.1.19] — 2026-06-16
### Changed
- **macOS updates download to ~/Downloads.** Since the mac build is unsigned and dmg-only (Squirrel
  can't update it in place), **⟳ refresh** now downloads the new `.dmg` to your Downloads folder and
  reveals it in Finder to drag into Applications. Windows keeps in-place auto-update.

## [0.1.18] — 2026-06-16
### Added
- **Multimodal / multi-task intake.** The add bar accepts a pasted image and/or text and splits a
  capture into 1..N tasks, each broken down in parallel.
- **Auto / Task / Feature toggle** on capture (and `spear add --task` / `--feature`).
- **Pre-computed suggested due dates** — a background pass stores a priority/effort/load-aware
  suggestion per undated task, shown as a one-click chip in the Today due editor.
- **Configurable lane count** from the dashboard header (re-plans on change).
### Changed
- Features now always break into **Planning → Implementation → Testing** (prompt-enforced).
### Fixed
- `spear --version` reports the real package version (was hardcoded `0.1.0`).

## [0.1.17] — 2026-06-15
### Added
- Click a task's priority in Today to change it.

## [0.1.16] — 2026-06-15
### Fixed
- Rapid start→done now marks the task done and removes it from the lanes.

## [0.1.15] — 2026-06-15
### Changed
- Re-plan only on new task additions / breakdowns, not on start/done progress.

## [0.1.14] — 2026-06-15
### Added
- Re-planning progress indicator.

## [0.1.13] — 2026-06-15
### Fixed
- Pass `--effort` to the Claude CLI (fixes painfully slow re-plans).

## [0.1.12] — 2026-06-15
### Changed
- **LLM-only planner** via the Claude Code CLI (no API key); removed the deterministic planner
  graph, rule-based breakdown, and the Anthropic SDK. Brighter Week-tab days.

## [0.1.11] — 2026-06-15
### Added
- Weekly calendar (**Week**) tab.

## [0.1.10] — 2026-06-15
### Added
- Critical tasks supersede in-progress work within a lane; deadline editing.

## [0.1.9] — 2026-06-15
### Added
- Ad-hoc macOS signing (`afterPack`) so the unsigned dmg isn't flagged "damaged"; config-file Claude key.

## [0.1.0]–[0.1.8] — 2026-06-14…15
- Initial releases: CLI + dashboard, per-task action buttons, the Goals tab and weekly scorecard,
  desktop (Electron) packaging, and the GitHub-Release auto-update plumbing.
