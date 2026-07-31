# Desktop localization decision record

**Status:** Proposed. Owner approval is required before implementation.

**Recorded:** 2026-07-27

**Accountable owner:** Prajwal S Venkateshmurthy

This record covers only localization of the Oleafly desktop application in this
repository. It does not authorize localization work in another repository or
product surface.

This record does not approve the desktop choices below. Each recommendation
remains pending until the accountable owner records approval in a pull request,
issue, or an update to this document.

The owner assignment is based on repository evidence.
[`package.json`](../package.json) names Prajwal S Venkateshmurthy as the author,
and
[`CITATION.cff`](../CITATION.cff) identifies Prajwal S Venkateshmurthy as the
software author. Repository history also identifies the same maintainer as the
primary contributor.

## Decision summary

| Product decision | Recommended default | Status | Accountable owner |
| --- | --- | --- | --- |
| First real target locale | Spanish, using the `es` locale | Pending owner approval | Prajwal S Venkateshmurthy |
| Real RTL locale in the first desktop release | No. Test with `ar-XB` and defer a shipping RTL locale | Pending owner approval | Prajwal S Venkateshmurthy |
| Translation management | Weblate with dedicated reviewers and approved-only catalog sync | Pending owner approval | Prajwal S Venkateshmurthy |
| Desktop template boundary | Localize desktop-owned metadata only. Do not translate starter content | Pending owner approval | Prajwal S Venkateshmurthy |

## Recommendations and approval conditions

### 1. First real target locale

**Recommendation:** Use Spanish with the BCP 47 tag `es` as the first real
target locale.

This is a provisional engineering default, not a demand-backed product
selection. The repository has no usage analytics, language requests, or named
Spanish reviewer from which to make a final choice. Spanish gives the first
release a real non-English catalog while keeping the first language rollout
separate from the additional layout work required by a real RTL language.

Approval requires:

- First-party evidence that Spanish is a useful initial language for current or
  expected users.
- One named fluent Spanish reviewer who accepts responsibility for all shipping
  application copy.
- Agreement on neutral product terminology for `es`. Oleafly will not claim
  separate regional variants such as `es-MX` or `es-ES`.
- A support path for Spanish-language bug reports.

If those conditions cannot be met, do not choose another language based only on
machine translation cost or total speaker count. Select the highest-demand
locale for which Oleafly can name a qualified reviewer.

Locale resolution may map a device locale such as `es-MX` to the supported
`es` catalog. That fallback does not create a separately supported regional
locale.

### 2. Real RTL locale

**Recommendation:** Do not ship a real RTL locale in the first localized
release. Include the test-only `ar-XB` pseudo-locale from the start.

The first desktop release still has an RTL readiness gate. It must test direction
changes, logical layout, focus order, keyboard navigation, popovers, dialogs,
split panes, and intentionally LTR source surfaces. A real RTL locale becomes a
desktop release candidate only when a fluent reviewer and representative manual
QA are available.

`ar-XB` is a QA locale. It must not appear in the product language selector or
be described as Arabic support.

### 3. Translation-management platform and contributor workflow

**Recommendation:** Select Weblate and use its dedicated-reviewer workflow.
Begin with a hosted pilot to avoid adding deployment work to the localization
bake-off. Self-hosting remains available if an operational or data residency
requirement justifies it.

The recommended contributor workflow is:

1. Developers change English source messages and semantic keys in Git.
2. Contributors translate or submit suggestions in Weblate.
3. A fluent language reviewer resolves checks and approves each target string.
4. Weblate commits only approved translations to the localization branch.
5. CI validates the committed catalogs independently of Weblate.
6. Machine translation remains a draft source and cannot approve a string.

Weblate meets the required capability set:

