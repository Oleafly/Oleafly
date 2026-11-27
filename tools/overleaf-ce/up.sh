#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

env_file=.env.local

secret() {
  openssl rand -hex 24
}

if [ ! -f "$env_file" ]; then
  (
    umask 077
    {
      echo "OVERLEAF_CE_PORT=8480"
      echo "OVERLEAF_INVITE_TOKEN_SECRET=$(secret)"
      echo "OVERLEAF_SESSION_SECRET=$(secret)"
    } >"$env_file"
  )
  echo "Wrote $env_file with new secrets."
fi

for user in ALICE BOB CAROL DAVE ERIN; do
  if ! grep -q "^${user}_PASSWORD=" "$env_file"; then
    echo "${user}_PASSWORD=$(secret)" >>"$env_file"
  fi
done

set -a
. "./$env_file"
set +a

compose() {
  docker compose --env-file "$env_file" -f compose.yml "$@"
}

echo "Starting Overleaf CE on http://localhost:${OVERLEAF_CE_PORT} (the first start takes a few minutes)."
compose up -d --wait --wait-timeout 900

output=$(compose exec -T \
  -e ALICE_PASSWORD -e BOB_PASSWORD -e CAROL_PASSWORD -e DAVE_PASSWORD -e ERIN_PASSWORD \
  overleaf bash -c 'source /etc/container_environment.sh && cd /overleaf/services/web && node /oleafly-harness/seed.mjs')

state=$(printf '%s\n' "$output" | sed -n 's/^OLEAFLY_SEED_STATE //p' | tail -n 1)
if [ -z "$state" ]; then
  printf '%s\n' "$output" >&2
  echo "The seed did not report its state." >&2
  exit 1
fi

(
  umask 077
  printf '%s\n' "$state" >seed-state.json
)

printf '%s\n' "$output" | grep '^seed:' || true
echo "Overleaf CE is up at http://localhost:${OVERLEAF_CE_PORT}. Sign in as alice@example.test (a site admin) with ALICE_PASSWORD from $env_file."
echo "Run the live gates against it with: cargo test -p oleafly-online --features ce-e2e --test ce"
echo "Run the command-line live gates against it with: cargo test -p oleafly-cli --features ce-e2e --test remote_live_ce"
