#!/usr/bin/env bash
# MUTATION PROOF of the 8 new guards in api/test/correction.test.mjs.
# For each mutation: revert the behaviour the guard describes, rebuild, run the suite, and record
# WHICH named tests fail. A guard that does not fail when its behaviour is removed is INERT.
# Always restores the file, even on error.
set -uo pipefail
cd /home/user/boost-application-packet-platform/api
SRC=src/functions/tests/correction.ts
BAK=$(mktemp)
cp "$SRC" "$BAK"
restore() { cp "$BAK" "$SRC"; npm run build >/dev/null 2>&1; }
trap restore EXIT

GUARDS='H:revert-across-two-frames|H:revert-two-owner-rows|H:revert-legacy-rows-need-no-backfill|H:correction-frame-declared-not-guessed|H:correction-frame-map-exhaustive|H:revert-verifies-every-owner-row-hash|H:revert-reason-never-blames-the-owner-falsely|H:revert-writes-nothing-when-text-moved'

run_mutation() {
  local name="$1"; shift
  cp "$BAK" "$SRC"
  python3 - "$SRC" "$@" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
for i in range(2, len(sys.argv), 2):
    old, new = sys.argv[i], sys.argv[i+1]
    if old not in s:
        print(f"MUTATION DID NOT APPLY (pattern absent): {old[:70]!r}", file=sys.stderr); sys.exit(3)
    s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
PY
  if [ $? -ne 0 ]; then echo "=== $name: PATCH FAILED ==="; return; fi
  if ! npm run build >/dev/null 2>&1; then echo "=== $name -> BUILD FAILED (mutation rejected by tsc — still a guard) ==="; return; fi
  local out; out=$(node --test test/*.test.mjs 2>&1)
  local failed; failed=$(echo "$out" | grep -E "^not ok [0-9]+ - " | sed 's/^not ok [0-9]* - //')
  local nfail; nfail=$(echo "$out" | grep -E "^# fail " | awk '{print $3}')
  echo "=== $name -> ${nfail:-?} failing test(s) ==="
  if [ -z "$failed" ]; then echo "    (NONE — the mutation is invisible to the suite)"; else
    echo "$failed" | grep -E "$GUARDS" | sed 's/^/    NEW GUARD FIRED: /'
    echo "$failed" | grep -vE "$GUARDS" | sed 's/^/    other: /'
  fi
}

echo "### baseline"
npm run build >/dev/null 2>&1
node --test test/*.test.mjs 2>&1 | grep -E "^# (tests|pass|fail) "

run_mutation "MUT-1  frameOf always returns 'original' (the exact pre-fix assumption)" \
  "  if (c.frame === 'original' || c.frame === 'applied') return c.frame
  const f = CORRECTION_FRAME[c.source as CorrectionSource]
  return f || null" \
  "  return 'original'"

run_mutation "MUT-2  profile_figure removed from CORRECTION_FRAME" \
  "export const CORRECTION_FRAME: Record<CorrectionSource, CorrectionFrame> = {
  profile_figure: 'original'," \
  "export const CORRECTION_FRAME: Record<string, CorrectionFrame> = {"

run_mutation "MUT-3  only the TARGET row's hash is verified during the applied-frame unwind" \
  "    if (sha256(before) !== c.before_sha256) {" \
  "    if (c.applied_seq === seq && sha256(before) !== c.before_sha256) {"

run_mutation "MUT-4  the rebuild refusal returns the OLD, false sentence" \
  "        reason: 'this field was rebuilt after you edited it, so the changes are recorded in an order this version cannot safely unpick'," \
  "        reason: 'this field was edited after the correction was applied, so the original cannot be restored safely',"

run_mutation "MUT-5  an unknown frame DEFAULTS to 'original' instead of refusing" \
  "  const unknown = applied.filter(c => frameOf(c) === null)
  if (unknown.length) {" \
  "  const unknown: Correction[] = []
  if (unknown.length) {"

run_mutation "MUT-6  the applied-frame per-row hash check is removed entirely" \
  "    if (sha256(before) !== c.before_sha256) {
      return { ok: false, reason: 'this field was edited after the correction was applied, so the original cannot be restored safely' }
    }" \
  "    // hash check removed"

run_mutation "MUT-7  the applied-frame positional check is removed (splice wherever the offset points)" \
  "    if (text.slice(c.char_start, end) !== c.replacement) {
      return { ok: false, reason: \`this text no longer matches the change log (change \${c.applied_seq} is not where the record says it is)\` }
    }" \
  "    // positional check removed"

run_mutation "MUT-8  the target's own hash check is dropped for original-frame targets" \
  "  if (frameOf(target) === 'original' && sha256(original) !== target.before_sha256) {" \
  "  if (false && sha256(original) !== target.before_sha256) {"

run_mutation "MUT-9  owner survivors re-placed by stored OFFSET instead of exact-once phrase search" \
  "    const at = locateOwnerPhrase(out, c.phrase)
    if (at.at === null) return { ok: false, reason: \`undoing this would lose your edit: \${at.reason}\` }
    out = out.slice(0, at.at) + c.replacement + out.slice(at.at + c.phrase.length)" \
  "    out = out.slice(0, c.char_start) + c.replacement + out.slice(c.char_end)"

run_mutation "COUNTER-PROOF  CORRECTION_FRAME reordered (correct, but a different literal)" \
  "  profile_figure: 'original',
  generalized: 'original',
  owner_edit: 'applied',
}" \
  "  owner_edit: 'applied',
  generalized: 'original',
  profile_figure: 'original',
}"

echo
echo "### restoring and confirming clean"
restore
node --test test/*.test.mjs 2>&1 | grep -E "^# (tests|pass|fail) "
