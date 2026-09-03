#import "lib/style.typ": *

#set document(
  title: "Applied Data Science: Methods and Practice",
  author: ("Marisol Ferreira-Lund", "Devraj Anantharaman"),
)

#set page(
  paper: "a4",
  margin: (top: 2.4cm, bottom: 2.4cm, inside: 2.6cm, outside: 2.2cm),
  numbering: "1",
  header: context {
    let all = query(heading.where(level: 1))
    let here-page = here().page()
    let on-page = all.filter(entry => entry.location().page() == here-page)
    let earlier = all.filter(entry => entry.location().page() < here-page)
    let heads = if on-page.len() > 0 { on-page } else { earlier }
    if heads.len() > 0 {
      let current = heads.last()
      set text(size: 8.5pt, style: "italic", fill: luma(35%))
      grid(
        columns: (1fr, auto),
        align: (left, right),
        current.body,
        [Applied Data Science],
      )
      v(-5pt)
      line(length: 100%, stroke: 0.4pt + luma(78%))
    }
  },
)

#set text(font: "New Computer Modern", size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.62em, first-line-indent: 1.2em)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#set table(stroke: none)

#show raw: set text(font: "DejaVu Sans Mono", size: 8.4pt)
#show raw.where(block: true): it => block(
  width: 100%,
  fill: luma(96.5%),
  stroke: (left: 2pt + luma(72%)),
  inset: (left: 9pt, right: 8pt, top: 7pt, bottom: 7pt),
  radius: (top-right: 2pt, bottom-right: 2pt),
  breakable: true,
  it,
)

#show figure: set block(above: 15pt, below: 15pt)
#show figure.caption: set text(size: 9pt)
#show figure.where(kind: table): set figure.caption(position: top)

#show heading.where(level: 1): it => {
  if it.supplement == [Part] {
    block(height: 0pt, above: 0pt, below: 0pt, [])
  } else if it.numbering == none {
    pagebreak(weak: true)
    block(above: 0pt, below: 18pt)[
      #text(size: 17pt, weight: "bold")[#it.body]
      #v(1pt)
      #line(length: 100%, stroke: 0.9pt + luma(55%))
    ]
  } else {
    pagebreak(weak: true)
    reset-callouts
    block(above: 0pt, below: 18pt)[
      #block(below: 5pt, text(size: 9.5pt, fill: luma(48%), weight: "regular", tracking: 1.5pt)[
        CHAPTER #counter(heading).display("1")
      ])
      #text(size: 17pt, weight: "bold")[#it.body]
      #v(1pt)
      #line(length: 100%, stroke: 0.9pt + luma(55%))
    ]
  }
}

#show heading.where(level: 2): it => block(above: 15pt, below: 8pt, text(size: 12.2pt, it))
#show heading.where(level: 3): it => block(above: 12pt, below: 6pt, text(size: 10.8pt, style: "italic", it))

#let part(index, name, blurb) = page(header: none, footer: none, {
  v(1fr)
  align(center)[
    #text(size: 10.5pt, fill: luma(45%), tracking: 3pt)[PART #index]
    #v(12pt)
    #text(size: 24pt, weight: "bold")[#name]
    #heading(level: 1, numbering: none, supplement: [Part], outlined: true, bookmarked: true)[Part #index. #name]
    #v(16pt)
    #line(length: 38%, stroke: 0.8pt + luma(55%))
    #v(16pt)
    #block(width: 74%, par(justify: false, text(size: 10.5pt, style: "italic", fill: luma(28%))[#blurb]))
  ]
  v(2fr)
})

#page(header: none, footer: none, numbering: none)[
  #v(3.0cm)
  #align(center)[
    #text(size: 11pt, tracking: 3pt, fill: luma(40%))[A PRACTITIONER HANDBOOK]
    #v(24pt)
    #text(size: 27pt, weight: "bold")[Applied Data Science]
    #v(8pt)
    #text(size: 15pt, fill: luma(25%))[Methods and Practice]
    #v(26pt)
    #line(length: 46%, stroke: 0.9pt + luma(45%))
    #v(26pt)
    #text(size: 12.5pt)[Marisol Ferreira-Lund #h(12pt) · #h(12pt) Devraj Anantharaman]
    #v(10pt)
    #text(size: 10pt, fill: luma(35%))[
      Cadence Institute for Quantitative Methods \
      Department of Statistical Practice
    ]
    #v(1fr)
    #block(width: 80%, par(justify: true, align(left, text(size: 9.5pt, fill: luma(30%))[
      This handbook collects the working methods we teach to analysts who are
      moving from exploratory work into production modelling. It assumes a first
      course in probability and linear algebra, and it treats every method as a
      claim that has to survive a validation design rather than as a routine to
      be called. Third revised printing, prepared for the graduate practicum
      sequence.
    ])))
    #v(26pt)
    #text(size: 9pt, fill: luma(50%))[Cadence Institute Press]
  ]
]

#set page(numbering: "i")
#counter(page).update(1)

#show outline.entry.where(level: 1): it => {
  v(8pt, weak: true)
  strong(it)
}

#outline(title: [Contents], depth: 2, indent: auto)

#pagebreak(weak: true)
#set page(numbering: "1")
#counter(page).update(1)

#part("I", "Foundations", [
  Every model inherits the defects of the sample that produced it. These two
  chapters treat collection and description as inferential acts with their own
  error terms, not as preliminaries to the modelling that follows.
])

#include "chapters/01-collection-and-sampling.typ"
#include "chapters/02-exploratory-analysis.typ"

#part("II", "Modelling", [
  The two model families in this part cover most tabular supervised work. We
  develop each one far enough to see where its regularisation acts, and what it
  costs when the assumption behind that regularisation is wrong.
])

#include "chapters/03-regularised-linear-models.typ"
#include "chapters/04-tree-ensembles.typ"

#part("III", "Practice", [
  A model that scores well on a held-out split has proved something narrow.
  This part is about the distance between that result and the behaviour of a
  system that has been running for eleven months.
])

#include "chapters/05-validation-leakage-drift.typ"
#include "chapters/06-uncertainty-and-monitoring.typ"

#pagebreak(weak: true)
#bibliography("refs.bib", style: "ieee", title: [References])
