# Structuring a related-work section

## Choosing the grouping

| Grouping | Use it when | Fails when |
|---|---|---|
| By approach family | The field has distinct method traditions | Two families do the same thing under different names, and the reader gets a false contrast |
| By assumption or requirement | The contribution removes a requirement | Requirements overlap, so papers appear in several paragraphs |
| By shared limitation | The contribution removes that limitation | It reads as a straw man if the limitation was never a goal of those papers |
| By application domain | The contribution transfers across domains | It hides methodological similarity behind surface differences |
| Chronologically | The field genuinely progressed in stages and the stages matter | Almost always. Chronology is the default of a section with no argument |

Pick one and hold it. A section that groups the first two paragraphs by method and the third by application makes the reader rebuild the map halfway through.

## The paragraph shape

Four parts, in this order.

1. Name the family in one clause. "Spectral methods approach this by ..."
2. What that family achieves, with citations placed at the specific claims.
3. What it does not handle, stated as a fact about the work rather than a verdict on it.
4. The connection to this work, explicit or clearly implied.

Part three is where honesty lives and part four is where the argument lives. A paragraph missing part four is a bibliography entry in prose form.

## Positioning without overclaiming

- Describe a limitation in the terms the paper itself would accept. "Requires a labelled validation set" over "cannot be used in practice".
- Report scope, not failure. "Evaluated on graphs up to 10k nodes" is checkable. "Does not scale" is a claim you now have to defend.
- Do not attribute a motive. Papers do not "ignore" a case; they do not address it.
- If a paper solved part of the problem, say so. A related-work section that admits nothing was solved before is not credible and reviewers who wrote those papers will read it.
- Save comparative claims about your own results for the results section, where there are numbers.

## Citation placement

Put the key next to the claim it supports.

Good: "Message passing schemes are bounded by the Weisfeiler-Leman test \cite{xu2019-gnn-expressivity}, and the bound holds for any injective aggregator \cite{morris2019-wl-gnn}."

Bad: "Message passing schemes are bounded by the Weisfeiler-Leman test, and the bound holds for any injective aggregator \cite{xu2019-gnn-expressivity, morris2019-wl-gnn}."

The second version compiles identically and tells a reader checking the second claim nothing about where to look. Group keys only when the claim genuinely rests on all of them together, such as "several studies report the same effect".

## Length

A conference related-work section is typically three to five paragraphs. A thesis chapter is a different form and needs its own outline before drafting.

When the section is over budget, cut whole papers rather than trimming every sentence. Three papers described properly carry more weight than nine mentioned. Move the cut ones to `research/reading-list.md` with status `read` so the work is not lost.

## Rewriting someone else's section

Read the existing text with `read_file` before touching it. Preserve the author's terminology, their claims about their own contribution, and any citation they chose deliberately. Restructuring is usually welcome; silently dropping a paper they cited is not.

If you believe a cited paper does not support the claim attached to it, do not fix it quietly. Say so, and let `oleafly-verify-claims` handle the audit properly.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Reads as a list | Missing part four in every paragraph | Add the connection to this work, or cut the paragraph |
| Reader cannot tell which paper does what | Citations heaped at paragraph end | Move each key to its claim |
| Feels defensive | Every paragraph ends in a criticism | Lead with what the family achieved |
| Contradicts the introduction | Written without reading the rest of the project | `project_library_search` on the topic before drafting |
| Grew past the page limit | Every paper got a sentence | Cut papers, not words |
| Reviewer says their work is missing | The sweep was too narrow | Sweep again on the method name alone and on the venue's own recent proceedings |
