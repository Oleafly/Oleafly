# Support levels

Three levels, assigned to every claim. The level answers "does the cited source say this, at this scope", not "is this true".

## verified

The source states the claim, at the scope the sentence gives it, and you can say where in the source.

The evidence note names the location. "Abstract, second sentence." "Section 4.2, Table 3." "Stated in the abstract and measured in Figure 5." A `verified` row with a vague note is not verified, it is a guess with a good label.

Worked example.

> Sentence: "Message passing networks are bounded above by the Weisfeiler-Leman test \cite{xu2019-gnn-expressivity}."
> Source note abstract: "We show that GNNs are at most as powerful as the WL test in distinguishing graph structures."
> Level: `verified`. Note: "Stated in the abstract. Same bound, same scope."

## partial

The source supports a narrower, weaker or differently scoped version of the claim. The direction is right. The sentence has stretched it.

This is the most common finding in real manuscripts, and it is the one worth being precise about, because the fix is usually one clause.

The stretches to watch for:

| Stretch | Example |
|---|---|
| Scope | Source measured one dataset, sentence says "in practice" |
| Magnitude | Source reports 12 percent, sentence says "roughly doubles" |
| Population | Source studied undergraduates, sentence says "people" |
| Conditions | Source holds under an assumption the sentence drops |
| Direction of inference | Source reports an association, sentence asserts a cause |
| Universality | Source says "in the settings we tested", sentence says "always" |
| Negation | Source says it was not tested, sentence says it does not work |

Worked example.

> Sentence: "Spectral methods do not scale to large graphs \cite{author2020-slug}."
> Source note abstract: "We evaluate on graphs of up to 10,000 nodes, where the eigendecomposition dominates runtime."
> Level: `partial`. Note: "Source reports runtime dominated by eigendecomposition at 10k nodes. It does not claim a scaling limit in general, and it does not test beyond 10k."
> Fix: "Narrow to what was measured, or cite a source that studies scaling directly."

The last two rows of that table are the ones that turn into reviewer comments. Association stated as causation, and absence of evidence stated as evidence of absence, are both `partial` at best and often `unsupported`.

## unsupported

Any of these:

- The source does not state the claim in any form.
- The citation key has no bibliography entry, so it cites nothing. `project_map` reports these in `unresolvedCites`.
- `verify_citation` cannot confirm the entry corresponds to a real record.
- The claim has no citation, and nothing in the reading list or the project would carry it.
- The source says the opposite.

A claim with no citation is not automatically `unsupported`. Classify it deliberately:

- It is the paper's own contribution or result. Not a claim for this audit. Leave it out of the table, or record it with cited key `self`.
- It is general background that any reader in the field accepts. Note it and move on, unless the venue requires everything cited.
- It is a specific factual assertion with no source behind it. That is `unsupported`, and it is exactly what this audit exists to catch.

## When you cannot tell

Do not invent a level to fill the cell. Record the claim, set the level to `partial`, and write in the note what you could not check and why. "Abstract does not address it; full text not in the project" is an honest row that tells the user what to do next.

Capping at `partial` when only the abstract was available is deliberate. An abstract that appears to state the claim usually states a compressed version of it, and the compression is where the scope goes.

## What each level costs the user

`verified` costs nothing. `partial` costs one editing pass, usually a single clause. `unsupported` costs a source hunt, or a deleted sentence, and it is the one that gets a paper desk rejected or a reviewer annoyed. That asymmetry is why the report leads with the unsupported list rather than with the totals.