| Requirement | Verified capability | Oleafly configuration |
| --- | --- | --- |
| Descriptions | Additional string information includes explanations, priorities, check flags, and visual context | Require an explanation for ambiguous controls, technical terms, and messages with non-obvious values |
| Screenshots | Screenshots can be attached to source strings, stored in the repository, or managed through the API | Cover each critical workflow and every ambiguous icon-only control |
| Glossary | Project glossaries support preferred, forbidden, terminology, and untranslatable entries | Seed LaTeX, Typst, BibTeX, SyncTeX, Git, GitHub, DOI, arXiv, and MCP |
| Placeholder validation | The placeholder check detects missing named placeholders and accepts configured patterns | Configure checks for i18next interpolation and named rich-message elements |
| Review state | Dedicated review supports Waiting for review and Approved states | Require approval from a fluent reviewer |
| Release filtering | The translation quality filter can commit only approved translations | Use approved-only catalog sync |
| React catalog format | Weblate supports i18next JSON files and nested JSON | Keep runtime catalogs in i18next JSON v4 |
| Other catalog formats | Weblate also supports GNU Gettext PO with plural, description, context, location, and flag data | Capability verification only. No PO workflow is in the current desktop scope |

There is one material limitation. Weblate documents that ordinary i18next JSON
does not natively carry source descriptions. Weblate can store explanations
and screenshot associations outside the JSON catalog. Before i18next is
confirmed, the architecture bake-off must prove all of the following:

- An explanation remains attached after source updates, key moves, and target
  exports.
- Screenshot associations remain attached after the same operations.
- Explanation, glossary, screenshot, and review data are included in a tested
  backup and restore procedure.
- A missing `{{name}}` interpolation value and a missing named rich-message
  element both fail the localization quality gate.
- i18next JSON completes an import, review, export, and re-import round trip
  without semantic loss.

If that proof fails, Weblate plus i18next JSON does not satisfy the context
requirement. The runtime decision must then be reopened, with Lingui and PO as
the default alternative.

Weblate is open source and can be self-hosted, but self-hosting is not free of
operational cost. Its official Docker guidance lists a single-host minimum of
3 GB RAM, 2 CPU cores, and 1 GB storage. Hosting mode therefore needs a separate
operational approval before desktop translation begins.

### 4. Desktop template boundary

**Recommendation:** Localize desktop-owned template metadata only. Do not
translate starter document content.

The desktop template gallery stores names, descriptions, and categories beside
starter source files. It also uses an English category value as behavioral
identity in
[`NewProjectDialog.tsx`](../packages/templates/src/NewProjectDialog.tsx).
Desktop implementation may replace that behavioral dependency with a stable ID
and localize metadata owned by this repository.

The current desktop scope may include:

- Desktop-owned template and category labels.
- Desktop-owned names and descriptions bundled with the application.
- Search text derived from localized desktop metadata.
- Desktop controls around browsing, previewing, and creating from a template.

Starter LaTeX, Typst, and Markdown source remains unchanged. Filenames,
references, example prose, and document previews are content, not interface
metadata. Localized starter content requires explicit variants with independent
compilation and license QA, so it is not part of this phase.

Metadata owned by the remote template catalog is also outside this phase.
Desktop work must not modify the template catalog repository or imply that
remote catalog entries are translated.

## Explicitly deferred scope

The following decisions are not active in this desktop phase. They have no
approved implementation direction in this record:

- Public website, documentation, Learn, blog, SEO, and public route
  localization.
- A future signed web application, including account language, browser
  detection, and per-browser override behavior.
- Remote template catalog localization, locale overlays, or changes to the
  template catalog repository.
- Cloud API, server-generated email, invitations, notices, notifications,
  receipts, reports, and server-side formatting.
- Repository consolidation, monorepo migration, repository renaming, or other
  topology changes.
- Installer languages, store listings, localized release notes, and localized
  support channels.

Deferral means no implementation work, dependency choice, route change, schema
change, or repository migration is authorized for these surfaces. Each surface
requires a separate decision record when it becomes an active product priority.

## Supported-locale contract

This contract describes desktop language support only.

