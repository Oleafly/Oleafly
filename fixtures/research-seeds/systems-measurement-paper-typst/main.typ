#set document(
  title: "Where the Writes Go: A Measurement Study of Amplification in LSM Key-Value Stores on Zoned Namespace SSDs",
  author: ("Dmitri Vasiliev", "Aurora Salcedo", "Kwame Boateng"),
)

#set page(
  paper: "us-letter",
  margin: (x: 0.75in, top: 0.85in, bottom: 1.0in),
  columns: 2,
  numbering: "1",
)
#set columns(gutter: 0.3in)

#set text(font: "Libertinus Serif", size: 9.8pt)
#set par(justify: true, leading: 0.54em, spacing: 0.62em, first-line-indent: (amount: 1em, all: true))
#show raw: set text(font: "DejaVu Sans Mono", size: 7.4pt)

#set heading(numbering: "1.1")
#show heading.where(level: 1): it => block(above: 13pt, below: 5pt, text(size: 11pt, weight: "bold", it))
#show heading.where(level: 2): it => block(above: 10pt, below: 4pt, text(size: 10pt, weight: "bold", it))

#set math.equation(numbering: "(1)")
#show math.equation.where(block: true): set block(above: 8pt, below: 8pt)

#set figure(gap: 6pt)
#show figure.caption: set text(size: 8.2pt)
#show figure.where(kind: table): set figure.caption(position: top)
#show figure.where(kind: raw): set figure(supplement: [Listing])
#set table(stroke: none, inset: (x: 5pt, y: 2.6pt))
#show table: set par(justify: false, leading: 0.5em)

#place(top + center, scope: "parent", float: true, block(width: 100%, {
  set align(center)
  text(size: 17pt, weight: "bold")[
    Where the Writes Go: A Measurement Study of Amplification\
    in LSM Key-Value Stores on Zoned Namespace SSDs
  ]
  v(9pt)
  text(size: 10.5pt)[Dmitri Vasiliev #h(1.4em) Aurora Salcedo #h(1.4em) Kwame Boateng]
  v(2pt)
  text(size: 9.5pt, style: "italic")[Systems Measurement Group, Harbour Bay Institute of Technology]
  v(1pt)
  text(size: 9pt)[`{vasiliev, salcedo, boateng}@harbourbay-example.edu`]
  v(13pt)
}))

#block[
  #set par(first-line-indent: 0pt, justify: true)
  #set text(size: 9.2pt)
  #text(weight: "bold")[Abstract]
  #v(3pt)
  Zoned namespace SSDs remove the device's internal garbage collector and hand
  the host a device that can only be appended to and erased a zone at a time.
  The promise is that a log-structured merge-tree, which already writes
  sequentially and already compacts, should map onto that interface with
  almost no amplification left over. We measured whether it does. Across four
  workloads, three key-value stores, and two commercial ZNS drives, moving from
  the block interface to a zoned interface removed device-level amplification
  entirely but raised host-level amplification by 18 to 41 percent, because the
  allocator that assigns SSTables to zones does not know which level a table
  belongs to and therefore mixes lifetimes inside a zone. The net effect on
  total bytes written is a 1.29 times improvement in the best case and a 1.04
  times regression in the worst. We instrumented the zone-append path to
  attribute every written byte to a level and a cause, we show that a
  seven-line change to the allocator that pins zones to levels recovers the
  regression and improves the best case to 1.61 times, and we report the
  workload property that predicts which regime a deployment is in.
]

#include "sections/introduction.typ"
#include "sections/architecture.typ"
#include "sections/methodology.typ"
#include "sections/measurements.typ"
#include "sections/analysis.typ"
#include "sections/related.typ"
#include "sections/conclusion.typ"

#bibliography("refs.bib", style: "association-for-computing-machinery", title: [References])
