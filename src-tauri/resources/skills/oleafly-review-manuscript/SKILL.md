---
name: oleafly-review-manuscript
description: Run a referee-grade review of the manuscript in the open project without changing a single manuscript file. Use when asked to review, referee, critique, or assess a paper, preprint, thesis chapter, or grant draft, to find unsupported claims, methods and statistics problems, missing reporting items, or figure and citation issues, or to produce a structured report with strengths, major and minor comments, line notes anchored to file and line, and scores per dimension.
license: MIT
compatibility: Any Oleafly project. The rendered-page pass needs a successful compile. Line anchoring works on any text source. Checklist depth improves when the peer-review and scholar-evaluation skills are enabled.
allowed-tools: read_file list_files search_project project_map compile get_log get_pdf_text create_file write_file load_skill read_skill_file show_location update_todos
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: review
    tools:
      - read_file
      - list_files
      - search_project
      - project_map
      - compile
      - get_log
      - get_pdf_text
      - create_file
      - write_file
      - load_skill
      - read_skill_file
      - show_location
      - update_todos
---

# Review a manuscript

Produce the review a careful referee would write: specific, anchored to the text, and honest about what you could not check. You read and you report. You do not edit.

## The one rule

Never modify a manuscript file. No `write_file`, `replace_in_file`, `create_file`, `rename_file`, or `delete_file` on anything that is part of the document. The only file you create is the report under `review/`. If the user asks you to apply a fix during the review, stop, finish the report, and offer to make the edits as a separate task.

## Before you start

Ask, or state your assumption, if any of these is unclear:

- Is this the user's own draft, or someone else's submission they are refereeing?
- Which venue, and is the review single-blind, double-blind, or open?
- What should the review focus on?

For an unpublished submission belonging to someone else, keep everything local. Do not put manuscript sentences into `literature_search`, `alphaxiv_search`, `verify_citation`, or any other network tool. Those queries leave the machine. Reading, compiling, and searching inside the project do not.

## Procedure

### 1. Map the project

Call `list_files` for the file tree, then `project_map` for the structure: sections, labels, bibKeys, macros, theorems, inputGraph, unresolvedRefs, unresolvedCites. Record the sections you will read with `update_todos` so the pass is visible and nothing is skipped.

If `project_map` is not offered (the engine does not advertise a document index), fall back to `search_project` for `\section`, `\subsection`, or `#` headings and build the outline by hand.

### 2. Read the full source

`read_file` every source file, following the include order from `inputGraph`. `read_file` truncates at 800 lines or 40,000 characters per call, so keep calling it with a higher `offset` until you reach the end of each file. Read the bibliography file too.

Do not review from the abstract and the section headings. A referee report written without reading the methods is worthless, and it shows.

### 3. Read the rendered document

Call `compile`, then `get_pdf_text` to see what the reader actually sees: float placement, table overflow, figure ordering, page breaks in the wrong place, and anything the source hides.

If the compile fails, call `get_log`, put "the manuscript does not compile" at the top of the report with the first error and its location, and review the source alone.

### 4. Load the checklists

Call `load_skill` with `peer-review`, then `read_skill_file` for the parts you need:

- `references/common_issues.md` for recurring problem patterns and constructive phrasings
- `references/statistical_reproducibility.md` for methods and statistics review
- `references/reporting_standards.md` when a reporting guideline applies

Call `load_skill` with `scholar-evaluation` and `read_skill_file` for `references/evaluation_framework.md` to get the five scoring dimensions and the rules that go with them.

Reporting guidelines apply only to the study types they were written for. Use CONSORT for randomized trials, STROBE for observational epidemiology, PRISMA for systematic reviews and meta-analyses, ARRIVE for animal experiments. For a theory paper, a systems paper, or a machine-learning methods paper none of them applies. Say so in one line rather than forcing a checklist that does not fit.

If those two skills are not enabled, or `read_skill_file` is not available in this run, use `references/referee-checklist.md` and `references/scoring-rubric.md` in this skill instead. They carry the same shape at less depth.

### 5. Anchor every remark

For each issue, find the exact sentence with `search_project` and write down the file and the line number. Quote the text you are objecting to, trimmed to the part that matters.

A remark you cannot anchor does not go in the report. "The statistics are weak" helps nobody. "methods.tex:112 reports a t-test on counts with n=7 per group and no normality check" can be acted on.

### 6. Write the report

Create `review/report.md` with `create_file`, then fill it with `write_file`. Follow `assets/report-template.md`. The sections are:

1. **Summary.** Three to six sentences: what the paper claims, how it argues it, and your overall read. No accept or reject verdict. That belongs to an editor.
2. **Strengths.** What genuinely works, with locations. Skip this and the report reads as hostile and gets discounted.
3. **Major comments.** Issues that affect whether a central claim stands. Numbered. Each one carries location, observation, why it matters, and the specific action that would resolve it.
4. **Minor comments.** Issues worth fixing that do not threaten a claim.
5. **Line notes.** The table below.
6. **Scoring.** Per dimension, from `references/scoring-rubric.md` or the scholar-evaluation framework.
7. **Limits of this review.** What you could not assess: unavailable data, methods outside your competence, a failed compile, sections that were empty.

The line notes table:

| File | Line | Quoted text | Issue | Suggestion | Severity |
| --- | --- | --- | --- | --- | --- |
| results.tex | 84 | "significantly improves" | No test statistic or p value | Report the test, statistic, df, and effect size with an interval | major |

Severity is `major`, `minor`, or `note`. Sort the table by file, then by line.

### 7. Show the top three

Call `show_location` with the path and line of your three most severe findings, worst first, so the user lands in the text instead of hunting for it. If `show_location` is not available in this run, skip it silently and list the three locations in your chat reply instead.

### 8. Report back

In chat: the three findings that matter most, in one sentence each, and the path to the report. Do not paste the whole report into the conversation.

## Decision points

| Situation | What to do |
| --- | --- |
| Compile fails | Say so at the top of the report, `get_log` for the first error, review the source only |
| `project_map` not offered | Build the outline with `search_project` on section commands |
| Randomized trial, cohort study, or systematic review | Pull the matching reporting checklist through `read_skill_file` |
| Theory, systems, or methods paper | Name the guidelines as not applicable in one line and move on |
| Someone else's unpublished submission | No network tools on manuscript text |
| User asks you to fix something mid-review | Finish the report, then offer the edits as a separate task |
| A claim depends on a source you cannot see | Record it as "not verifiable from the manuscript", not as an error |

## When something goes wrong

- `read_file` output ends mid-file: call it again with `offset` set past the last line you read.
- `get_pdf_text` returns nothing: the project has not compiled yet. Call `compile` first.
- `search_project` finds no hit for a sentence you can see: LaTeX splits sentences across lines, so search a short distinctive fragment without punctuation or macros instead of the whole sentence.
- `project_map` reports unresolvedRefs or unresolvedCites: those are findings, not obstacles. Put them in minor comments with their locations.
- A tool you expected is missing: degrade to the closest one you have and say in the report which check you could not run.

## Artifacts

- `review/report.md`, the full referee report.
- Nothing else. The manuscript is untouched, which you can prove: no file-change summary appears for this run.

## Done when

- Every source file has been read to its end.
- The rendered document has been read, or the compile failure is documented.
- Every major and minor comment carries a file and a line.
- The line notes table is populated and sorted.
- Every scoring dimension has a score and a one-line justification.
- The limits section names what you could not check.
- No manuscript file was modified.
