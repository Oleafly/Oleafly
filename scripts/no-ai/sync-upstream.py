#!/usr/bin/env python3
"""Merge an upstream release. This never rewrites source code or resolves shared-file conflicts."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / "fork/upstream.json"


def run(*args, check=True):
    return subprocess.run(args, cwd=ROOT, check=check, text=True, capture_output=True)


def git(*args):
    return run("git", *args).stdout.strip()


def api(path):
    result = run("gh", "api", path, check=False)
    if result.returncode:
        if "HTTP 404" in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


def output(**values):
    lines = "".join(f"{key}={str(value).lower() if isinstance(value, bool) else value}\n" for key, value in values.items())
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as target:
            target.write(lines)
    print(lines, end="")


def stable_version(tag):
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", tag)
    return tuple(map(int, match.groups())) if match else None


def removed(path, policy):
    return path in policy["files"] or any(path.startswith(prefix) for prefix in policy["directories"])


def prepare():
    state = json.loads(STATE.read_text())
    repo = state["fork"]
    if os.environ.get("GITHUB_REPOSITORY", repo) != repo:
        raise RuntimeError("This workflow belongs to the configured no-AI fork.")
    if git("status", "--porcelain"):
        raise RuntimeError("Start with a clean checkout.")
    tag = state["releaseTag"]
    tagged = run("git", "rev-parse", "--verify", f"refs/tags/{tag}", check=False)
    if tagged.returncode:
        # Bootstrap the current no-AI version after its first push.
        output(ready=True, dispatch=True, tag=tag)
        return
    release = api(f"repos/{repo}/releases/tags/{tag}")
    if release is None or release["draft"]:
        # A workflow dispatched on main can have a different head SHA from the
        # immutable release tag. Identify the run by its explicit release title.
        runs = api(f"repos/{repo}/actions/workflows/release.yml/runs?per_page=100")["workflow_runs"]
        runs = [r for r in runs if r["display_title"] == f"Release {tag}"]
        if any(r["status"] != "completed" for r in runs):
            output(ready=False, dispatch=False, tag=tag)
            return
        if runs:
            raise RuntimeError(f"{tag} is not published. Fix/re-run its release workflow before advancing.")
        output(ready=False, dispatch=True, tag=tag)
        return
    releases = []
    for page in range(1, 11):
        batch = api(f"repos/{state['repository']}/releases?per_page=100&page={page}")
        releases.extend(batch)
        if len(batch) < 100:
            break
    current = stable_version(state["upstreamTag"])
    candidates = [r for r in releases if not r["draft"] and not r["prerelease"]
                  and stable_version(r["tag_name"]) and stable_version(r["tag_name"]) > current]
    if not candidates:
        output(ready=False, dispatch=False)
        return
    # Process each release, oldest first, without skipping a version.
    candidate = min(candidates, key=lambda r: stable_version(r["tag_name"]))
    upstream_tag = candidate["tag_name"]
    remote_ref = f"refs/no-ai/upstream/{upstream_tag}"
    git("fetch", "--no-tags", f"https://github.com/{state['repository']}.git", f"refs/tags/{upstream_tag}:{remote_ref}")
    commit = git("rev-parse", f"{remote_ref}^{{commit}}")
    policy = json.loads((ROOT / "fork/removed-paths.json").read_text())
    merged = run("git", "merge", "--no-ff", "--no-commit", commit, check=False)
    conflicts = git("diff", "--name-only", "--diff-filter=U").splitlines()
    for path in conflicts:
        if removed(path, policy):
            git("rm", "-f", "--", path)
    unresolved = git("diff", "--name-only", "--diff-filter=U").splitlines()
    if unresolved:
        raise RuntimeError("Shared-file merge conflicts require review:\n" + "\n".join(unresolved))
    if merged.returncode and not conflicts:
        raise RuntimeError(merged.stderr or merged.stdout)
    # New files inside explicitly removed AI modules also remain deleted.
    tracked = git("ls-files").splitlines()
    for path in tracked:
        if removed(path, policy):
            git("rm", "-f", "--", path)
    state.update(upstreamTag=upstream_tag, upstreamCommit=commit,
                 releaseTag=f"v{'.'.join(map(str, stable_version(upstream_tag)))}-noai.1")
    STATE.write_text(json.dumps(state, indent=2) + "\n")
    git("add", "fork/upstream.json")
    output(ready=True, dispatch=True, tag=state["releaseTag"])


def publish_merge():
    state = json.loads(STATE.read_text())
    if git("diff", "--name-only", "--diff-filter=U"):
        raise RuntimeError("Unresolved merge conflicts.")
    if git("status", "--porcelain"):
        git("add", "-A")
        git("commit", "-m", f"Merge upstream {state['upstreamTag']} without AI")
    tag = state["releaseTag"]
    git("tag", "-a", tag, "-m", f"Oleafly No AI — {state['upstreamTag']}")
    # No force-push: a concurrent human change makes this fail, preserving main.
    git("push", "--atomic", "origin", f"HEAD:refs/heads/{state['branch']}", f"refs/tags/{tag}")


if __name__ == "__main__":
    try:
        {"prepare": prepare, "publish-merge": publish_merge}[sys.argv[1]]()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
