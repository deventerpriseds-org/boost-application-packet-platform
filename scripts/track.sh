#!/usr/bin/env bash
# Append to THIS repo's .claude tracker, from stdin. Never the wrong file.
#
# WHY THIS EXISTS, and why it is a script rather than another line of prose. Twice in one session a
# tracker append landed in `/home/user/.claude/actions.md` — the project-ROOT tracker for the
# multi-repo session — instead of this repo's. Both times the command was a plain
# `cat >> .claude/actions.md`, both times the shell's working directory had drifted to `/home/user`,
# and both times the append reported success. The second occurrence happened AFTER the first had been
# written up as a lesson in this very file's target, which is the whole argument: prose does not run.
#
# The failure is silent by construction. `cat >>` creates the file if missing and exits 0, so the
# only tell is `git status` showing the tracker unmodified after an append that "worked" — and you
# only look if you already suspect it.
#
# The fix is to stop passing a relative path. This script resolves the repo from its OWN location, so
# it cannot be aimed at the wrong tree no matter where it is invoked from, and it verifies the write
# landed rather than trusting the exit code.
#
#   printf '%s\n' "text" | scripts/track.sh actions
#   scripts/track.sh memory < /tmp/block.md
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHICH="${1:-}"
case "$WHICH" in
  actions|memory) TARGET="$REPO/.claude/$WHICH.md" ;;
  *) echo "usage: track.sh actions|memory  (content on stdin)" >&2; exit 2 ;;
esac

[ -f "$TARGET" ] || { echo "!!! $TARGET does not exist — refusing to create a decoy tracker" >&2; exit 1; }

BEFORE=$(wc -c < "$TARGET")
printf '\n' >> "$TARGET"
cat >> "$TARGET"
AFTER=$(wc -c < "$TARGET")

if [ "$AFTER" -le "$((BEFORE + 1))" ]; then
  echo "!!! nothing was appended to $TARGET (stdin empty?)" >&2
  exit 1
fi
echo "appended $((AFTER - BEFORE)) bytes to $TARGET"

# The check that would have caught both incidents in under a second.
if ! git -C "$REPO" status --porcelain -- "$TARGET" | grep -q .; then
  echo "!!! $TARGET is UNMODIFIED according to git — the write did not land where you think" >&2
  exit 1
fi
