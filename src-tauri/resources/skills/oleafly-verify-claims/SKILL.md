---
name: oleafly-verify-claims
description: Audit a section claim by claim and report which statements the cited sources actually support. Use when the user asks to check the citations, verify the claims in a section, find unsupported or overstated statements, confirm nothing was fabricated, or get a manuscript ready for review or submission. Builds research/claims.md with a support level and an evidence note per claim, and reports problems rather than quietly rewriting the prose.
license: MIT
compatibility: Reads and reports only. Needs network approval for verify_citation. The optional scientific-writing audit script needs Python 3.11 or newer on the login shell PATH.
allowed-tools: read_file search_project project_map project_library_search verify_citation write_file create_file compile get_pdf_text update_todos load_skill read_skill_file run_command
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: review
    tools:
      - read_file
      - search_project
      - project_map
      - project_library_search
      - verify_citation
      - write_file
      - create_file
      - compile
      - get_pdf_text
      - update_todos
      - load_skill
      - read_skill_file
      - run_command
---

# Oleafly Verify Claims

This skill answers one question for every factual sentence in a section: does the source it cites actually say that? The output is a table, a report, and a list of proposed fixes. It is not a rewrite.

**Never edit the user's prose in this skill.** A claim audit that silently corrects what it finds destroys the evidence of what was wrong, and the user cannot check your judgement afterwards. Propose the fix, name the file and line, and let them decide. The only files this skill writes are `research/claims.md` and a report under `review/`.

## Step 1. Fix the scope

Audit one section, or one file, at a time. A whole manuscript in one pass produces a table nobody reads.

Confirm with the user which file, or infer from what they just asked about. `project_map` with `{}` returns `sections` with the file and line of each heading, so you can name the boundaries precisely.

Set the plan with `update_todos`, one item per step below.

## Step 2. Read the text with line anchors

`read_file` with `{"path": "sections/related.tex", "offset": 1, "limit": 200}`. The result carries `offset`, `lines_returned` and `total_lines`. Line N of the returned content is file line `offset + N - 1`. Read further slices until you have covered the section.

To pin a line number exactly, `search_project` with `{"query": "<six distinctive words from the sentence>"}` returns the file and line of every match. That is more reliable than counting, and it is the anchor to record in the table.

## Step 3. Extract the claims

Go sentence by sentence. A claim is anything a reader could be wrong to believe.

Audit these:

- A statement about what prior work did, showed, achieved or failed to handle.
- A number, a rate, a size, a threshold, a benchmark result, a date.
- A statement about the state of a field. "Most approaches assume..." is a claim about a population.
- A causal statement. "Because X, Y follows."
- A statement about what is standard, common, or widely used.
- A definition attributed to a source.

Skip these:

- The paper's own contributions and results, which are evidenced by the paper itself, not by a citation.
- Statements of intent. "We now describe the method."
- Pure mathematics that is derived in place.
- Hedged framing that asserts nothing. "One way to see this is..."

Number the claims C1, C2 and onward. Quote each one, or paraphrase tightly enough that the user recognises the sentence.

## Step 4. Map each claim to its cited key

For each claim, record which keys the sentence cites. A claim with no citation is not automatically a problem, but it has to be classified deliberately (step 6).

`project_map` with `{}` gives `bibKeys` and `unresolvedCites`. Any key on the claim list that appears in `unresolvedCites` is already broken before the content question is asked: it cites nothing. Record it as `unsupported` with the reason "no bibliography entry".

## Step 5. Gather the evidence

For each cited key, in this order, stopping when you have enough to judge:

1. `read_file` with `{"path": "research/sources/<key>.md"}`. If the sweep ran, this holds the abstract verbatim and the provenance. This is the cheapest real evidence available.
2. `project_library_search` with `{"query": "<the claim, in the source's own vocabulary>"}` searches the project's own files, including any imported full text and the user's reading notes.
3. `read_file` on the PDF at `research/sources/<key>.pdf` when the abstract does not settle it and the paper is in the project.
4. `verify_citation` with `{"doi": "<doi from the entry>"}` to confirm the entry resolves to a real record with the title, venue and year the entry claims. This checks the citation exists and matches; it does not check that the paper supports the claim. Both checks matter and they are different.

When no evidence is available at all, that is a finding, not a blocker. Record the claim as `unsupported` with the note "no source note, no full text in the project", and propose that the source be added by `oleafly-literature-sweep`.

Never judge from the title. Titles overstate, and a title that matches the claim is the most common way a wrong citation survives review.

## Step 6. Assign a support level

Exactly one of three, defined in full in `references/support-levels.md`.

| Level | Means |
|---|---|
| `verified` | The source states the claim, at the scope the sentence gives it. You can point to where |
| `partial` | The source supports a narrower or different version. The direction is right, the scope, magnitude, population or conditions are not |
| `unsupported` | The source does not state it, the citation does not resolve, or there is no citation and no source that would carry it |

`partial` is the level that does the most work. Most citation problems in real manuscripts are not fabrications, they are a true finding stretched one step past what was measured.

The evidence note must say what the source actually says, not just that it disagrees. "Measured on graphs up to 10k nodes; the sentence says arbitrary scale" is actionable. "Overstated" is not.

## Step 7. Write research/claims.md

