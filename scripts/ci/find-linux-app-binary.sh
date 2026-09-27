#!/usr/bin/env bash
set -euo pipefail

list="${1:-}"
root="${2:-}"
if [[ -z "$list" ]] || [[ ! -f "$list" ]]; then
  echo "usage: $0 <installed-files.txt> [root]" >&2
  exit 2
fi

desktop=""
while IFS= read -r entry || [[ -n "$entry" ]]; do
  case "$entry" in
    /usr/share/applications/*.desktop)
      desktop="$entry"
      break
      ;;
    *) ;;
  esac
done <"$list"
if [[ -z "$desktop" ]] || [[ ! -f "$root$desktop" ]]; then
  echo "find-app: the package installs no desktop entry under /usr/share/applications" >&2
  exit 1
fi

exec_line=""
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    Exec=*)
      exec_line="${line#Exec=}"
      break
      ;;
    *) ;;
  esac
done <"$root$desktop"

case "$exec_line" in
  \"*)
    program="${exec_line#\"}"
    program="${program%%\"*}"
    ;;
  *) program="${exec_line%% *}" ;;
esac
if [[ -z "$program" ]]; then
  echo "find-app: $desktop names no program on its Exec line" >&2
  exit 1
fi

app=""
if [[ "$program" == /* ]]; then
  app="$program"
else
  while IFS= read -r entry || [[ -n "$entry" ]]; do
    case "$entry" in
      */bin/"$program")
        app="$entry"
        break
        ;;
      *) ;;
    esac
  done <"$list"
fi
if [[ -z "$app" ]] || ! grep -Fqx -- "$app" "$list"; then
  echo "find-app: $desktop launches '$program', which the package does not install" >&2
  exit 1
fi
if [[ ! -f "$root$app" ]] || [[ ! -x "$root$app" ]]; then
  echo "find-app: $app is not executable" >&2
  exit 1
fi
if [[ "$(basename "$app")" == "oleafly" ]]; then
  echo "find-app: the app installs itself as $app, the name the command-line tool owns" >&2
  exit 1
fi

printf '%s\n' "$app"
