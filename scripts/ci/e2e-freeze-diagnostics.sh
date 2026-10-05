#!/usr/bin/env bash
set -u

out="${1:?usage: e2e-freeze-diagnostics.sh <output-dir>}"
mkdir -p "$out" || exit 0

{
  date -u
  ps -eLo pid,tid,ppid,stat,pcpu,wchan:32,comm | grep -iE "oleafly|webkit|  PID"
} > "$out/threads.txt" 2>&1

gdb_cmd=(gdb)
if [ "$(id -u)" != 0 ] && sudo -n true 2>/dev/null; then
  gdb_cmd=(sudo -n gdb)
fi
command -v gdb >/dev/null 2>&1 || exit 0

for pid in $(pgrep -x oleafly-desktop) $(pgrep -f WebKitWebProcess) $(pgrep -f WebKitNetworkProcess); do
  timeout 45 "${gdb_cmd[@]}" -p "$pid" -batch -nx \
    -ex "set pagination off" -ex "set debuginfod enabled off" \
    -ex "info threads" -ex "thread apply all bt 40" > "$out/backtrace-$pid.txt" 2>&1
done

sleep 5
ps -eLo pid,tid,ppid,stat,pcpu,wchan:32,comm | grep -iE "oleafly|webkit|  PID" > "$out/threads-5s-later.txt" 2>&1
exit 0
