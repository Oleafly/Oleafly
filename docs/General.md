# General application surface

General features are the application shell around the editor and document
engines. They provide project lifecycle, navigation, preferences, and local
state without changing the source format.

## Implemented areas

- Project library with engine, document kind, modification, bookmark, and
  preview metadata.
- Create LaTeX, Typst, and Markdown projects from editable templates.
- Nested source tree with create, rename, duplicate, delete, and main-document
  selection operations.
- Autosave with dirty-state and compile-result freshness tracking.
- Command palette and omnibar for project and document actions.
- System, light, and dark appearance using shared design tokens.
- Settings for engines, language servers, AI providers, MCP, shortcuts, and
  downloads.
- Terminal dock with shell tabs that can be renamed and colored per project.
- Local word count, project search, logs, and diagnostic surfaces.
- Update checks through the signed application updater.

## Appearance

Appearance has three choices: System, Light, and Dark. System follows the
operating system and changes when it does, with no restart needed. You can set
it from the theme menu in the toolbar or the home dock, the App tab under
Appearance in settings, the welcome screen, or the command palette.

## Terminal dock

The terminal dock holds one tab per shell session, up to ten per project.
Double click a tab or use the pencil control to rename it in place. Right click
a tab for the same rename, a color from the project cover palette, and the close
actions: this tab, the others, the ones to its right, the ones to its left. A
close action is disabled when nothing sits on that side. The color shows as a
dot before the title and tints the tab while it is active. Titles and colors are
saved per project, so a terminal slot reopens with the name and color it had.
Shift+F10 or the context menu key opens the menu when a tab has focus.

## Local-first policy

Project files, optional Git history, compiled artifacts, indexing, preview
rendering, spellchecking, and preflight remain local unless the user selects a
network operation. The app has no mandatory account or telemetry requirement.

## Engineering anchors

- `src/store/`: application state domains.
- `src/components/library/`: project library and template selection.
- `src/components/settings/`: settings surfaces.
- `src/components/dock/`: terminal dock and its tabs.
- `src/contributions/`: palette, rail, and command registration.
- `src-tauri/src/paths.rs` and `src-tauri/src/sandbox.rs`: path policy.