| Locale | Classification | Initial coverage |
| --- | --- | --- |
| `en` | Shipping source and fallback locale | Complete desktop application |
| `es` | Proposed first supported target locale | Complete desktop application after the gate below |
| `en-XA` | Test-only expanded pseudo-locale | Automated and manual layout QA |
| `ar-XB` | Test-only RTL pseudo-locale | Automated and manual direction QA |

The complete desktop application includes:

- Main, update, and detached preview windows.
- Startup, library, project creation, editor, compile, preview, save, export,
  settings, reset, and update flows.
- Rail, command palette, omnibar labels, search keywords, hints, and shortcuts.
- Oleafly-owned errors, confirmations, progress, empty states, and toasts.
- Templates, diagrams, preflight, tours, AI, integrations, and tools when those
  features are available.
- Accessibility names, descriptions, tooltips, placeholders, titles, and
  visually hidden copy.
- Locale-aware dates, times, numbers, counts, lists, currencies, durations, and
  file sizes.
- Desktop-owned localized template metadata.

Compiler output, third-party diagnostics, user documents, filenames, source
code, BibTeX, and internal logs are excluded by classification. They must not be
counted as missing translations. Remote template catalog metadata is also
excluded from this desktop-repository phase.

Public website content, documentation, installers, store listings, release
notes, support content, signed web interfaces, and future server artifacts are
not covered by this record.

## Locale release gate

A proposed target locale becomes supported only when every item below passes.

### Catalog and automation

- Required desktop namespaces report 100 percent translated keys.
- There are zero missing, empty, or unapproved target messages.
- There are zero placeholder-name, placeholder-type, plural-form, or named
  rich-message mismatches.
- English source keys and generated types pass the catalog schema and TypeScript
  checks.
- Critical startup catalogs load with network access disabled.
- Locale fallback and region mapping tests pass.
- `en`, the target locale, `en-XA`, and `ar-XB` pass the desktop smoke suite.

### Review and terminology

- A named fluent reviewer approves every target message.
- Every ambiguous control, technical term, and interpolated message has
  translator context.
- Each critical workflow has current screenshot context in the TMS.
- Required glossary terms have approved target entries or an explicit
  untranslatable classification.

### Product QA

- Manual smoke testing passes on shipping macOS, Windows, and Linux targets.
- Critical flows contain no unintended English fallback.
- No Oleafly-owned noncritical interface string falls back to English.
- Expanded copy does not clip or hide required controls.
- LTR and RTL pseudo-locales preserve focus order, keyboard navigation, dialogs,
  popovers, split panes, and source-surface readability.
- Accessible names update after a live locale change.
- Selecting System default remains stored as System default.
- Changing UI language does not change document language, proofing language, or
  spellcheck dictionaries.
- Known exclusions and raw diagnostic boundaries are documented in the release
  evidence.

The release pull request must attach catalog status output, automated test
results, the reviewer sign-off, and the manual operating-system smoke record.

## Approval record

Approval is intentionally blank.

| Decision | Approval date | Approval evidence |
| --- | --- | --- |
| First real target locale | Pending | Pending |
| Real RTL locale in the first desktop release | Pending | Pending |
| Translation-management platform and contributor workflow | Pending | Pending |
| Desktop template boundary | Pending | Pending |

## Official TMS evidence

- [Weblate source availability](https://weblate.org/en-gb/download/)
- [Additional source information and screenshots](https://docs.weblate.org/en/latest/admin/translating.html#additional-info-on-source-strings)
- [Glossaries](https://docs.weblate.org/en/latest/user/glossary.html)
- [Placeholder checks](https://docs.weblate.org/en/latest/user/checks.html#placeholders)
- [Dedicated review and translation states](https://docs.weblate.org/en/latest/workflows.html)
- [Approved-only translation quality filter](https://docs.weblate.org/en/latest/admin/projects.html#translation-quality-filter)
- [JSON and i18next JSON support](https://docs.weblate.org/en/latest/formats/json.html)
- [GNU Gettext PO support](https://docs.weblate.org/en/latest/formats/gettext.html)
- [Self-hosted Docker requirements](https://docs.weblate.org/en/latest/admin/install/docker.html#hardware-requirements)
