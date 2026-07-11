# E2E coverage matrix

Every interactive surface, mapped to the spec that exercises it. Status:
**✓** covered · **🔑** opt-in (env-gated: credentials/network) · **✋ manual**
(native OS dialogs, OS drag-drop, nondeterministic AI output - not
automatable by design) · **—** not yet covered (listed at the bottom).

## Library & projects
| Surface | Interactions | Spec |
| --- | --- | --- |
| Library | welcome state, book grid | 01, 21 |
| Template gallery | open/close, cards, search rail, name+color step, create | 01, 02 |
| Book | open project, favorite toggle (hover-revealed) | 02, 21 |
| Book context menu | fork (unique name), delete (scoped confirm override) | 21 |
| Project rename (toolbar inline) | edit, save, revert | 22 |
| Back to library / reopen | | 22 |
| Change book color / open via Enter | | — (low risk; color is cosmetic) |

## Editor
| Surface | Interactions | Spec |
| --- | --- | --- |
| CodeMirror | typing (anchored, real input), content round-trip across files | 03, 08 |
| Toolbar | bold on selection (synthetic mouse-drag), undo/redo, insert figure/table, add-citation dialog | 16 |
| Context menu | opens with AI/code-intel items, insert equation | 16 |
| File tabs | created by file switching | 08 |
| File tree | new file, open, switch | 08 |
| Outline | section listed | 08 |
| Spellcheck/dictionary | squiggle -> hover tooltip -> ignore -> settings chip -> un-ignore -> squiggle returns | 14 |
| Code intel: go-to-definition, find-references, rename dialog | context menu + Shift+F12, real index over a seeded label/ref pair | 23 |
| File tree rename/delete via context menu | | ✋ known-flaky under synthetic pointer events (26 fixme; verified manually) |
| Inline AI (Cmd+L) | provider-gated | ✋ [ai] |
| Heading/list popovers, link/ref buttons | | — (menu plumbing shared with tested paths) |

## Compile & preview
| Surface | Interactions | Spec |
| --- | --- | --- |
| Compile | button + Cmd+Enter, zero-error status chip, PDF renders | 02, 10 |
| Error loop | break -> error status -> fix -> recover | 11 |
| Logs tab | real log shown, copy-log feedback | 11, 17 |
| Zoom / layout / page nav / invert | 17 |
| Save PDF into project | in-app dialog -> file in tree | 17 |
| SyncTeX forward (Cmd+Shift+J) | highlight appears on PDF | 10 |
| SyncTeX inverse (Cmd-click PDF) | Cmd-click via text-layer coordinates lands the caret on the word | 24 |
| Fullscreen, detached preview window, export saves | | ✋ [native] |
| Export menu | opens, all formats listed per doc type | 22 |

## Diagram composer
| Surface | Interactions | Spec |
| --- | --- | --- |
| Open/close, starter compile -> preview | 06 |
| Palette place shape, node select -> inspector, canvas theme, minimap | 19 |
| Code tab + TikZ snippets | 19 |
| Insert as code -> document + figures/*.tikz | 19 |
| Insert as image, save-as-project, load-existing, Fix with AI | | — image variant / 🔑 [ai] |
| Image projects (kind=image) | tailored rail/toolbar, figure compile, save-image control | 25 |
| Color pickers (fill/border/background) | | ✋ [native] |

## Rail, commands, settings
| Surface | Interactions | Spec |
| --- | --- | --- |
| Rail tabs + panels (files/search/git/preflight/refs/ai) | visibility, panel render, collapsed-sidebar recovery | 05 |
| Command palette | open, full command inventory, run (theme), filter | 04, 07 |
| Omnibar | open, keyword commands, /docs, /projects search | 04, 09 |
| Shortcuts | Cmd+K, Cmd+Shift+F, Cmd+Enter, Cmd+Shift+J, Cmd+/ | 04, 09, 10 |
| Hotkeys reference | open + search filter | 10, 18 |
| Word count / History / About modals | open/close | 18 |
| Settings modal | all sections render, toggle effect (compile label), persistence across restart (vim) | 07 |
| Settings dictionary section | chip remove round-trip | 14 |
| Fonts (Offline & Downloads) | download -> installed -> remove (hermetic assets dir) | 15 |
| TinyTeX engine install | | 🔑 [net, ~100MB] |
| Editor font size select | restyles CodeMirror live, restores | 27 |
| Dark-mode toggle in settings | flips the real theme | 27 |
| Reset to defaults, app-font/accent selects | | — (cosmetic) |

## Git & GitHub
| Surface | Interactions | Spec |
| --- | --- | --- |
| Unconnected gate | onboarding panel asserted | 12 |
| Stage / diff / commit | `E2E_GITHUB_TOKEN` connects via PAT then full flow | 12 🔑 |
| Push to origin | `E2E_GIT_PUSH=1` | 12 🔑 |
| Device-flow connect, publish dialog, pull, discard | | 🔑 (same gate; extend 12 as needed) |
| History modal | opens (restore is destructive; manual) | 18 / ✋ |

## Preflight & AI
| Surface | Interactions | Spec |
| --- | --- | --- |
| Preflight tab visibility (tex vs image project) | 05 |
| Per-category independent Run | 13 |
| Reader view, prep-export apply, tagged compile | | — / 🔑 [engine] |
| AI keyless onboarding (connect buttons -> settings AI) | 20 |
| AI conversations, tool approvals, figure generation | | ✋ [ai] nondeterministic |

## Known manual-only checks
OS drag-and-drop into the window; native save/open dialogs (exports); native
color pickers; fullscreen; the detached preview window; auto-updater; AI
conversations end-to-end. These are exercised by release smoke-testing.
