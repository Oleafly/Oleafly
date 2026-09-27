#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIND="$ROOT/scripts/ci/find-linux-app-binary.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oleafly-find-app.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

failures=0

package() {
  local name="$1" exec_line="$2"
  shift 2
  local root="$WORK/$name"
  mkdir -p "$root/usr/bin" "$root/usr/share/applications"
  printf '%s\n' / /usr /usr/bin /usr/share /usr/share/applications >"$root.list"
  local binary
  for binary in "$@"; do
    mkdir -p "$root$(dirname "$binary")"
    printf '#!/bin/sh\n' >"$root$binary"
    chmod 755 "$root$binary"
    printf '%s\n' "$binary" >>"$root.list"
  done
  if [[ -n "$exec_line" ]]; then
    printf '[Desktop Entry]\nName=Oleafly\n%s\nType=Application\n' "$exec_line" \
      >"$root/usr/share/applications/Oleafly.desktop"
    printf '%s\n' /usr/share/applications/Oleafly.desktop >>"$root.list"
  fi
}

expect_app() {
  local name="$1" expected="$2" found
  if found="$(bash "$FIND" "$WORK/$name.list" "$WORK/$name" 2>"$WORK/$name.err")" \
    && [[ "$found" == "$expected" ]]; then
    echo "ok   $name -> $found"
  else
    echo "FAIL $name: expected '$expected', got '${found:-}'" >&2
    sed 's/^/     /' "$WORK/$name.err" >&2
    failures=$((failures + 1))
  fi
}

expect_refusal() {
  local name="$1" reason="$2"
  if bash "$FIND" "$WORK/$name.list" "$WORK/$name" >"$WORK/$name.out" 2>"$WORK/$name.err"; then
    echo "FAIL $name: expected a refusal, got '$(cat "$WORK/$name.out")'" >&2
    failures=$((failures + 1))
  elif grep -q "$reason" "$WORK/$name.err"; then
    echo "ok   $name refused: $(head -n 1 "$WORK/$name.err")"
  else
    echo "FAIL $name: refusal did not mention '$reason'" >&2
    sed 's/^/     /' "$WORK/$name.err" >&2
    failures=$((failures + 1))
  fi
}

package renamed "Exec=oleafly-desktop" \
  /usr/bin/tectonic /usr/bin/oleafly-cli /usr/bin/oleafly-desktop /usr/bin/typst
expect_app renamed /usr/bin/oleafly-desktop

package with-command "Exec=oleafly-desktop" \
  /usr/bin/oleafly /usr/bin/oleafly-cli /usr/bin/oleafly-desktop /usr/bin/tectonic
expect_app with-command /usr/bin/oleafly-desktop

package absolute "Exec=/usr/bin/oleafly-desktop %F" /usr/bin/oleafly-desktop /usr/bin/oleafly-cli
expect_app absolute /usr/bin/oleafly-desktop

package quoted 'Exec="/opt/Oleafly App/oleafly-desktop" %F' "/opt/Oleafly App/oleafly-desktop"
expect_app quoted "/opt/Oleafly App/oleafly-desktop"

package old-name "Exec=oleafly" /usr/bin/tectonic /usr/bin/oleafly
expect_refusal old-name "command-line tool"

package no-entry "" /usr/bin/oleafly-desktop
expect_refusal no-entry "no desktop entry"

package not-shipped "Exec=oleafly-desktop" /usr/bin/tectonic
expect_refusal not-shipped "oleafly-desktop"

package not-executable "Exec=oleafly-desktop" /usr/bin/oleafly-desktop
chmod 644 "$WORK/not-executable/usr/bin/oleafly-desktop"
expect_refusal not-executable "not executable"

package empty-exec "Exec=" /usr/bin/oleafly-desktop
expect_refusal empty-exec "no program"

: >"$WORK/empty.list"
mkdir -p "$WORK/empty"
expect_refusal empty "no desktop entry"

if bash "$FIND" >/dev/null 2>&1; then
  echo "FAIL usage: ran without a file list" >&2
  failures=$((failures + 1))
else
  echo "ok   usage refused"
fi

if ((failures > 0)); then
  echo "$failures case(s) failed" >&2
  exit 1
fi
echo "all cases passed"
