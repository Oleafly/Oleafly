# Source control

Every Oleafly project is a normal Git repository. The application adds a
desktop workflow around Git; it does not introduce a proprietary project
format or hide the source from command-line tools.

## Product surface

- Automatic commits after successful compiles and quiet editing periods.
- Commit timeline with unified and side-by-side diffs.
- Restore an individual file from a selected commit.
- Stage, discard, commit, push, and pull from the source-control panel.
- Ahead and behind indicators for the configured remote.
- Publish a project to GitHub or connect an existing repository.
- Continue editing from another editor or terminal without conversion.

## Safety boundaries

- User project paths are resolved through the Rust sandbox before file or Git
  operations.
- Destructive operations are explicit and preserve the application's approval
  policy.
- Git authentication tokens are not passed through shell command arguments.
- The Git transport rejects helper syntax that could execute an unexpected
  command.
- Export destinations are validated independently from project paths.

## Engineering anchors

- `src-tauri/src/git.rs`: Git commands, remotes, authentication, and safety.
- `src-tauri/src/project.rs`: project metadata and export history.
- `src/store/files.ts`: filesystem-backed file state and autosave.
- `src/components/git/` and `src/contributions/tabs.tsx`: product surface.
