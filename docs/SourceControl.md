# Source control

An Oleafly project can use a normal Git repository. Oleafly does not hide the
source from command-line tools.

By default a new project is also a Git repository. When Oleafly creates or
imports a project, it runs `git init` in the project folder and records the
project's files as one first commit, "Create project". The Git panel then shows
real differences from the start, and research tasks can work in their own Git
worktree. That first commit runs with hooks, commit signing and the fsmonitor
turned off, so a global hook or a signing prompt cannot block project creation.
If the files add up to more than 100 MB, or the commit fails for any other
reason, the repository is left with nothing staged, the reason goes to the app
log, and the project is created as usual.

Opening a project that has no repository yet only runs `git init`. It stages
nothing and commits nothing. After the first commit, Oleafly commits only when
you ask for it in the panel. Oleafly leaves the folder alone when it already
sits inside another repository or was opened in place. You can turn all of this
off in Settings, under Integrations and then GitHub, with **Initialise Git for
every project**. With the switch off, Source Control starts only when you press
**Initialize Repository** or publish to GitHub, or when an imported project
already carries its own repository.

<div align="center">
  <img src="assets/readme/source-control.png" alt="Oleafly Source Control panel showing staged changes, a branch graph, and commit controls" width="100%" />
</div>
<p align="center"><em>Use normal Git operations beside the manuscript, with the repository state in view.</em></p>

## When Git is not installed

Oleafly uses the Git installed on your computer. Once it finds Git, it keeps
using it for the session; while Git is missing, it looks again every few
seconds, so a refresh picks up a new install. On a Mac, the `/usr/bin/git`
placeholder counts as missing until Apple's command line tools are installed,
so Oleafly never triggers the macOS install prompt on its own. Without Git,
projects are created and opened as usual, the missing program is written to the
app log once per session, and Source Control explains how to install Git
instead of offering buttons that would fail:

- Windows: install [Git for Windows](https://git-scm.com/downloads/win), then
  restart Oleafly.
- macOS: run `xcode-select --install` in Terminal, then refresh the panel.
- Linux: install the `git` package with your package manager, then refresh the
  panel.

## Product surface

- One first commit when Oleafly creates a project; every later commit is yours.
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
  creates a commit. Creating or importing a project makes the single first
  commit described above.
- Oleafly keeps its own files and common clutter out of Git through the
  repository's private exclude file (`.git/info/exclude`), and never edits the
  project's `.gitignore`. The exclude file lists `.oleafly/`, `.DS_Store`,
  `Thumbs.db`, `desktop.ini`, `_minted-*/`, `pythontex-files-*/`, and the TeX
  build output that other tools write next to the sources (`*.aux`, `*.log`,
  `*.out`, `*.toc`, `*.blg`, `*.bcf`, `*.run.xml`, `*.fls`, `*.fdb_latexmk`,
  `*.synctex.gz`, `*.synctex(busy)`, `*.nav`, `*.snm`, `*.vrb`, `*.lof`, `*.lot`,
  `*.idx`, `*.ilg`, `*.ind`, `*.xdv`). `.bbl` files stay visible, because arXiv
  sources ship them as their bibliography. Missing lines are added whenever
  Oleafly creates a repository or stages all changes, so repositories made by
  older versions catch up. A rule in the project's own `.gitignore` still wins.
- Git authentication tokens are not passed through shell command arguments.
- The Git transport rejects helper syntax that could execute an unexpected
  command.
- Export destinations are validated independently from project paths.

## Engineering anchors

- `src-tauri/src/git.rs`: Git commands, remotes, authentication, and safety.
- `src-tauri/src/project.rs`: project metadata and export history.
- `src/store/files.ts`: filesystem-backed file state and autosave.
- `src/components/git/` and `src/contributions/tabs.tsx`: product surface.
