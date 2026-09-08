#!/usr/bin/env bash
# Drive the Animation Intelligence programme with continuous-claude.
#
#   https://github.com/AnandChowdhary/continuous-claude
#
# Each iteration is a FRESH Claude session with no conversation history. Continuity comes from
# three places, in this order of authority:
#
#   docs/animation-intelligence/requirements-matrix.md   the living state of every requirement
#   SHARED_TASK_NOTES.md                                 what the last session learned
#   CLAUDE.md                                            durable project knowledge
#
# Run it from Git Bash, from the repo root, on the branch you want the work to land on.
# continuous-claude bases its pull requests on whatever branch is checked out, so being on
# `animation-intelligence` keeps the programme off `main`.
#
# Prerequisites, all checked below: claude CLI, gh (AUTHENTICATED), jq.

set -euo pipefail

# winget puts jq here and Git Bash does not pick it up from the Windows PATH.
export PATH="$PATH:$HOME/.local/bin:/c/Users/alyco/AppData/Local/Microsoft/WinGet/Links"

cd "$(dirname "$0")"

# ---------------------------------------------------------------- preflight
fail() { echo "✗ $1" >&2; exit 1; }

command -v claude            >/dev/null || fail "claude CLI not found on PATH"
command -v jq                >/dev/null || fail "jq not found — winget install jqlang.jq"
command -v gh                >/dev/null || fail "gh not found — https://cli.github.com"
command -v continuous-claude >/dev/null || fail "continuous-claude not found — see the URL at the top of this file"

gh auth status >/dev/null 2>&1 || fail "gh is not authenticated. Run:  gh auth refresh -h github.com  (or gh auth login)"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] && fail "refusing to run on main — check out animation-intelligence first"

# The branch prefix must not collide with an existing branch NAME. Git stores refs as files, so
# with a branch called `animation-intelligence` there can be no `animation-intelligence/auto/…`
# directory beside it — the create fails with nothing useful in the log. `ai-phase/` is unrelated
# to any branch here, and this check keeps it that way if someone changes the prefix later.
PREFIX_ROOT="${CC_BRANCH_PREFIX:-ai-phase/}"; PREFIX_ROOT="${PREFIX_ROOT%%/*}"
git show-ref --verify --quiet "refs/heads/$PREFIX_ROOT" \
  && fail "branch prefix '$PREFIX_ROOT/' collides with the existing branch '$PREFIX_ROOT' — git cannot nest refs under a ref"
[ -z "$(git status --porcelain)" ] || fail "working tree is dirty — commit or stash first, so an iteration's diff is only its own work"

echo "▶ branch: $BRANCH   (pull requests will be based here, not on main)"

# ---------------------------------------------------------------- the task
#
# Deliberately does NOT name a phase. The matrix is the state, so the session reads what is left
# rather than being told — which is what makes the same prompt correct on iteration 1 and 30.

read -r -d '' PROMPT <<'EOF' || true
Continue the Cadence Animation Intelligence programme.

Start by reading SHARED_TASK_NOTES.md in full, then
docs/animation-intelligence/requirements-matrix.md. Between them they tell you what is done, what
is next, and the rules this codebase holds itself to. Follow the working agreement in the notes.

Pick the next phase from directive Part 62's roadmap and work on ONE vertical slice of it —
something that can be inspected, changed, observed and undone end to end. Do not start several
phases, and do not build a row of feature shells: directive 4.6 is explicit about that.

Read only the directive sections your rows cite. The file is 4151 lines; loading it whole wastes
the context this session has.

Non-negotiable, because each one has already been got wrong here at least once:
- nothing under renderer/js/ai/ may import window, the DOM, three.js or state.js
- every result carries coverage.notRun naming what it did NOT check
- an unimplemented check is reported as not-run, never counted as satisfied
- a new MCP tool needs BOTH a handler in renderer/js/app.js and a server.tool in mcp-server/index.js
- after fixing a bug, reintroduce it and confirm the new test fails; a test that passes both ways
  is not a test

Finish by running all four suites, updating the requirements matrix honestly (including recounting
the status totals in its header from the table itself), and appending a log entry to
SHARED_TASK_NOTES.md that says what a session with no memory of this one would need to know.

If a phase's success condition cannot be met, say so plainly in the notes with the reason and what
would unblock it, rather than moving a row to implemented.
EOF

read -r -d '' REVIEW <<'EOF' || true
Verify this iteration before it is proposed.

Run node test/aitest.mjs, node test/coretest.mjs and node test/pnxtest.mjs. All three must pass.

Then run the Electron smoketest from PowerShell (npm is broken under Git Bash here):
  .\node_modules\.bin\electron.cmd . --disable-backgrounding-occluded-windows
    --disable-renderer-backgrounding --disable-background-timer-throttling
    --user-data-dir=test-output/userdata --screenshot=test-output/smoketest.png
    --demo-js-file=test/smoketest.js
and read test-output/smoketest-report.json.

A handful of GPU-bound steps flake when the machine is busy (Fire & smoke, Effect Look, classic
clothing, camera shake, some PNX render steps) — re-run once before treating one as a regression.
But never wave away a failure in a step this change actually touched.

Fix what is broken. Then check the honesty rules held: does every new result carry coverage.notRun,
is every new finding labelled with a certainty level, is every new MCP handler registered in
mcp-server/index.js, and does the matrix claim anything the tests do not actually prove? Report
what you found, and say explicitly if the answer to any of those is no.
EOF

# --max-runs 0 with --max-cost is the "keep going until the budget is gone" mode. Adjust the
# ceiling to taste; it is the only thing standing between this and an unbounded spend.
exec continuous-claude \
  --prompt "$PROMPT" \
  --review-prompt "$REVIEW" \
  --max-runs "${CC_MAX_RUNS:-6}" \
  --max-cost "${CC_MAX_COST:-40.00}" \
  --notes-file SHARED_TASK_NOTES.md \
  --knowledge-file CLAUDE.md \
  --git-branch-prefix "${CC_BRANCH_PREFIX:-ai-phase/}" \
  --merge-strategy squash \
  --stall-threshold 2 \
  --completion-threshold 2 \
  "$@"
