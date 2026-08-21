#!/usr/bin/env bash
# Who is working where — a traceability map for parallel lanes sharing one repository.
#
# WHY THIS EXISTS. Four separate failures in one session, all the same root cause: agents were
# launched without isolated worktrees, so several lanes wrote into one working directory on one
# branch. The symptoms never named the cause:
#   * `git add -A` swept ten files from two other lanes into an unrelated commit, twice
#   * a lane committed onto another lane's branch, because that is what the shared tree was on
#   * the shared tree sat on `main`, one keystroke from an unreviewed production deploy
#   * `git stash` is repository-global, so one lane's stash swallowed another's reinstated defect
# Every one of those was found by accident. This makes the state readable on purpose.
#
#   ./scripts/lanes.sh          the map
#   ./scripts/lanes.sh who BR   who has touched branch BR, newest first
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
ROOT="$(pwd)"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

if [ "${1:-}" = "who" ]; then
  br="${2:?usage: lanes.sh who <branch>}"
  echo "reflog for $br — every checkout, commit and reset, newest first:"
  git reflog show "$br" --date=iso --format='  %gd  %ci  %gs' 2>/dev/null | head -25 \
    || echo "  no reflog — the branch may only exist on the remote"
  echo
  echo "commits not on $DEFAULT_BRANCH:"
  git log --oneline "$DEFAULT_BRANCH..$br" 2>/dev/null | head -15 | sed 's/^/  /' || true
  exit 0
fi

printf "%-34s %-30s %-9s %5s  %s\n" WORKTREE BRANCH HEAD DIRTY OWNER
printf "%-34s %-30s %-9s %5s  %s\n" "---------------------------------" "-----------------------------" "--------" "-----" "-----"

warn=()
declare -A branch_seen
while IFS= read -r line; do
  path="${line%% *}"; rest="${line#* }"
  sha="$(echo "$rest" | awk '{print $1}')"
  branch="$(echo "$rest" | sed -n 's/.*\[\(.*\)\].*/\1/p')"
  [ -z "$branch" ] && branch="(detached)"

  owner="—"
  case "$path" in
    */.claude/worktrees/agent-*) owner="agent ${path##*/agent-}" ;;
    "$ROOT")                     owner="SHARED (no owner)" ;;
    /tmp/*|*/scratchpad/*)       owner="ad-hoc" ;;
  esac

  dirty="$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

  # Two worktrees on one branch: whoever commits second is committing into the other's history.
  if [ "$branch" != "(detached)" ]; then
    if [ -n "${branch_seen[$branch]:-}" ]; then
      warn+=("COLLISION: $branch is checked out in TWO worktrees — ${branch_seen[$branch]} and $(basename "$path")")
    fi
    branch_seen[$branch]="$(basename "$path")"
  fi

  [ "$path" = "$ROOT" ] && [ "$branch" = "$DEFAULT_BRANCH" ] && \
    warn+=("DANGER: the shared checkout is on $DEFAULT_BRANCH — a stray lane commit deploys to production")
  [ "$path" = "$ROOT" ] && [ "$dirty" != "0" ] && \
    warn+=("UNOWNED: $dirty uncommitted file(s) in the shared checkout. If the cross-reference below says no other worktree has them, a lane is running WITHOUT isolation and editing the shared tree directly — that is the condition to fix.")

  printf "%-34s %-30s %-9s %5s  %s\n" "$(basename "$path")" "$branch" "$sha" "$dirty" "$owner"
done < <(git worktree list)

if [ ${#warn[@]} -gt 0 ]; then
  echo
  printf '!! %s\n' "${warn[@]}"
fi

echo
echo "uncommitted work in the shared checkout, cross-referenced against every other worktree:"
echo "(a lane editing a file usually has it dirty in ITS tree too — that is what names the owner)"
git status --porcelain | while read -r st f; do
  # Strip rename arrows so the path is real.
  path="${f##*-> }"
  hits=""
  while IFS= read -r wl; do
    wp="${wl%% *}"
    [ "$wp" = "$ROOT" ] && continue
    if git -C "$wp" status --porcelain -- "$path" 2>/dev/null | grep -q .; then
      hits="$hits $(basename "$wp")"
    fi
  done < <(git worktree list)
  if [ -n "$hits" ]; then
    printf "  %-3s %-46s ALSO DIRTY IN:%s\n" "$st" "$(basename "$path")" "$hits"
  else
    printf "  %-3s %-46s no other worktree has it — orphaned or scratch\n" "$st" "$(basename "$path")"
  fi
done

echo
echo "abandoned worktrees (dirty, but no agent owns them):"
git worktree list | while IFS= read -r wl; do
  wp="${wl%% *}"
  case "$wp" in */.claude/worktrees/agent-*|"$ROOT") continue;; esac
  d="$(git -C "$wp" status --porcelain 2>/dev/null | wc -l | tr -d " ")"
  [ "$d" != "0" ] && printf "  %-22s %s dirty file(s)\n" "$(basename "$wp")" "$d"
done
