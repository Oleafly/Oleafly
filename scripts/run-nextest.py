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
RUNS = {
    "workspace": ("nextest", "run", "--workspace", "--all-targets"),
    "lib": ("nextest", "run", "--workspace", "--lib"),
    "cli": ("nextest", "run", "-p", "oleafly-cli", "--test", "cli"),
    "shared": (
        "nextest", "run", "--all-targets",
        "-p", "oleafly-core",
        "-p", "oleafly-cli",
        "-p", "oleafly-sandbox",
        "-p", "oleafly-secrets",
        "-p", "oleafly-online",
        "-p", "oleafly-research",
    ),
    "server-web": (
        "nextest", "run", "-p", "oleafly-server", "--all-targets", "--features", "web",
    ),
    "windows": (
        "nextest", "run", "--workspace", "--exclude", "oleafly-server", "--all-targets",
    ),
    "history-msrv": ("+1.89.0", "nextest", "run", "-p", "oleafly-history", "--all-targets"),
    "coverage": (
        "llvm-cov", "nextest", "--workspace", "--all-targets",
        "--lcov", "--output-path", "coverage/rust/lcov.info",
    ),
}


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
    if len(sys.argv) != 2 or sys.argv[1] not in RUNS:
        print(f"usage: {sys.argv[0]} {{{'|'.join(RUNS)}}}", file=sys.stderr)
        return 2
    cargo = shutil.which("cargo")
    if cargo is None:
        print("cargo is not on PATH", file=sys.stderr)
        return 127

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
            [cargo, *RUNS[sys.argv[1]]],
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
