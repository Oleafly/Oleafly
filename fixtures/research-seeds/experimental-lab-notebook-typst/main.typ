#import "notebook.typ": *

#show: conf

#page(header: none, footer: none, numbering: none)[
  #set par(justify: false)
  #v(1.2cm)
  #align(center)[
    #text(size: 9.5pt, tracking: 0.14em, fill: accent)[
      #upper[Vasterhamn Institute for Water Process Engineering]
    ]
    #v(2pt)
    #text(size: 9pt, fill: luma(40%))[Group for Advanced Oxidation #sym.dot.c Building K, Laboratory K-204]
    #v(1.3cm)
    #line(length: 40%, stroke: 0.8pt + accent)
    #v(0.5cm)
    #text(size: 21pt, weight: "bold")[Laboratory Notebook NB-7]
    #v(0.35cm)
    #text(size: 13pt)[
      Visible-light photocatalytic degradation of carbamazepine\
      over nitrogen-doped titania
    ]
    #v(0.5cm)
    #line(length: 40%, stroke: 0.8pt + accent)
    #v(1.1cm)
  ]

  #block(
    width: 100%,
    fill: panel,
    inset: (x: 12pt, y: 11pt),
    radius: 2pt,
    stroke: (left: 2pt + accent, rest: 0.4pt + rule-grey),
    grid(
      columns: (auto, 1fr),
      column-gutter: 12pt,
      row-gutter: 6pt,
      ..field("Notebook holder", [Marika Ostrowska-Rehn, doctoral researcher]),
      ..field("Project", [WP-3, AQUAREGEN, grant VIW-2024-118]),
      ..field("Supervisor", [Dr. Halvard Njiru]),
      ..field("Second operator", [Elias Vondracek, MSc candidate]),
      ..field("Laboratory technician", [Ruth Balasingam]),
      ..field("Period covered", [2026-03-04 to 2026-04-22]),
      ..field("Continues from", [Notebook NB-6, closed 2026-02-27]),
      ..field("Archive reference", raw("VIW-NB-2026-007")),
    ),
  )

  #v(0.7cm)

  #heading(level: 2, numbering: none, outlined: false)[Scope]

  This notebook records the second experimental campaign of work package 3. The
  first campaign, closed in NB-6, established that sol-gel nitrogen-doped
  titania calcined at 500 °C absorbs visible light to 445 nm and degrades
  methylene blue under a 420 nm cut-on filter. The present campaign moves from
  a dye probe, which is a poor surrogate because it sensitises its own
  degradation, to carbamazepine, a persistent pharmaceutical that survives
  conventional activated sludge treatment and is therefore a realistic target
  for a polishing step @renner2020carbamazepine. The campaign has four
  objectives: establish a validated analytical method for carbamazepine at
  micromolar concentrations, separate dark adsorption from photocatalytic
  conversion, measure apparent first-order rate constants as a function of
  catalyst loading and pH, and identify which reactive species carries the
  degradation.

  #pagebreak()

  #heading(level: 2, numbering: none, outlined: false)[Instrument inventory]

  #table(
    columns: (auto, 1fr, auto, auto),
    table.hline(stroke: 0.8pt),
    head-row([Tag], [Instrument], [Serial], [Calibration due]),
    table.hline(stroke: 0.5pt),
    raw("SPEC-1"), [Aurelis UV-1900 double-beam spectrophotometer], raw("A19-4471"), [2026-09-30],
    raw("HPLC-2"), [Meridian LC-40 with diode array detector], raw("ML40-2208"), [2026-07-15],
    raw("LAMP-1"), [Solvex XL-300 xenon arc, 300 W, 420 nm cut-on filter], raw("SX-11924"), [not applicable],
    raw("PR-2"), [Annular quartz photoreactor, 250 mL working volume], raw("VIW-PR-002"), [not applicable],
    raw("RAD-1"), [Lumidex RM-21 radiometer, 400 to 700 nm head], raw("RM21-0883"), [2026-06-01],
    raw("CHIL-1"), [Thermalis CT-15 recirculating chiller], raw("CT15-3390"), [2027-01-20],
    raw("PH-1"), [Orenda pH-70 meter with glass electrode], raw("PH70-1145"), [monthly, three point],
    raw("TOC-1"), [Carbomat TOC-9 combustion analyser], raw("TC9-0517"), [2026-08-12],
    raw("BAL-1"), [Kestrel AB-204 analytical balance, 0.1 mg], raw("AB204-6621"), [2026-05-04],
    table.hline(stroke: 0.8pt),
  )

  #v(0.4cm)

  #heading(level: 2, numbering: none, outlined: false)[Safety notes]

  The xenon arc emits ultraviolet radiation and the reactor enclosure must stay
  closed while the lamp is struck. The interlock on the K-204 enclosure is
  tested at the start of every session and the test is logged in each entry.
  Carbamazepine stock solutions are prepared in the fume hood; the compound is
  a reproductive toxicant and is handled with nitrile gloves and a laboratory
  coat. Spent catalyst suspensions are filtered and the recovered solids go to
  the solid inorganic waste stream, never to the drain, because nanoparticulate
  titania passes conventional filtration. Ferrioxalate actinometry solutions
  are prepared and handled under red safelight and are quenched with
  phenanthroline buffer before disposal in the aqueous heavy metal stream.
  p-Benzoquinone, used in the scavenger session, is a severe eye irritant and
  is weighed in the hood behind a shield.

  #v(0.5cm)
  #align(center)[
    #text(size: 8.5pt, fill: luma(40%))[
      Pages are numbered consecutively. Corrections are struck through and
      initialled; no page is removed.
    ]
  ]
]

#outline(title: [Sessions], depth: 2, indent: 1.1em)

#include "entries/2026-03-04-baseline-calibration.typ"
#include "entries/2026-03-11-dark-adsorption.typ"
#include "entries/2026-03-18-failed-illuminated-run.typ"
#include "entries/2026-03-25-protocol-revision.typ"
#include "entries/2026-04-01-kinetic-series.typ"
#include "entries/2026-04-08-replication-ph.typ"
#include "entries/2026-04-15-scavenger-interference.typ"
#include "entries/2026-04-22-interim-synthesis.typ"

#pagebreak()

#bibliography("refs.bib", style: "ieee", title: [References])
