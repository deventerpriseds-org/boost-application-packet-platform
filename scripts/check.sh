#!/usr/bin/env bash
# ONE command to run before every commit: tests + build, both gated on their REAL exit codes.
#
# WHY THIS EXISTS. A broken build reached `main` because the command was
#
#     cd app && npm run build 2>&1 | tail -2 && cd .. && git commit ...
#
# A pipeline's exit status is the LAST command's, so `| tail -2` reported success while esbuild had
# failed, and the `&&` chain sailed straight through to the commit and the push. The error trace was
# right there in the output; `tail -2` had cropped everything above it.
#
# This is the same shape as the `2>&1 >/dev/null` miss earlier in the same session: a redirection
# that hides the thing being checked. Remembering not to do it did not work twice, so the fix is a
# script that cannot do it - `set -euo pipefail`, no pipes on the commands that matter, and a loud
# refusal.
#
#   ./scripts/check.sh          tests + build for app/ and api/
#   ./scripts/check.sh app      just the front end (faster while iterating on a screen)
set -euo pipefail

cd "$(dirname "$0")/.."
WHAT="${1:-all}"
fail() { echo ""; echo "!!! $1"; echo "!!! NOT safe to commit."; exit 1; }

if [ "$WHAT" = "all" ] || [ "$WHAT" = "app" ]; then
  echo "== app: tests =="
  ( cd app && npm test ) || fail "app tests failed"
  echo "== app: build =="
  # No pipe. The output is the point: esbuild prints the offending line and a `| tail` crops it.
  ( cd app && npm run build ) || fail "app build failed"
fi

if [ "$WHAT" = "all" ] || [ "$WHAT" = "api" ]; then
  echo "== api: build =="
  ( cd api && npm run build ) || fail "api build failed"
  if [ -d api/test ]; then
    echo "== api: tests =="
    ( cd api && npm test ) || fail "api tests failed"
  fi
fi

# The smart-quote sweep's own trap: the Edit tool inserts U+2018/2019/201C/201D into JSX, esbuild
# rejects them in syntax positions, and `grep -P` cannot report them in this container's locale
# (it dies with "character code point value too large" and prints nothing, which reads as clean).
# The BUILD above is the real guard for syntax positions; this only names the file so the fix is
# quick, and it deliberately does not fail - typographic quotes in user-facing copy are correct.
python3 - <<'PY' || true
import pathlib
BAD = {0x2018: '‘', 0x2019: '’', 0x201C: '“', 0x201D: '”'}
hits = []
for p in list(pathlib.Path('app/src').rglob('*.jsx')) + list(pathlib.Path('app/src').rglob('*.js')):
    for n, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
        for ch in line:
            if ord(ch) in BAD:
                hits.append(f'{p}:{n}'); break
if hits:
    print(f"\n(note) {len(hits)} line(s) carry typographic quotes - fine in copy, fatal in a syntax")
    print("       position. The build above already passed, so these are copy:")
    for h in hits[:8]: print('       ' + h)
PY

echo ""
echo "== all checks passed - safe to commit =="
