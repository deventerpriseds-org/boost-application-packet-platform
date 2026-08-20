#!/usr/bin/env bash
# Wait for a GitHub Actions run to reach a terminal state and report its verdict. Replaces blind
# `sleep` windows, which waste time and guess at durations.
#
#   wait-run.sh <run_id>
#   wait-run.sh sha:<workflow.yml>:<sha>    # the run for THAT commit  <-- use this after a push
#   wait-run.sh latest:<workflow.yml>       # newest run; RACES with run creation
#
# WHY sha: EXISTS. `latest:` asks GitHub for the newest run, and immediately after a push that is
# still the PREVIOUS commit's run — GitHub has not created the new one yet. Waiting on it reports
# success for code that was never deployed. That happened: a bulk-endpoint deploy reported
# "deployed" while the old worker was still serving, producing two 400s from stale code that looked
# like an application bug. `latest:` is now REFUSED for deploy workflows for that reason.
#
# Exits non-zero when the run did not succeed, so the verdict is in the exit code.
set -uo pipefail
API="https://api.github.com/repos/deventerpriseds-org/boost-application-packet-platform"
TARGET="${1:?run id or latest:<workflow.yml> required}"
TAIL="${2:-40}"

# sha:<workflow>:<sha> — wait for the run belonging to THAT commit.
# `latest:` races with run creation: right after a push the newest run is still the PREVIOUS
# commit's, so waiting on it reports success for code that was never deployed. That produced a false
# "deployed" and two confusing 400s from stale code. Use sha: for anything you just pushed.
if [[ "$TARGET" == sha:* ]]; then
  REST="${TARGET#sha:}"; WF="${REST%%:*}"; SHA="${REST#*:}"
  RUN=""
  for _ in $(seq 1 30); do
    RUN=$(curl -sS "$API/actions/workflows/$WF/runs?per_page=10" | python3 -c "
import sys,json
sha='$SHA'
runs=[r for r in json.load(sys.stdin).get('workflow_runs',[]) if r['head_sha'].startswith(sha)]
print(runs[0]['id'] if runs else '')" 2>/dev/null)
    [ -n "$RUN" ] && break
    sleep 5
  done
  [ -z "$RUN" ] && { echo "no $WF run found for $SHA"; exit 1; }
elif [[ "$TARGET" == latest:* ]]; then
  WF="${TARGET#latest:}"
  # A deploy is the one case where the race is silently harmful: it makes "is my code live?" answer
  # yes about someone else's commit. Verifying a deploy REQUIRES naming the commit.
  case "$WF" in
    *deploy*)
      echo "refusing latest: for a deploy workflow — it races with run creation and will report on the PREVIOUS commit." >&2
      echo "use: wait-run.sh sha:$WF:\$(git rev-parse HEAD)" >&2
      exit 2 ;;
  esac
  RUN=$(curl -sS "$API/actions/workflows/$WF/runs?per_page=1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["workflow_runs"][0]["id"])') || exit 1
else
  RUN="$TARGET"
fi
echo "watching run $RUN"

for _ in $(seq 1 120); do
  J=$(curl -sS "$API/actions/runs/$RUN") || { sleep 10; continue; }
  ST=$(printf '%s' "$J" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("status",""),d.get("conclusion") or "")' 2>/dev/null) || { sleep 10; continue; }
  set -- $ST
  [ "${1:-}" = "completed" ] && break
  sleep 10
done

CONC=$(curl -sS "$API/actions/runs/$RUN" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("conclusion") or "TIMED_OUT")')
JOB=$(curl -sS "$API/actions/runs/$RUN/jobs" | python3 -c 'import sys,json;js=json.load(sys.stdin)["jobs"];print(js[0]["id"] if js else "")')
# Log CONTENT is not fetchable here: the artifact host (pipelines.actions.githubusercontent.com) is
# denied by the egress proxy with a 403 CONNECT. Report the ids and read the body via the GitHub MCP
# tool. The point of this script is the WAIT, which is now event-driven rather than a blind sleep.
echo "run $RUN -> $CONC (job $JOB)"
[ "$CONC" = "success" ] || exit 1
