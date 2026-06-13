# spear

A fully-local, **Matrix-themed** personal project tracker with an LLM execution-flow planner.

You drive it from a terminal CLI, watch it in a localhost dashboard, and every morning an
LLM produces a parallelism-maximizing "execution flow" for the day — re-planning in real time
as ad-hoc tasks land. Everything lives on your machine: a SQLite file at `~/.spear/spear.db`.

```
describe a task ──▶ LLM breaks it down ──▶ set a priority ──▶ every morning (and on every
   (CLI)            (feature → Planning →     (critical/…/low)     ad-hoc add) an LLM lays out
                     Implementation →                              the day across parallel lanes,
                     Testing → Stage Testing;                      delegating what it can so your
                     else its own judgment)                        own critical path is shortest.
```

## Screenshots

**Today — the execution flow.** Open flows are grouped into lanes by theme (capped at 6), ordered
design → implementation → testing within each lane; only each lane's next step is "▶ now", and
delegatable steps are flagged:

![spear — Today / execution flow](docs/screenshots/today.png)

**Board — tasks by status**, with stage progress, priorities, and blocked-by dependencies:

![spear — Board](docs/screenshots/board.png)

> The screenshots use throwaway demo data (`scripts/build-demo.sh`). Regenerate them with
> `npm run screenshots` (needs Google Chrome).

## Install

```bash
npm install
npm run build          # compiles the CLI/server (dist/) and the web app (dist/web/)
npm link               # optional: puts `spear` on your PATH (otherwise use `node dist/cli.js`)
export ANTHROPIC_API_KEY=...   # required for LLM breakdown + planning (works without it, deterministically)
spear init             # creates ~/.spear, seeds the "Me" executor, writes the 8am launchd job
```

> **Keys stay local.** `ANTHROPIC_API_KEY` is read from your environment only — it is never written
> to disk or committed. Your task data lives in `~/.spear/`, outside this repo.

### Try it with demo data

```bash
npm run screenshots    # builds a throwaway demo board in a temp dir and writes docs/screenshots/*
# …or drive it yourself:
SPEAR_HOME=/tmp/spear-demo node dist/cli.js init --no-launchd
SPEAR_HOME=/tmp/spear-demo SPEAR_CLI="node dist/cli.js" bash scripts/build-demo.sh
SPEAR_HOME=/tmp/spear-demo node dist/cli.js serve --port 4399 --open
```

## Everyday use

```bash
spear add "Fix prod outage in billing"                       # priority auto-inferred (→ critical)
spear add "Ship onboarding revamp" --due 2026-09-01          # due date feeds priority + time-fit
spear add "Renew SSL cert" --no-llm                          # instant capture, no LLM
spear add "Ship v2" --type feature --blocked-by 1            # depends on task #1 (override with --priority)

spear list                       # open tasks + next stage + blockers
spear show 1                     # a task's stages, deps, delegation hints
spear done 1                     # advance the flow (complete the next stage)
spear done 1 --all               # complete the whole task
spear status 3 in_progress       # set status explicitly
spear block 4 --by 1             # add / remove a dependency
spear unblock 4 --by 1

spear plan                       # FULL re-cluster of today's lanes (LLM if available)
spear today                      # print the current execution flow
spear serve --open               # start the dashboard at http://127.0.0.1:4317
```

The CLI and dashboard stay in sync: any change pings a running `serve` so the browser updates
live over SSE; with no server running, the plan is refreshed inline so `today`/`serve` are current.

### A seamless day

- **Zero-decision capture.** `spear add "..."` auto-infers priority from urgency words, the due
  date, and whether it blocks others (the LLM refines it when keyed); `--priority` always wins.
- **Sticky lanes.** Lane membership persists, so adding a task mid-day **slots it into the right
  lane without reshuffling the rest of your day** — a lane only lightly re-balances when overloaded.
  The full (LLM) re-cluster happens at `spear plan` and the morning job.
- **Due-date aware.** Overdue / due-today tasks float to the top of their lane (⌛ / ⏰).

## Desktop app (Electron)

spear can run as a native desktop window instead of a browser tab. The Electron shell
(`electron/main.cjs`) boots the same server in-process and shares your `~/.spear` data.

**Get it from the dashboard.** Open the dashboard in your browser and click **⤓ Desktop app**
in the header — it detects your OS (macOS / Windows) and downloads the matching installer.
The download is served by the local server from the `release/` directory.

**Build the installers** (writes to `release/`):

```bash
npm run dist:mac     # → release/spear-<ver>-<arch>.dmg   (build on macOS)
npm run dist:win     # → release/spear Setup <ver>.exe     (build on Windows, or via CI)
npm run electron:dev # run the desktop shell locally without packaging
```

> Native installers are platform-specific: build the `.dmg` on macOS and the `.exe` on
> Windows (or use CI / a Windows box — cross-building Windows from macOS needs Wine).
> `better-sqlite3` is rebuilt for Electron's ABI during packaging (`npmRebuild`); the
> `dist:*` scripts then run `npm rebuild better-sqlite3` (a `postdist` hook) to restore the
> plain-Node ABI so the `spear` CLI keeps working. The mac build is unsigned
> (`identity: null`); right-click → Open the first time.

## Delegation roster

"Parallel" means **delegation**. The planner assigns independent flows to executors so you aren't
the bottleneck, and flags delegation candidates even when you're the only executor. Add more:

```bash
spear executor add "Claude Code" --kind ai_agent --handles implementation,testing,planning
spear executor add "CI" --kind ci --handles testing
spear executor list
```

## Morning automation

`spear init` installs `~/Library/LaunchAgents/com.spear.morning.plist`, which runs `spear morning`
at 08:00 (regenerate the plan + macOS notification). Enable / change it:

```bash
launchctl load ~/Library/LaunchAgents/com.spear.morning.plist
spear config set morning.hour 7     # also refreshes the plist
```

> The job fires at next wake if your Mac was asleep at the scheduled time.
> Install `terminal-notifier` (`brew install terminal-notifier`) for a clickable notification.

## Seed from Notion (one-time)

Export your Notion board to `~/.spear/notion-seed.json` (an array of
`{external_id, title, status, priority, due, notes}`), then:

```bash
spear import-notion              # idempotent upsert by external_id
spear import-notion --breakdown  # also break new tasks into stages
```

## Config

`~/.spear/config.json` — `port`, `morning.{hour,minute}`, `models.{breakdown,planner}`,
`effort.*`, `defaultPriority`, `replanDebounceMs`. View/edit with `spear config [get|set] <key> [value]`.

## Architecture

- **SQLite** (`better-sqlite3`) is the source of truth: `tasks → stages → dependencies`,
  `executors`, `daily_plans → plan_items`.
- **Planner** = deterministic TypeScript graph (topo sort, independent-lane detection,
  critical path — unit-tested) + an LLM judgment layer (Claude `claude-opus-4-8`) that assigns
  executors, flags delegation, and writes the day's narrative.
- **Server** = Fastify serving a JSON API, an SSE stream, and the built React SPA (dark Matrix theme).
- **Real-time re-plan** = instant deterministic re-insert on every change + a debounced LLM refine.

```bash
npm test          # 43 unit/integration tests (planner graph, service, LLM mocks, DTOs, replan, import)
npm run dev -- <args>   # run the CLI from source via tsx
```
