#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/e2e-specs.sh"

failures=0

check() {
  local name="$1" want="$2" got="$3"
  if [[ "$got" == "$want" ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$want', got '$got'" >&2
    failures=$((failures + 1))
  fi
}

peer() {
  if e2e_needs_collab_peer "$1"; then echo yes; else echo no; fi
}

check "a peer spec needs the collaboration peer" yes "$(peer e2e/tests/109-live-collaboration-peer.spec.ts)"
check "a peer spec with a line filter needs it too" yes "$(peer e2e/tests/109-live-collaboration-peer.spec.ts:42)"
check "an ordinary spec does not" no "$(peer e2e/tests/21-library.spec.ts)"
check "a browser-harness spec does not" no "$(peer e2e/tests/24-pdf-selection-browser.spec.ts)"
check "a spec merely named peer does not" no "$(peer e2e/tests/peer.spec.ts)"
check "a peer helper file is not a spec" no "$(peer e2e/tests/109-live-collaboration-peer.ts)"

check "ordinary specs turn live collaboration off so a peer spec never leaks it" \
  '{"oleafly.dictionary.locale":"en_US","oleafly.spellcheck":"1","oleafly.harper":"1","oleafly.liveCollaboration":"0"}' \
  "$(e2e_launch_seed_for e2e/tests/21-library.spec.ts)"
check "a run without a spec keeps live collaboration off" \
  '{"oleafly.dictionary.locale":"en_US","oleafly.spellcheck":"1","oleafly.harper":"1","oleafly.liveCollaboration":"0"}' \
  "$(e2e_launch_seed_for "")"

seed="$(e2e_launch_seed_for e2e/tests/109-live-collaboration-peer.spec.ts)"
parsed="$(SEED="$seed" node -e '
  const seed = JSON.parse(process.env.SEED);
  process.stdout.write([seed["oleafly.liveCollaboration"], seed["oleafly.dictionary.locale"], seed["oleafly.harper"]].join(","));
' 2>&1 || true)"
check "a peer spec turns live collaboration on at launch and keeps the rest" "1,en_US,1" "$parsed"

if ((failures > 0)); then
  echo "$failures e2e spec selection check(s) failed" >&2
  exit 1
fi
echo "all e2e spec selection checks passed"
