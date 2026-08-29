#import "lib.typ": proposition-style

#set document(
  title: "Phase-Locked Droop Adaptation for Inverter-Dominated Islanded Microgrids",
  author: ("Ingrid Salvesen", "Marcus Oyelaran", "Hedda Brunborg"),
)

#set page(
  paper: "us-letter",
  margin: (x: 0.62in, top: 0.75in, bottom: 1.0in),
  columns: 2,
  numbering: none,
)
#set columns(gutter: 0.28in)

#set text(font: "Libertinus Serif", size: 10pt, hyphenate: true)
#set par(justify: true, leading: 0.52em, first-line-indent: (amount: 1em, all: true))
#show raw: set text(font: "DejaVu Sans Mono", size: 8pt)

#set heading(numbering: (..levels) => {
  let n = levels.pos()
  if n.len() == 1 { numbering("I", n.at(0)) } else if n.len() == 2 {
    numbering("A", n.at(1))
  } else { numbering("1", n.at(2)) }
})

#show heading.where(level: 1): it => block(width: 100%, above: 13pt, below: 6pt)[
  #set align(center)
  #set text(size: 10pt, weight: "regular")
  #smallcaps[#if it.numbering != none [#counter(heading).display(it.numbering). ] #it.body]
]

#show heading.where(level: 2): it => block(width: 100%, above: 10pt, below: 4pt)[
  #set text(size: 10pt, weight: "regular", style: "italic")
  #if it.numbering != none [#counter(heading).display(it.numbering). ] #it.body
]

#set math.equation(numbering: "(1)")
#show math.equation.where(block: true): set block(above: 8pt, below: 8pt)

#set figure(gap: 6pt)
#show figure.caption: set text(size: 8pt)
#show figure.where(kind: table): set figure.caption(position: top)
#set table(stroke: none, inset: (x: 5pt, y: 2.6pt))

#show cite: set text(fill: black)
#show ref: set text(fill: black)

#show: proposition-style

#place(top + center, scope: "parent", float: true, block(width: 100%, {
  set align(center)
  text(size: 18pt, weight: "bold")[
    Phase-Locked Droop Adaptation for Frequency\
    Stability in Inverter-Dominated Islanded Microgrids
  ]
  v(10pt)
  text(size: 11pt)[
    Ingrid Salvesen, Marcus Oyelaran, and Hedda Brunborg
  ]
  v(2pt)
  text(size: 9pt, style: "italic")[
    Department of Electric Power Engineering, Nordvik Institute of Technology, Bergen
  ]
  v(1pt)
  text(size: 9pt)[
    `{salvesen, oyelaran, brunborg}@nordvik-example.no`
  ]
  v(14pt)
}))

#block[
  #set par(first-line-indent: 0pt, justify: true)
  #set text(size: 9pt)
  *#text(style: "italic")[Abstract]* --
  Islanded microgrids that carry more than about sixty percent of their load on
  grid-forming inverters lose the rotating inertia that classical droop control
  was designed around. The usual remedy, a virtual inertia term tuned offline,
  buys frequency nadir at the cost of a damping margin that shrinks as the
  network impedance drifts with switching state. We present a droop law whose
  active-power gain is adapted online from the phase error measured by each
  unit's own phase-locked loop, without communication between units. The
  adaptation is derived from a small-signal model of the multi-inverter network
  and is shown to keep the dominant eigenvalue pair inside a specified damping
  cone for every impedance in a stated uncertainty set. On a nine-bus
  hardware-in-the-loop testbed with eight grid-forming units, the controller
  reduces the worst-case frequency nadir after a 0.42 per-unit load step from
  48.71 Hz to 49.44 Hz, and it holds a damping ratio above 0.24 across a
  four-to-one range of line impedance where a fixed virtual-inertia baseline
  falls to 0.06. We also report the regime in which the adaptation should be
  disabled, namely sustained unbalanced faults, where the phase error stops
  being an informative proxy for power imbalance.

  #v(4pt)
  *#text(style: "italic")[Index Terms]* --
  Microgrids, droop control, grid-forming inverters, small-signal stability,
  virtual inertia, phase-locked loop.
]

#include "sections/introduction.typ"
#include "sections/model.typ"
#include "sections/controller.typ"
#include "sections/evaluation.typ"
#include "sections/related.typ"
#include "sections/conclusion.typ"

#bibliography("refs.bib", style: "ieee", title: [References])
