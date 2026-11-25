import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("sync", Path(__file__).with_name("sync-upstream.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class MergePolicyTests(unittest.TestCase):
    def test_stable_versions_exclude_prereleases_and_invalid_refs(self):
        self.assertEqual(sync.stable_version("v0.4.14"), (0, 4, 14))
        for tag in ["v0.4.14-rc.1", "v0.4.14-noai.1", "--help", "../v1.0.0"]:
            self.assertIsNone(sync.stable_version(tag))

    def test_removal_policy_does_not_cover_shared_code(self):
        policy = {"directories": ["src/components/ai/"], "files": ["src/lib/ai-route.ts"]}
        self.assertTrue(sync.removed("src/components/ai/new-feature.ts", policy))
        self.assertTrue(sync.removed("src/lib/ai-route.ts", policy))
        self.assertFalse(sync.removed("src/components/editor/CodeMirrorEditor.tsx", policy))
        self.assertFalse(sync.removed("src/components/ai-editor.tsx", policy))


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.state = self.root / "fork/upstream.json"
        for name, value in [("ROOT", self.root), ("STATE", self.state)]:
            patcher = patch.object(sync, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.dict(sync.os.environ, {"GITHUB_REPOSITORY": "owner/fork"})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.root / "ai").mkdir()
        (self.root / "ai/old.ts").write_text("AI v1\n")
        (self.root / "editor.ts").write_text("editor v1\n")
        self.commit("base")
        self.git("branch", "upstream")
        (self.root / "fork").mkdir()
        self.state.write_text(json.dumps({"repository": "source/app", "fork": "owner/fork", "branch": "main",
                                         "upstreamTag": "v1.0.0", "releaseTag": "v1.0.0-noai.1"}))
        (self.root / "fork/removed-paths.json").write_text(json.dumps({"directories": ["ai/"], "files": []}))
        self.git("rm", "ai/old.ts")
        self.commit("remove AI")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, text=True, check=True, capture_output=True).stdout.strip()

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-m", message)

    def prepare(self):
        with patch.object(sync, "output") as output:
            sync.prepare()
        return output.call_args[1]

    def test_bootstrap_requires_checks_before_creating_first_tag(self):
        self.assertEqual(self.prepare(), {"ready": True, "dispatch": True, "tag": "v1.0.0-noai.1"})
        self.assertEqual(self.git("tag"), "")

    def test_unpublished_release_is_retried_only_when_no_run_exists(self):
        self.git("tag", "v1.0.0-noai.1")
        for runs, dispatch in [([], True), ([{"display_title": "Release v1.0.0-noai.1", "status": "in_progress"}], False)]:
            with patch.object(sync, "api", side_effect=[None, {"workflow_runs": runs}]):
                self.assertEqual(self.prepare()["dispatch"], dispatch)
        with patch.object(sync, "api", side_effect=[None, {"workflow_runs": [{"display_title": "Release v1.0.0-noai.1", "status": "completed"}]}]):
            with self.assertRaisesRegex(RuntimeError, "not published"):
                self.prepare()

    def merge_upstream(self, conflict=False):
        if conflict:
            (self.root / "editor.ts").write_text("fork editor\n")
            self.commit("fork editor change")
        self.git("tag", "v1.0.0-noai.1")
        self.git("checkout", "upstream")
        (self.root / "ai/old.ts").write_text("AI v2\n")
        (self.root / "ai/new.ts").write_text("new AI module\n")
        (self.root / "editor.ts").write_text("editor v2\n")
        self.commit("upstream release")
        upstream = self.git("rev-parse", "HEAD")
        self.git("checkout", "main")
        original_run = sync.run
        fetched = []
        def run(*args, **kwargs):
            if args[:2] == ("git", "fetch"):
                fetched.append(args[-1])
                return original_run("git", "update-ref", args[-1].split(":")[1], upstream)
            return original_run(*args, **kwargs)
        releases = [{"tag_name": tag, "draft": False, "prerelease": False}
                    for tag in ["v1.2.0", "v1.1.0", "v1.3.0-rc.1"]]
        with patch.object(sync, "run", side_effect=run), patch.object(sync, "api", side_effect=[{"draft": False}, releases]):
            result = self.prepare()
        self.assertEqual(fetched, ["refs/tags/v1.1.0:refs/no-ai/upstream/v1.1.0"])
        return result

    def test_merge_preserves_deleted_ai_and_new_editor_code(self):
        result = self.merge_upstream()
        self.assertEqual(result["tag"], "v1.1.0-noai.1")
        self.assertFalse((self.root / "ai").exists())
        self.assertEqual((self.root / "editor.ts").read_text(), "editor v2\n")
        self.assertEqual(self.git("diff", "--name-only", "--diff-filter=U"), "")

    def test_shared_conflict_is_never_resolved_or_published_automatically(self):
        with self.assertRaisesRegex(RuntimeError, "Shared-file merge conflicts"):
            self.merge_upstream(conflict=True)
        self.assertEqual(self.git("diff", "--name-only", "--diff-filter=U"), "editor.ts")
        self.assertEqual(json.loads(self.state.read_text())["releaseTag"], "v1.0.0-noai.1")
        self.assertNotIn("v1.1.0-noai.1", self.git("tag"))


if __name__ == "__main__":
    unittest.main()
