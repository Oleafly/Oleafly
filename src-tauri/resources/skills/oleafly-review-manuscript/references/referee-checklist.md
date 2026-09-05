# Referee checklist

Use this when the vendored `peer-review` skill is not enabled. It is the same shape at less depth. Work top down and stop at the first section that does not apply.

## Selecting a reporting guideline

| Study type | Guideline | Skip it when |
| --- | --- | --- |
| Randomized controlled trial | CONSORT | Not randomized, or not a trial |
| Observational epidemiology (cohort, case control, cross sectional) | STROBE | No human observational design |
| Systematic review or meta-analysis | PRISMA | Narrative review or primary study |
| Diagnostic or prognostic accuracy | STARD or TRIPOD | No prediction or diagnostic claim |
| Animal experiments | ARRIVE | No animal work |
| Qualitative research | COREQ or SRQR | No qualitative component |

For theory, systems, algorithms, simulation, machine-learning methods, or humanities work, none of these applies. Write one line saying so and move to the substance. Forcing a clinical checklist onto a methods paper wastes the author's time and marks the review as automated.

Reporting completeness is not quality. A paper can report every CONSORT item and still be badly designed. Never turn a missing checklist item into a verdict.

## Claims and evidence

For each central claim, in order of how much the paper depends on it:

- Where is the claim stated, and where is the evidence for it?
- Does the evidence have the direction, size, population, outcome, and timing the claim asserts?
- Is the uncertainty carried through, or does a confidence interval in the results become a flat assertion in the abstract?
- Does a causal verb appear where the design supports only association?
- Does the abstract or the conclusion claim more than the results section does? This is the single most common serious problem.

## Methods

1. Is the research question stated precisely enough to be answerable?
2. Does the design match the question, and is the unit of analysis the unit of inference?
3. Sampling, allocation, controls, blinding, and timing: described well enough to repeat?
4. Is there a sample-size or precision rationale, or is n whatever was available?
5. Inclusion, exclusion, attrition, missing data: are the numbers accounted for end to end?
6. Do the analyses match the design, and are their assumptions stated and checked?
7. Multiplicity: how many comparisons, and was anything preregistered?
8. Are effect estimates reported with uncertainty and a denominator, not just p values?
9. Do the interpretation and the generalization stay inside what was studied?

## Statistics

- Test named, statistic reported, degrees of freedom given, exact p value rather than a threshold.
- Effect size with an interval, not significance alone.
- Paired data analysed as paired; clustered data accounting for the cluster.
- Counts and proportions not analysed with tests that assume continuous normal data.
- Baseline comparisons in a randomized trial not tested for significance.
- Subgroup findings labelled exploratory unless prespecified.
- Figures with error bars saying what the bars are: standard deviation, standard error, or a confidence interval.
- Any number in the abstract traceable to a number in the results.

## Reproducibility and transparency

- Data availability: a statement, a repository, an accession, or a justified restriction.
- Code availability, with the environment and the versions that produced the results.
- Preregistration or an analysis plan, and any deviation from it disclosed.
- Software, package, and model versions named.
- Enough procedural detail that a competent reader could rebuild the pipeline.

Do not claim you reproduced anything unless you actually ran it.

## Ethics and integrity

Check only what applies: approvals and protocol numbers, consent, animal welfare statements, privacy and data governance, funding and sponsor role, conflicts, authorship and contributions, dual-use concerns.

Describe what you observe and what is missing. Do not accuse. A credible integrity concern goes to the editor through the confidential channel, not into the comments to authors.

## Figures, tables, and citations

- Every figure and table referenced in the text, and referenced where it is discussed.
- Captions readable on their own: what is shown, what n is, what the bars and bands mean.
- Axes labelled with units, scales honest, no truncated axis exaggerating a difference.
- Colour not the only encoding, and the palette safe for colour-blind readers.
- Numbers in a table matching the numbers in the text.
- Image processing disclosed where it matters.
- Citations resolving: run `project_map` and read `unresolvedCites` and `unresolvedRefs`.
- Citations supporting what they are cited for, at least for the load-bearing ones. Spot check the claims that a whole section rests on.
- References complete: no "in press" from six years ago, no missing DOIs where the field expects them.

## Writing and structure

- Does the introduction end with a stated contribution, or does the reader have to infer it?
- Is related work engaged with or merely listed?
- Is notation consistent across sections, and is every symbol defined before use?
- Are limitations stated by the authors, or only by you?
- Is the paper the right length for what it says?

## Writing the comments

Each major and minor comment carries four parts:

1. **Location.** File and line, plus the section name for readability.
2. **Observation.** What the text does, quoted.
3. **Why it matters.** Which claim is affected, and how.
4. **Requested action.** Something the authors can actually do.

Ask for new experiments only when a central claim cannot stand without them. Otherwise offer the cheaper resolutions first: narrow the claim, add a sensitivity analysis, report the missing statistic, or add a limitation.

Keep the tone professional. Criticize the work, never the authors. Do not speculate about competence or motive.
