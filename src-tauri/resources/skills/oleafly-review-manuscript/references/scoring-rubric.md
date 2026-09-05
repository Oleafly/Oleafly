# Scoring rubric

A fallback for when the vendored `scholar-evaluation` skill is not enabled. The five dimensions come from that skill's evaluation framework. Read `references/evaluation_framework.md` there when it is available, because it carries the reasoning behind the boundaries below.

## What the scores are for

The scores describe how well the submitted evidence supports the work along five named dimensions. They are developmental feedback on a piece of writing. They are not a measure of the authors, a publication decision, or a ranking.

Never use these scores to compare people, and never let a score stand in for the written comment. The comment is the review. The score is a summary of it.

Do not score, and do not let it influence you:

- the venue, the journal, or the conference the work targets
- the institution, the country, or the seniority of the authors
- citation counts, h-index, impact factor, or altmetrics
- how fashionable the topic is

## The five dimensions

### 1. Question and scope

Is there a bounded question? Is the significance argued rather than asserted? Are assumptions and boundary conditions stated? Is the scope feasible for what was done?

### 2. Literature grounding and contribution

Are the search or selection boundaries visible? Is contrary evidence engaged? Are comparison claims traceable to primary sources? Are novelty claims bounded? Failing to find prior work does not establish novelty.

### 3. Method and design fit

Do question, design, data, and method line up? Are sampling and measurement choices justified? Are validity threats named and mitigated? Is there enough detail to check the work?

### 4. Analysis, claims, and uncertainty

Do the analytical methods fit the data and the inferential target? Are assumptions checked? Is robustness tested? Is uncertainty reported and carried into the claims? Do the results and the claims agree?

### 5. Transparency, integrity, and reproducibility

Is reporting complete, with stable locators? Are protocols, data, code, and materials available or restricted for a stated reason? Are negative results reported? Are conflicts and limitations disclosed?

Restrictions are legitimate when privacy, consent, safety, security, Indigenous data governance, or commercial constraints require them. Judge whether the restriction is justified and described, not whether the data is open.

## The bands

Score each dimension 1 to 5 and write one line of justification with a location.

| Score | Meaning |
| --- | --- |
| 5 | Fully supported. A reader could check the work from what is provided. |
| 4 | Supported with small gaps that do not touch a central claim. |
| 3 | Partly supported. At least one central claim needs more evidence or a narrower statement. |
| 2 | Weakly supported. A central claim does not follow from what is shown. |
| 1 | Not supported. The evidence for the main claim is absent or contradicts it. |

Use "not assessable" instead of a number when the material needed to judge a dimension was not available. That is more useful than a low score, and it is honest.

## Reporting the scores

Write them as a table, then the total in a single line of prose that says what the total means. Do not compute a weighted composite and present it as a measurement. Do not attach a decision to any total.

| Dimension | Score | Basis |
| --- | --- | --- |
| Question and scope | 4 | intro.tex:22 states the question, significance argued from three prior results |
| Literature grounding and contribution | 3 | related.tex:60 claims novelty without comparing to the closest prior method |
| Method and design fit | 4 | |
| Analysis, claims, and uncertainty | 2 | results.tex:84 reports significance without effect size or interval |
| Transparency, integrity, and reproducibility | 3 | no data availability statement found |
