#!/usr/bin/env bash
# WHAT HAVE WE WRITTEN THAT HAS NOT TAKEN EFFECT?
#
#   scripts/undeployed.sh          # the report
#   scripts/undeployed.sh --quiet  # print only if something is wrong (for hooks)
#
# WHY THIS EXISTS. Owner, 2026-08-27: *"countless hours of work is just lost by not being
# deployed."* That is not a vague worry, it is a measured pattern, and the same day produced three
# separate instances of it:
#
#   1. `jd-import.yml` was BUILT to replace a 1,054-char digest with the real 8,619-char posting.
#      It ran twice on 23 Aug - a dry run that succeeded and a write that FAILED - then a repair
#      commit (`06abee7`, "stop the post-write check failing on a correct import") was written and
#      the import was NEVER RE-RUN. Four days later production still held 1,054 chars and the real
#      posting sat committed in the repo, unused. The resume was being tailored against ten
#      requirements, five of which the employer never wrote.
#   2. Nine coverage rows described finished work as outstanding; the count moved 151 -> 158 BUILT
#      with no new code.
#   3. Two commits sat on a feature branch after `main` had already been deployed.
#
# WHAT MAKES THIS DIFFERENT FROM THE GUARDS WE ALREADY HAVE. Every existing check answers "is the
# CODE correct" - the suites, the mutation proofs, the ledger's staleness checks. Not one of them
# asks "did it ever REACH production". A test suite is perfectly happy while a workflow that was
# built to fix production has never successfully run. That gap is this file's whole subject.
#
# FIVE DISTINCT WAYS WORK FAILS TO LAND, and they are genuinely different failures - a report that
# collapses them into "not deployed" tells you nothing about what to do next:
#
#   A. committed but not pushed          -> the container can eat it
#   B. pushed but not on `main`          -> nothing deploys from a feature branch
#   C. on `main` but the deploy failed   -> the code is not running
#   D. a TOOL exists but never ran, or its last run FAILED   <- the expensive one, and the one
#                                                              nothing else in this repo watches
#   E. a ledger row says BUILT but NOT VERIFIED LIVE
#
# D is the class that cost the Trinnex hours. A workflow_dispatch tool is written to change
# production, and whether it was ever RUN is invisible to git, to CI and to every test we own.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR" || exit 0
SLUG="deventerpriseds-org/boost-application-packet-platform"
TOKEN="${GH_TOKEN:-${GHUB_KEY:-}}"
QUIET=0; [ "${1:-}" = "--quiet" ] && QUIET=1
FINDINGS=0
OUT=""
say() { OUT="${OUT}$1"$'\n'; }
flag() { FINDINGS=$((FINDINGS+1)); say "$1"; }

api() {  # $1 = path
  [ -z "$TOKEN" ] && return 1
  curl -sS --max-time 20 -H "Authorization: Bearer $TOKEN" \
       -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$SLUG$1" 2>/dev/null
}

say "=============================================================="
say " WRITTEN BUT NOT LANDED — $(date -u '+%Y-%m-%d %H:%M UTC')"
say "=============================================================="

git fetch origin --quiet 2>/dev/null

# ── A. committed but not pushed ────────────────────────────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if git rev-parse --verify -q "origin/$BRANCH" >/dev/null 2>&1; then
  N=$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)
  [ "$N" -gt 0 ] && flag "A. $N commit(s) on '$BRANCH' NOT PUSHED — a container reclaim loses these.
     fix: git push -u origin $BRANCH"
fi

# ── B. pushed to a branch, never landed on main ────────────────────────────────────────────────
if [ "$BRANCH" != "main" ] && git rev-parse --verify -q origin/main >/dev/null 2>&1; then
  N=$(git rev-list --count "origin/main..origin/$BRANCH" 2>/dev/null || echo 0)
  if [ "$N" -gt 0 ]; then
    # Deploys fire on api/** and app/**. Say whether this is dormant CODE or just docs, because
    # "not on main" is only urgent when something would actually go live.
    PATHS=$(git diff --name-only "origin/main..origin/$BRANCH" 2>/dev/null | grep -cE '^(api|app)/' || true)
    if [ "${PATHS:-0}" -gt 0 ]; then
      flag "B. $N commit(s) on '$BRANCH' not on main, and $PATHS touch api/ or app/ — THIS CODE IS NOT RUNNING.
     fix: git checkout main && git merge --ff-only $BRANCH && git push origin main"
    else
      say "B. $N commit(s) on '$BRANCH' not on main (docs only — nothing would deploy)."
    fi
  fi
