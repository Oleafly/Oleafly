#!/usr/bin/env bash
#
# Run the e2e suite against a real Linux WebKitGTK build, from macOS.
#
#   ./scripts/e2e-linux.sh                          # whole suite
#   ./scripts/e2e-linux.sh e2e/tests/58-*.spec.ts   # one spec
#   ./scripts/e2e-linux.sh --shell                  # a shell inside the image
#
# Why: the Linux CI shards run WebKitGTK under xvfb, which wraps text and
# delivers events differently from macOS's WKWebView. Reproducing a Linux-only
# failure here takes minutes instead of an hour-long CI round trip.
#
# What it does NOT do: emulate macOS or Windows. WKWebView and WebView2 belong
# to their operating systems; a Linux container cannot stand in for either.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="oleafly-linux-e2e"
# Native containers on Apple Silicon; CI's shards are x86_64, so anything
# genuinely architecture-specific will still differ. Override to match CI
# exactly at the cost of emulation:  PLATFORM=linux/amd64 ./scripts/e2e-linux.sh
PLATFORM="${PLATFORM:-}"
if [ -z "$PLATFORM" ]; then
  case "$(uname -m)" in
    arm64|aarch64) PLATFORM=linux/arm64 ;;
    *) PLATFORM=linux/amd64 ;;
  esac
fi
case "$PLATFORM" in
  linux/arm64) TARGET=aarch64-unknown-linux-gnu ;;
  linux/amd64) TARGET=x86_64-unknown-linux-gnu ;;
  *) echo "unsupported PLATFORM $PLATFORM" >&2; exit 2 ;;
esac

# Interactive flags only when there is a terminal, so the script also works
# from a pipe, a CI step, or a background job.
TTY_FLAGS=(-i)
[ -t 0 ] && [ -t 1 ] && TTY_FLAGS=(-i -t)

docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "==> building $IMAGE ($PLATFORM); first time takes a few minutes"
  docker build --platform "$PLATFORM" -t "$IMAGE" -f "$ROOT/scripts/linux-e2e.Dockerfile" "$ROOT"
}

if [ "${1:-}" = "--shell" ]; then
  exec docker run --rm "${TTY_FLAGS[@]}" --platform "$PLATFORM" \
    -v "$ROOT:/work" -v oleafly-linux-cargo:/opt/target \
    "$IMAGE" bash
fi

# node_modules and the Rust target dir live in named volumes: the host copies
# are macOS binaries and would be silently wrong inside the container.
exec docker run --rm "${TTY_FLAGS[@]}" --platform "$PLATFORM" \
  -v "$ROOT:/work" \
  -v oleafly-linux-modules:/work/node_modules \
  -v oleafly-linux-cargo:/opt/target \
  -e OLEAFLY_E2E_TARGET="$TARGET" \
  "$IMAGE" bash -lc '
    set -euo pipefail
    pnpm install --frozen-lockfile
    bash scripts/fetch-tectonic.sh "$OLEAFLY_E2E_TARGET"
    bash scripts/fetch-typst.sh "$OLEAFLY_E2E_TARGET"
    export OLEAFLY_DATA_DIR="$(mktemp -d /tmp/oleafly-linux.XXXXXX)"
    # Same launcher CI uses, under a virtual display.
    xvfb-run -a ./scripts/e2e.sh "$@"
  ' _ "$@"
