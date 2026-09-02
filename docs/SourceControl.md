# Source control

An Oleafly project can use a normal Git repository. Source Control starts only
when you choose **Initialize Repository**, publish to GitHub, or open an
imported project that already contains a repository. Oleafly does not hide the
source from command-line tools.

## Product surface

- Explicit repository initialization and commits.
- Unified and side-by-side diffs for changes in the working tree.
- Stage, discard, commit, push, and pull from the source-control panel.
- Ahead and behind indicators for the configured remote.
- Publish a project to GitHub or connect an existing repository.
- Continue editing from another editor or terminal without conversion.

## Safety boundaries

- User project paths are resolved through the Rust sandbox before file or Git
  operations.
- Destructive operations are explicit and preserve the application's approval
  policy.
- Opening, saving, compiling, and closing a project never initializes Git or
  creates a commit.
- `.oleafly/` is excluded through the repository's private Git metadata. Oleafly
  does not edit the project's `.gitignore` when Source Control is initialized.
- Git authentication tokens are not passed through shell command arguments.
- The Git transport rejects helper syntax that could execute an unexpected
  command.
- Export destinations are validated independently from project paths.

## Engineering anchors

- `src-tauri/src/git.rs`: Git commands, remotes, authentication, and safety.
- `src-tauri/src/project.rs`: project metadata and export history.
- `src/store/files.ts`: filesystem-backed file state and autosave.
- `src/components/git/` and `src/contributions/tabs.tsx`: product surface.
