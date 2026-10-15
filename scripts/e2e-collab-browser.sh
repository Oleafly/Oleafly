#!/usr/bin/env bash
set -euo pipefail

url="${1:?usage: e2e-collab-browser.sh <sign-in page>}"
exec curl --silent --show-error --location --max-redirs 10 --max-time 60 --output /dev/null "$url"
