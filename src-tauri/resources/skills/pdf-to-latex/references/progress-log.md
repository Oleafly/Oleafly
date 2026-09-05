# The progress log

`import/pdf-progress.md` is what makes a rebuild resumable. A twenty page paper does not
finish in one conversation, and without a log the next session either redoes finished work
or silently skips a section.

Write it before the first edit. Update it in the same turn as each section's edit, not at
the end.

## Template

```markdown
# PDF rebuild progress

- Source: <original file name>, <n> pages
- Ground truth: <attached page images 1-8 | pdftotext on source.pdf | ask per page>
- Started: <YYYY-MM-DD>
- Last touched: <YYYY-MM-DD>, section <n>

## Sections

| # | Section | Pages | Status | Left to do |
|---|---|---|---|---|
| 0 | Title, authors, abstract | 1 | done | |
| 1 | Introduction | 1-2 | done | |
| 2 | Related work | 2-3 | in progress | citations still literal |
| 3 | Method | 3-6 | not started | eq. 4-9, Figure 2 is vector |
| 4 | Experiments | 6-9 | not started | Tables 1-3 |
| 5 | Conclusion | 9 | not started | |
| A | Appendix A | 10-12 | blocked | no text layer, no images attached |

Status is one of: not started, in progress, done, blocked.

## Verified

| Section | Text checked | Layout checked | Notes |
|---|---|---|---|
| 0 | yes | yes | title wraps to two lines in the rebuild, one in the original |
| 1 | yes | no | page capture off |

## Unresolved

- [14] Okonkwo et al., no DOI on the page, title search returned nothing.
- Figure 2 is a vector chart, not extracted. Needs redrawing.
- Page 11 has no text layer and no attached image.

## Decisions

- Kept the two-column layout (original is IEEE style); switched the class in a later pass.
- Rounded nothing. Table 2 values copied at four significant figures as printed.
```

## Resuming from a log

1. `read_file` the log.
2. `compile` to confirm the project still builds. If it does not, fix that before anything
   else, and note in the log that the state you inherited was broken.
3. Re-establish ground truth. Attached images do not carry over between conversations, so
   the route recorded in the header may no longer be available. Ask for the pages the next
   section needs.
4. Start at the first section that is not `done`. Do not re-verify finished sections unless
   the log says a check was skipped.
5. Read "Unresolved" and "Decisions" before making any new decision, so the rebuild stays
   consistent with itself.

## What not to put in it

- Prose about what you are about to do. The table says that.
- Content from the document. The log tracks the work, not the paper.
- Anything you have not actually checked. A row marked `done` is a claim that the section
  was verified against the original.
