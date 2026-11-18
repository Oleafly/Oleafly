#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

env_file=.env.local
if [ ! -f "$env_file" ]; then
  echo "No $env_file here, so there is no stack to stop." >&2
  exit 0
fi

wipe=false
for arg in "$@"; do
  case "$arg" in
    --wipe) wipe=true ;;
    *)
      echo "Usage: down.sh [--wipe]" >&2
      exit 2
      ;;
  esac
done

if $wipe; then
  docker compose --env-file "$env_file" -f compose.yml down --volumes
  rm -f seed-state.json
  echo "Stopped Overleaf CE and deleted its data. The next up.sh seeds it again."
else
  docker compose --env-file "$env_file" -f compose.yml down
  echo "Stopped Overleaf CE. Its data is kept for the next up.sh."
fi
