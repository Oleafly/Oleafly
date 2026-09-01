#import "lib.typ": proposition-style

#set document(
  title: "Alignment-Budgeted Data Pruning for Instruction Tuning",
  author: ("Renata Kowalczyk", "Ibrahim Sow", "Wei-Lin Tsai"),
)

#set page(
  paper: "us-letter",
  margin: (x: 1.15in, top: 1.0in, bottom: 1.1in),
  numbering: "1",
)

#set text(font: "New Computer Modern", size: 10.5pt)
#set par(justify: true, leading: 0.62em, spacing: 0.95em)
#show raw: set text(font: "DejaVu Sans Mono", size: 9pt)

#set heading(numbering: "1.1")
#show heading.where(level: 1): it => block(above: 18pt, below: 9pt, text(size: 12.5pt, weight: "bold", it))
#show heading.where(level: 2): it => block(above: 13pt, below: 7pt, text(size: 11pt, weight: "bold", it))

#set math.equation(numbering: "(1)")
#show math.equation.where(block: true): set block(above: 11pt, below: 11pt)

#set figure(gap: 8pt)
#show figure.caption: set text(size: 9pt)
#show figure.where(kind: table): set figure.caption(position: top)
#set table(stroke: none, inset: (x: 6pt, y: 3.2pt))

#show: proposition-style

#align(center)[
  #text(size: 17pt, weight: "bold")[
    Alignment-Budgeted Data Pruning for Instruction Tuning
  ]
  #v(12pt)
  #text(size: 11pt)[
    Renata Kowalczyk #h(1.2em) Ibrahim Sow #h(1.2em) Wei-Lin Tsai
  ]
  #v(3pt)
  #text(size: 10pt, style: "italic")[
    Institute for Learning Systems, Tampere
  ]
  #v(2pt)
  #text(size: 9.5pt)[
    `{kowalczyk, sow, tsai}@ils-example.org`
  ]
  #v(16pt)
]

#block(width: 100%, inset: (x: 0.42in), {
  set par(justify: true)
  align(center, text(size: 11.5pt, weight: "bold")[Abstract])
  v(4pt)
  set text(size: 10pt)
  [
    Instruction-tuning corpora are assembled by scraping and then filtered by
    heuristics that nobody can state precisely: deduplicate, drop the short
    ones, keep the ones a reward model likes. We propose a selection rule with
    an explicit objective. Treat the full corpus gradient at the pretrained
    initialisation as the direction the fine-tune is trying to travel, and
    select the subset whose own gradient is most closely aligned with it under
    a diversity constraint that prevents the subset from collapsing onto one
    cluster. The rule is cheap because alignment is estimated from a rank-16
    sketch of last-layer gradients rather than from full backward passes. We
    prove a one-step descent guarantee that makes the alignment budget
    interpretable: a subset whose cosine alignment is at least $1 - epsilon$
    guarantees a per-step decrease of the full-corpus loss for any step size
    below an explicit threshold. Empirically, on a 7B decoder tuned on a 340k
    example mixture, keeping 12 percent of the data recovers 99.1 percent of
    the full-data instruction-following win rate and beats perplexity
    filtering, embedding-diversity sampling, and reward-model top-$k$ at every
    budget between 5 and 40 percent. We also report the case the method does
    not handle: corpora whose held-out task is absent from the training mixture,
    where alignment with the training gradient is the wrong target.
  ]
})

#v(14pt)

#include "sections/introduction.typ"
#include "sections/method.typ"
#include "sections/analysis.typ"
#include "sections/experiments.typ"
#include "sections/related.typ"
#include "sections/conclusion.typ"

#bibliography("refs.bib", style: "association-for-computing-machinery", title: [References])
