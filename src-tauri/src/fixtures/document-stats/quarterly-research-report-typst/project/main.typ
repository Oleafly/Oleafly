#import "lib/report.typ": *

#let report-ref = "HIES-TMOP-QR-2026-02"
#let programme = "Tidal Margin Observatory Programme"
#let institute = "Hollowmere Institute for Estuarine Science"

#set document(
  title: "Tidal Margin Observatory Programme: Quarterly Research Report, Q2 2026",
  author: "Hollowmere Institute for Estuarine Science",
)

#set text(font: "Libertinus Serif", size: 10pt, lang: "en")
#set par(justify: true, leading: 0.62em, spacing: 0.95em)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#set table(stroke: none, inset: (x: 5.5pt, y: 3.6pt))
#show raw: set text(font: "DejaVu Sans Mono", size: 8.2pt)
#show link: set text(fill: ink.navy)

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  block(above: 0.6em, below: 1.0em, {
    text(size: 8pt, tracking: 0.12em, fill: ink.rust, weight: "bold", upper[Section])
    v(-0.55em)
    text(size: 16pt, fill: ink.navy, weight: "bold", it)
    v(-0.3em)
    line(length: 100%, stroke: 0.7pt + ink.rule)
  })
}
#show heading.where(level: 2): it => block(
  above: 1.4em,
  below: 0.65em,
  text(size: 11.5pt, fill: ink.navy, weight: "bold", it),
)
#show heading.where(level: 3): it => block(
  above: 1.15em,
  below: 0.5em,
  text(size: 10pt, fill: ink.navy, weight: "bold", style: "italic", it),
)
#show figure.caption: it => block(
  width: 100%,
  align(left, text(size: 8.6pt, fill: ink.slate, it)),
)
#set figure(gap: 0.75em)

#let page-footer(pattern) = context {
  set text(size: 8pt, fill: ink.slate)
  line(length: 100%, stroke: 0.4pt + ink.rule)
  v(-0.25em)
  grid(
    columns: (1fr, auto, 1fr),
    align(left, report-ref),
    align(center, [Restricted: programme board and funder]),
    align(right, counter(page).display(pattern)),
  )
}

#let body-header = context {
  let heads = query(selector(heading.where(level: 1)).before(here()))
  let current = if heads.len() > 0 { heads.last().body } else { [Front matter] }
  set text(size: 8pt, fill: ink.slate)
  grid(
    columns: (1fr, auto),
    align(left, programme + [ #sym.dot.c Q2 2026]),
    align(right, emph(current)),
  )
  v(-0.3em)
  line(length: 100%, stroke: 0.4pt + ink.rule)
}

#set page(
  paper: "a4",
  margin: (top: 2.5cm, bottom: 2.4cm, x: 2.3cm),
  header: none,
  footer: none,
  numbering: none,
)

#align(center)[
  #v(0.9cm)
  #text(size: 10pt, tracking: 0.16em, fill: ink.slate, weight: "bold", upper(institute))
  #v(0.1cm)
  #text(size: 8.5pt, fill: ink.slate)[Coastal Observation and Sediment Dynamics Division]
  #v(0.25cm)
  #line(length: 68%, stroke: 0.8pt + ink.rule)
  #v(2.4cm)
  #text(size: 9.5pt, tracking: 0.2em, fill: ink.rust, weight: "bold", upper[Quarterly Research Report])
  #v(0.7cm)
  #text(size: 22pt, weight: "bold", fill: ink.navy)[Tidal Margin Observatory\ Programme]
  #v(0.5cm)
  #text(size: 12.5pt, fill: ink.slate)[Reporting period 1 April to 30 June 2026]
  #v(0.25cm)
  #text(size: 11pt, fill: ink.slate)[Second quarter of programme year two]
  #v(2.2cm)
]

#block(width: 100%, inset: (x: 0pt), {
  set text(size: 9.5pt)
  table(
    columns: (4.2cm, 1fr),
    stroke: (x, y) => (top: if y == 0 { 0.6pt + ink.rule } else { 0.3pt + ink.faint }, bottom: 0.3pt + ink.faint),
    inset: (x: 4pt, y: 5pt),
    [*Report reference*], [HIES-TMOP-QR-2026-02],
    [*Programme grant*], [Northern Coastal Research Council, award NCRC-2024-ES-118],
    [*Reporting officer*], [Dr Ingrid Solvang, Programme Director],
    [*Deputy reporting officer*], [Dr Petra Vasilenko, Head of Data Infrastructure],
    [*Approved by*], [Prof Alasdair Renwick-Poole, Chair, Programme Oversight Board],
    [*Date of issue*], [24 July 2026],
    [*Supersedes*], [HIES-TMOP-QR-2026-01, issued 22 April 2026],
    [*Classification*], [Restricted: programme board and funder],
  )
})

#v(1.1cm)

#block(
  width: 100%,
  fill: rgb("#f2f4f7"),
  inset: 10pt,
  radius: 3pt,
  {
    set text(size: 9pt)
    text(weight: "bold")[Distribution]
    v(0.3em)
    [NCRC Programme Office (2 copies); Hollowmere Institute Executive Board; Programme
    Oversight Board; Estuary Partnership Steering Group; Institute Data Governance
    Committee; Workstream leads WS1 to WS5. Not for onward circulation without the
    written agreement of the reporting officer.]
  },
)

#v(1fr)
#align(center, text(size: 8pt, fill: ink.slate)[
  Prepared under the reporting conditions of award NCRC-2024-ES-118. All observational
  data cited in this report are lodged in the programme archive under the accession
  prefix TMOP-2026Q2.
])

#pagebreak()
#set page(numbering: "i", header: body-header, footer: page-footer("i"))
#counter(page).update(1)

#outline(title: [Contents], depth: 3, indent: auto)

#pagebreak()
#set page(numbering: "1", header: body-header, footer: page-footer("1"))
#counter(page).update(1)

#include "sections/executive-summary.typ"
#include "sections/programme-overview.typ"
#include "sections/workstream-progress.typ"
#include "sections/milestones.typ"
#include "sections/budget.typ"
#include "sections/risks.typ"
#include "sections/publications.typ"
#include "sections/outlook.typ"

#bibliography("refs.bib", style: "ieee", title: [References])
