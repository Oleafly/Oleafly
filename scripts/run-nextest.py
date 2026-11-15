#!/usr/bin/env python3

import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

ANSI = re.compile(rb"\x1b\[[0-9;]*m")
RUN_ID = re.compile(rb"\bNextest run ID ([0-9a-fA-F-]{36})\b")
STALE_AFTER = 24 * 60 * 60


def remove_stale_runs(root):
    cutoff = time.time() - STALE_AFTER
    try:
        entries = list(root.iterdir())
    except FileNotFoundError:
        return
    for entry in entries:
        if entry.is_symlink() or not entry.is_dir():
            continue
        try:
            stale = entry.stat().st_mtime < cutoff
        except FileNotFoundError:
            continue
        if stale:
            shutil.rmtree(entry, ignore_errors=True)


def main():
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} COMMAND [ARG ...]", file=sys.stderr)
        return 2

    root = Path(tempfile.gettempdir()) / "oleafly-test-data"
    try:
        os.makedirs(root, mode=0o700, exist_ok=True)
        metadata = os.lstat(root)
        owned = stat.S_ISDIR(metadata.st_mode) and (
            not hasattr(os, "getuid") or metadata.st_uid == os.getuid()
        )
    except OSError:
        owned = False
    if owned:
        remove_stale_runs(root)
    else:
        print(f"not cleaning {root}: not a directory you own", file=sys.stderr)
    env = os.environ.copy()
    if sys.stdout.isatty():
        env.setdefault("CARGO_TERM_COLOR", "always")
    run_id = None
    process = None
    try:
        process = subprocess.Popen(
            sys.argv[1:],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=-1,
        )
        for line in process.stdout:
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
            if run_id is None:
                match = RUN_ID.search(ANSI.sub(b"", line))
                if match:
                    run_id = match.group(1).decode("ascii")
        return process.wait()
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if run_id is not None and owned:
            shutil.rmtree(os.path.join(root, run_id), ignore_errors=True)
        if owned:
            try:
                os.rmdir(root)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
