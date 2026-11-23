#!/usr/bin/env python3

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(__file__).with_name("run-nextest.py")
RUN_ID = "12345678-1234-1234-1234-123456789abc"
FAKE_CARGO = r"""import os
from pathlib import Path
import sys

Path(os.environ["FAKE_CARGO_ARGS"]).write_text("\n".join(sys.argv[1:]))
run_id = os.environ["FAKE_CARGO_RUN_ID"]
if run_id:
    run = Path(os.environ["TMPDIR"]) / "oleafly-test-data" / run_id
    run.mkdir(parents=True)
    (run / "child").mkdir()
os.write(1, b"\xff")
if run_id:
    print(f"\x1b[32;1m Nextest run\x1b[0m ID \x1b[1m{run_id}\x1b[0m with nextest profile: \x1b[1mci\x1b[0m")
raise SystemExit(int(os.environ["FAKE_CARGO_STATUS"]))
"""


def install_fake_cargo(root):
    tools = root / "bin"
    tools.mkdir()
    script = tools / "fake_cargo.py"
    script.write_text(FAKE_CARGO)
    if os.name == "nt":
        (tools / "cargo.cmd").write_text(
            f'@"{sys.executable}" "{script}" %*\n@exit /b %ERRORLEVEL%\n'
        )
    else:
        launcher = tools / "cargo"
        launcher.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n')
        launcher.chmod(0o700)
    return tools


class RunNextestTests(unittest.TestCase):
    def run_wrapper(self, root, exit_status=0, run_id=RUN_ID, run="workspace"):
        env = os.environ.copy()
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PATH"] = str(install_fake_cargo(root)) + os.pathsep + env.get("PATH", "")
        env["FAKE_CARGO_ARGS"] = str(root / "cargo-args")
        env["FAKE_CARGO_RUN_ID"] = run_id or ""
        env["FAKE_CARGO_STATUS"] = str(exit_status)
        for name in ("TMPDIR", "TEMP", "TMP"):
            env[name] = str(root)
        return subprocess.run(
            [sys.executable, str(SCRIPT), run],
            env=env,
            capture_output=True,
        )

    def test_runs_cargo_with_the_named_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_wrapper(root, run="cli")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                (root / "cargo-args").read_text().splitlines(),
                ["nextest", "run", "-p", "oleafly-cli", "--test", "cli"],
            )

    def test_unknown_run_starts_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_wrapper(root, run="echo")

            self.assertEqual(result.returncode, 2)
            self.assertIn(b"usage:", result.stderr)
            self.assertFalse((root / "cargo-args").exists())

    def test_success_cleans_its_run_and_only_stale_runs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "oleafly-test-data"
            stale = data / "stale"
            active = data / "active"
            stale.mkdir(parents=True)
            active.mkdir()
            old = time.time() - 3 * 24 * 60 * 60
            os.utime(stale, (old, old))

            result = self.run_wrapper(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout.startswith(b"\xff"))
            self.assertIn(RUN_ID.encode(), result.stdout)
            self.assertFalse((data / RUN_ID).exists())
            self.assertFalse(stale.exists())
            self.assertTrue(active.is_dir())

    def test_failure_status_is_preserved_and_run_is_cleaned(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_wrapper(root, exit_status=23)

            self.assertEqual(result.returncode, 23, result.stderr)
            self.assertFalse((root / "oleafly-test-data" / RUN_ID).exists())

    def test_empty_parent_is_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_wrapper(root, run_id=None)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / "oleafly-test-data").exists())

    def test_symlinked_root_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            old = target / "old"
            old.mkdir(parents=True)
            link = root / "oleafly-test-data"
            try:
                link.symlink_to(target, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlinks unavailable: {error}")

            result = self.run_wrapper(root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(link.is_symlink())
            self.assertTrue(old.is_dir())
            self.assertTrue((target / RUN_ID / "child").is_dir())
            self.assertIn(b"not cleaning", result.stderr)

    def test_broken_symlink_does_not_abort_the_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            link = root / "oleafly-test-data"
            try:
                link.symlink_to(root / "missing", target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlinks unavailable: {error}")

            result = self.run_wrapper(root, run_id=None)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(link.is_symlink())
            self.assertIn(b"not cleaning", result.stderr)

    def test_regular_file_root_does_not_abort_the_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            file = root / "oleafly-test-data"
            file.write_text("keep")

            result = self.run_wrapper(root, run_id=None)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(file.read_text(), "keep")
            self.assertIn(b"not cleaning", result.stderr)

if __name__ == "__main__":
    unittest.main()