fi

# ── C. main's HEAD — did its deploys succeed? ──────────────────────────────────────────────────
MAIN_SHA=$(git rev-parse origin/main 2>/dev/null)
if [ -n "$TOKEN" ] && [ -n "$MAIN_SHA" ]; then
  for WF in api-deploy.yml executive-engine-deploy.yml; do
    J=$(api "/actions/workflows/$WF/runs?per_page=20")
    # The newest run FOR THIS SHA. A deploy is path-filtered, so "no run" often means "this commit
    # did not touch that path" — which is fine, and is why that case is not flagged.
    C=$(printf '%s' "$J" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for r in d.get('workflow_runs',[]):
    if r.get('head_sha')=='$MAIN_SHA':
        print(r.get('conclusion') or r.get('status')); break
" 2>/dev/null)
    case "${C:-}" in
      success) say "C. $WF — success on main HEAD." ;;
      "")      say "C. $WF — no run for main HEAD (path filter likely did not match; not a fault)." ;;
      *)       flag "C. $WF is '$C' on main HEAD ${MAIN_SHA:0:7} — THE DEPLOYED APP IS NOT THIS CODE.
     fix: read the run, fix, push. ./scripts/wait-run.sh sha:$WF:$MAIN_SHA" ;;
    esac
  done
fi

# ── D. tools that exist but never took effect — THE EXPENSIVE CLASS ────────────────────────────
# A workflow_dispatch workflow is a TOOL someone wrote to change production. Git proves it exists;
# nothing proves it ever ran. Deploy/CI workflows are excluded — they are covered by C and by PR
# checks, and they run on push rather than being invoked.
if [ -n "$TOKEN" ]; then
  for f in .github/workflows/*.yml; do
    [ -e "$f" ] || continue
    WF=$(basename "$f")
    case "$WF" in api-deploy.yml|executive-engine-deploy.yml|ci.yml|test.yml) continue ;; esac
    grep -q 'workflow_dispatch' "$f" || continue
    J=$(api "/actions/workflows/$WF/runs?per_page=1")
    read -r TOTAL CONCL CREATED <<<"$(printf '%s' "$J" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('? ? ?'); sys.exit(0)
n=d.get('total_count',0); rs=d.get('workflow_runs',[])
if not rs: print(n,'NEVER-RUN','-')
else: print(n, rs[0].get('conclusion') or rs[0].get('status'), (rs[0].get('created_at') or '-')[:10])
" 2>/dev/null)"
    case "$CONCL" in
      NEVER-RUN) flag "D. $WF has NEVER RUN — it was written to do something and has not done it." ;;
      failure|cancelled|timed_out)
        flag "D. $WF — LAST RUN $CONCL ($CREATED, $TOTAL total). Work was written to change
     production and the change did not happen. This is the Trinnex class: built, failed, forgotten." ;;
    esac
  done
fi

# ── E. ledger rows that say built-but-unverified ───────────────────────────────────────────────
# A convention that already exists (`D:resume-summary-band`: "BUILT ... NOT VERIFIED LIVE - which is
# why this row is still OPEN"). Nothing surfaced it, so it only helped whoever happened to read it.
if [ -f .claude/DEFERRED.md ]; then
  N=$(grep -ciE 'NOT VERIFIED LIVE|NOT CONFIRMED DONE|built.{0,20}not (yet )?(verified|confirmed)' .claude/DEFERRED.md || true)
  [ "${N:-0}" -gt 0 ] && flag "E. $N ledger row(s) say BUILT but NOT VERIFIED LIVE.
     see: grep -niE 'NOT VERIFIED LIVE|NOT CONFIRMED DONE' .claude/DEFERRED.md"
fi

say "--------------------------------------------------------------"
if [ "$FINDINGS" -eq 0 ]; then
  say "Nothing written is sitting un-landed. "
else
  say "!!! $FINDINGS THING(S) WRITTEN BUT NOT IN EFFECT."
  say "Work that is not deployed is work that was not done. Close these before starting new work."
fi
say "=============================================================="

if [ "$QUIET" -eq 1 ] && [ "$FINDINGS" -eq 0 ]; then exit 0; fi
printf '%s' "$OUT"
exit 0