Create the directory if needed with `create_file` and `{"path": "research", "is_dir": true}`, then `write_file` the table from `assets/claims.md`.

Columns: number, claim, location as `file:line`, cited key, support level, evidence note. Then a summary count, then a proposed fixes table.

If `research/claims.md` already exists, `read_file` it first and merge rather than replacing. An earlier audit's findings on other sections are not yours to discard.

## Step 8. Optional deeper audit with the vendored script

`scientific-writing` ships `scripts/audit_claims.py`, which checks a Markdown manuscript against a structured claim registry and a source manifest. It is worth running when the project is Markdown and the user wants a machine checkable evidence trail, and it is overhead otherwise.

Before the first script call, check the interpreter once with `run_command` and `{"command": "python3 --version"}`. Below 3.11, skip this step and say so.

`load_skill` with `{"id": "scientific-writing"}` returns its absolute directory and file tree. It takes three positional arguments, in this order:

```
python3 "<scientific-writing dir>/scripts/audit_claims.py" manuscript.md research/claims.csv research/sources.json
```

- The manuscript, UTF-8 Markdown.
- A claim registry CSV with the columns `claim_id`, `section`, `claim_kind`, `claim_text_sha256`, `evidence_ids`, `verification_status`, `uncertainty`, `analysis_intent`. Template at `assets/claim_evidence_template.csv` inside that skill.
- A source manifest JSON with a `sources` array of records carrying `evidence_id`, `title`, `year`, `authors`, `identifiers`, `locator` and a `verification` block. Template at `assets/source_manifest_template.json` inside that skill.

Read either template with `read_skill_file` and `{"id": "scientific-writing", "path": "assets/claim_evidence_template.csv"}`.

Two related scripts from the same skill: `scripts/check_references.py <sources.json>` validates the manifest alone, and `scripts/lint_manuscript.py <manuscript.md>` checks the prose against the skill's writing rules.

Write script output to a file under `research/` and read it back with `read_file`. Command output is capped and truncates silently.

The script checks structure and completeness. It does not read the sources. It never replaces steps 5 and 6.

## Step 9. Report, and hard fail on the unsupported

Write the report to `review/claim-audit-<section>.md` from `assets/audit-report.md`, and give the user the summary in your reply.

Lead with the count at each level. Then list every `unsupported` claim in full, with its location and what is missing. These are the ones that must be resolved before submission, and burying them under the verified ones is how they get missed.

For each problem, propose a concrete fix and let the user choose:

- Narrow the sentence to what the source measured.
- Add a second citation that carries the rest of the claim.
- Replace the citation with one that actually supports it.
- Mark the statement as this work's own contribution rather than a citation.
- Remove the claim.

Propose. Do not apply. If the user then asks you to make the edits, do them with `replace_in_file` in that turn, one at a time, and `compile` afterwards.

## Step 10. Confirm the document still builds

If you added nothing and edited no source, `compile` is not required. If the user accepted fixes and you applied them, `compile` with `{}`, then `project_map` with `{}` to confirm `unresolvedCites` is empty, then `get_pdf_text` with `{}` to confirm no citation renders as `[?]`.

## Step 11. Hand off

- The methodology behind a claim needs appraising, not just the citation: `load_skill` with `{"id": "scientific-critical-thinking"}`.
- Sources are missing and have to be found: `load_skill` with `{"id": "oleafly-literature-sweep"}`.
- The bibliography itself is inconsistent, duplicated or malformed: `load_skill` with `{"id": "citation-management"}`.
- The whole manuscript needs a reviewer's read, not a claim audit: `load_skill` with `{"id": "oleafly-review-manuscript"}`.

## Failure handling

| What happened | What to do |
|---|---|
| No `research/sources/` directory | The sweep never ran. Audit what you can from `project_library_search` and `verify_citation`, and say clearly that most levels are provisional |
| A cited key is in `unresolvedCites` | `unsupported`, reason "no bibliography entry". This is a build problem as well as a citation problem |
| `verify_citation` returns `verified: false` for an existing entry | The entry may be fabricated or the metadata wrong. Flag it prominently. Do not delete it yourself |
| The PDF for a paper is not in the project | Judge from the abstract in the source note, and cap the level at `partial` unless the abstract states the claim outright. Say the full text was not read |
| The user asks you to just fix everything | Show the table first. Apply fixes only after they have seen what will change |
| A claim cites six keys at once | Audit the claim against the set. If no single source carries it and the set does not either, it is `unsupported` |
| `run_command` reports `timed_out` | Skip the script step. It is optional and the manual audit is the real work |

## Done when

- [ ] Every factual claim in the scope has a row, with a `file:line` location that `search_project` confirms.
- [ ] Every row has a support level and an evidence note that says what the source actually says.
- [ ] Every `unsupported` claim is listed in full in the report, not only counted.
- [ ] Every proposed fix names the file, the line, and the specific change.
- [ ] `research/claims.md` and `review/claim-audit-<section>.md` are written.
- [ ] No sentence of the user's prose was changed without them asking for it in this turn.

## Reference files

- `references/support-levels.md` defines the three levels with worked examples and the judgement calls between them.
- `assets/claims.md` is the audit table template.
- `assets/audit-report.md` is the report template.
