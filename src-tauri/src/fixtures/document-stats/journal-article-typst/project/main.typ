#set document(
  title: "Niobium segregation at grain boundaries and its effect on creep resistance in a stabilised austenitic steel",
  author: ("Elin Hagstrom", "Rafael Duarte Pinto", "Nadia Bergqvist"),
)

#set page(
  paper: "a4",
  margin: (x: 1.05in, top: 1.1in, bottom: 1.1in),
  numbering: "1",
  header: context {
    if counter(page).get().first() > 1 {
      set text(size: 8.5pt, style: "italic", fill: luma(80))
      grid(
        columns: (1fr, auto),
        align: (left, right),
        [E. Hagstrom et al.], [Journal of Structural Alloys 41 (2026) 118 to 134],
      )
      v(-6pt)
      line(length: 100%, stroke: 0.4pt + luma(150))
    }
  },
)

#set text(font: "Libertinus Serif", size: 10.5pt)
#set par(justify: true, leading: 0.62em, first-line-indent: (amount: 1.2em, all: true), spacing: 0.65em)
#show raw: set text(font: "DejaVu Sans Mono", size: 9pt)

#set heading(numbering: "1.1.")
#show heading.where(level: 1): it => block(above: 16pt, below: 8pt, text(size: 11.5pt, weight: "bold", it))
#show heading.where(level: 2): it => block(above: 12pt, below: 6pt, text(size: 10.5pt, weight: "bold", style: "italic", it))

#set math.equation(numbering: "(1)")
#show math.equation.where(block: true): set block(above: 10pt, below: 10pt)

#set figure(gap: 9pt)
#show figure.caption: set text(size: 9pt)
#show figure.where(kind: table): set figure.caption(position: top)
#set table(stroke: none, inset: (x: 6pt, y: 3pt))

#block(width: 100%, {
  set par(first-line-indent: 0pt)
  text(size: 15.5pt, weight: "bold")[
    Niobium segregation at grain boundaries and its effect on\
    creep resistance in a stabilised austenitic steel at 923 K
  ]
  v(11pt)
  text(size: 10.5pt)[
    Elin Hagstrom#super[a], Rafael Duarte Pinto#super[a,b], Nadia Bergqvist#super[a,\*]
  ]
  v(5pt)
  set text(size: 9pt)
  [#super[a] Department of Materials Engineering, Vestmark University, Vestmark\ ]
  [#super[b] Alloy Performance Laboratory, Norrland Metals Institute, Skellefte\ ]
  [#super[\*] Corresponding author. `n.bergqvist@vestmark-example.se`]
})

#v(14pt)
#line(length: 100%, stroke: 0.6pt)
#v(8pt)

#block(width: 100%, {
  set par(first-line-indent: 0pt, justify: true)
  set text(size: 9.5pt)
  [*Abstract*]
  v(4pt)
  [
    Stabilised austenitic steels resist creep at 900 K to 950 K because niobium
    ties up carbon as MX carbonitrides and because a fraction of the niobium
    remains in solution and segregates to grain boundaries, where it retards
    boundary sliding. The relative weight of those two mechanisms is disputed,
    and the dispute matters because the first is consumed as the alloy ages
    while the second is not. We measured both on a single heat of a
    20Cr-25Ni-Nb steel by combining interrupted constant-load creep testing at
    923 K with atom-probe reconstruction of boundary composition on specimens
    taken from the same gauge lengths. Boundary niobium enrichment rose from
    2.1 at.% in the solution-treated condition to 7.4 at.% after 3,000 h under
    load, while the intragranular MX number density fell by a factor of 2.6
    over the same interval. The minimum creep rate was described by a threshold
    stress law with a threshold that tracked boundary enrichment rather than
    particle spacing, which supports the segregation mechanism as the dominant
    contributor at these stresses. A heat with 0.11 wt.% lower niobium showed
    the same particle evolution but a 3.4 times higher minimum creep rate,
    consistent with the same conclusion. We give the fitted parameters, the
    conditions under which the threshold description fails, and the boundary
    enrichment kinetics needed to extrapolate to service exposures.
  ]
  v(7pt)
  [*Keywords:* austenitic steel; creep; grain-boundary segregation; niobium;
    atom probe tomography; threshold stress]
})

#v(10pt)
#line(length: 100%, stroke: 0.6pt)

#include "sections/introduction.typ"
#include "sections/experimental.typ"
#include "sections/results.typ"
#include "sections/discussion.typ"
#include "sections/conclusions.typ"

#bibliography("refs.bib", style: "elsevier-with-titles", title: [References])
