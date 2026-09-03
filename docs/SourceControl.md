# Source control

An Oleafly project can use a normal Git repository. Oleafly does not hide the
source from command-line tools.

By default a new project is also a Git repository. Oleafly runs `git init` in
the project folder when it creates or imports the project, and again the first
time you open a project that has no repository yet, so the Git panel can show
changes without a setup step. Nothing is staged and nothing is committed; that
still only happens when you ask for it in the panel. Oleafly leaves the folder
alone when it already sits inside another repository, and if `git` is not
installed the attempt is written to the app log and the project opens as
usual. You can turn this off in Settings, under Integrations and then GitHub,
with **Initialise Git for every project**. With the switch off, Source Control
starts only when you press **Initialize Repository** or publish to GitHub, or
when an imported project already carries its own repository.

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
- Saving, compiling, and closing a project never touch Git. Opening a project
  only ever runs `git init`, and only while the setting above is on; it never
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
