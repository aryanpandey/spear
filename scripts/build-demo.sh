#!/usr/bin/env bash
# Populate a spear board with imaginary demo data (for screenshots / trying it out).
# Requires: $SPEAR_HOME pointing at a scratch dir, and a built dist/ (npm run build).
# Uses $SPEAR_CLI (default: node dist/cli.js).
set -euo pipefail

CLI="${SPEAR_CLI:-node dist/cli.js}"
add() { $CLI add "$1" --type "$2" --priority "$3" --no-llm >/dev/null; }

# --- themed clusters (show lane grouping + design→implementation→testing order) ---
add "Search Ranking Design"            chore   high      # 1
add "Search Indexing Implementation"   chore   high      # 2
add "Search Relevance Testing"         chore   medium    # 3
add "Checkout Flow Design"             chore   high      # 4
add "Checkout Payments Implementation" chore   critical  # 5
add "Checkout E2E Testing"             chore   high      # 6
add "Notifications Service Design"     chore   medium    # 7
add "Notifications Delivery Implementation" chore medium # 8
add "Onboarding Wizard Design"         chore   low       # 9
add "Onboarding Analytics Implementation" chore low      # 10

# --- features (4-stage flows: stage dots + delegation candidates) ---
add "Build dark mode toggle"           feature high      # 11
add "Add CSV export to reports"        feature medium    # 12

# --- standalone work (folded into lanes by the cap) ---
add "Upgrade CI runners"               chore   medium    # 13
add "Migrate logs to S3"               chore   low       # 14
add "Refactor auth module"             chore   medium    # 15
add "Investigate latency spike"        bug     critical  # 16
add "Renew TLS certificates"           chore   low       # 17

# --- statuses + a dependency, for Board variety ---
$CLI block 6 --by 5 >/dev/null            # Checkout E2E Testing blocked-by Payments Impl
$CLI status 2 in_progress >/dev/null      # Search Indexing in progress
$CLI status 16 in_progress >/dev/null     # latency spike in progress
$CLI status 14 backlog >/dev/null         # logs migration backlog
$CLI done 11 >/dev/null                   # advance the dark-mode feature one stage (Planning done)
$CLI done 17 --all >/dev/null             # Renew TLS → Done column

$CLI plan --no-llm >/dev/null
