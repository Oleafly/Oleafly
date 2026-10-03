#let report-title = [Evaluation of a New Data Pipeline]
#let report-subtitle = [Design, measurements and recommendations]
#let report-number = "TR-2026-01"
#let organization = [Example Organization]
#let prepared-for = [Engineering Leadership Team]
#let authors = ("First Author", "Second Author")
#let issued = datetime.today().display("[month repr:long] [day padding:none], [year]")
#let accent = rgb("#1c4e80")

#set document(title: report-title, author: authors)
#set page(
  paper: "a4",
  margin: (x: 2.5cm, top: 3cm, bottom: 2.8cm),
  header: context {
    if here().page() > 1 {
      set text(size: 9pt, fill: luma(90))
      grid(
        columns: (1fr, auto),
        report-title, report-number,
      )
      v(-0.5em)
      line(length: 100%, stroke: 0.5pt + accent)
    }
  },
  footer: context {
    if here().page() > 1 {
      set text(size: 9pt, fill: luma(90))
      grid(
        columns: (1fr, auto),
        organization,
        [Page #counter(page).display() of #counter(page).final().first()],
      )
    }
  },
)
#set text(font: "Libertinus Serif", size: 11pt, lang: "en")
#set par(justify: true, leading: 0.7em, spacing: 1.1em)

#set heading(numbering: "1.1")
#show heading: set text(fill: accent)
#show heading.where(level: 1): set text(size: 16pt)
#show heading.where(level: 1): set block(above: 2em, below: 1em)
#show heading.where(level: 2): set text(size: 12.5pt)
#show heading.where(level: 2): set block(above: 1.6em, below: 0.8em)

#set math.equation(numbering: "(1)")
#set figure(gap: 1em)
#show figure.where(kind: table): set figure.caption(position: top)
#show figure.caption: set text(size: 9.5pt)
#set table(
  stroke: (x, y) => if y == 0 { (bottom: 0.8pt + accent) } else { (bottom: 0.4pt + luma(210)) },
  fill: (x, y) => if y == 0 { accent.lighten(88%) },
  inset: (x: 8pt, y: 5pt),
)

#let callout(title, body) = block(
  width: 100%,
  fill: accent.lighten(92%),
  stroke: (left: 3pt + accent),
  inset: (x: 14pt, y: 12pt),
  radius: (right: 3pt),
)[
  #text(weight: "bold", fill: accent, title)
  #v(0.2em)
  #body
]

#let arrow(length: 1.1cm) = box(width: length, height: 6pt, {
  place(left + horizon, line(length: length - 4pt, stroke: 1pt + accent))
  place(right + horizon, polygon(fill: accent, (0pt, 0pt), (6pt, 3pt), (0pt, 6pt)))
})

#let stage(title, detail) = rect(
  width: 2.7cm,
  height: 1.5cm,
  fill: accent.lighten(90%),
  stroke: 0.8pt + accent,
  radius: 4pt,
  inset: 6pt,
  align(center + horizon)[
    #set par(justify: false, leading: 0.5em)
    #text(size: 10pt, weight: "bold", title) \
    #text(size: 8.5pt, fill: luma(70), detail)
  ],
)

#page(margin: 0pt, header: none, footer: none)[
  #block(width: 100%, height: 11cm, fill: accent, inset: (x: 2.5cm, top: 3cm, bottom: 1.5cm))[
    #set text(fill: white)
    #set par(justify: false)
    #text(size: 11pt, tracking: 0.12em, weight: "bold")[TECHNICAL REPORT #h(0.6em) #report-number]
    #v(1.2cm)
    #text(size: 30pt, weight: "bold", report-title)
    #v(0.5cm)
    #text(size: 15pt, style: "italic", report-subtitle)
  ]
  #block(inset: (x: 2.5cm, top: 1.5cm))[
    #set par(justify: false)
    #grid(
      columns: (auto, 1fr),
      column-gutter: 1.2cm,
      row-gutter: 0.9em,
      text(fill: luma(100))[Authors], authors.join(", "),
      text(fill: luma(100))[Organization], organization,
      text(fill: luma(100))[Prepared for], prepared-for,
      text(fill: luma(100))[Date], issued,
      text(fill: luma(100))[Status], [Draft for review],
    )
  ]
  #place(bottom + left, dx: 2.5cm, dy: -2cm, text(size: 9pt, fill: luma(110))[
    This report is for internal use. Replace this note with your own distribution notice.
  ])
]

#heading(numbering: none, outlined: false)[Executive Summary]
Write this section last. Many readers will stop here, so give them everything
they need on one page. State the question the report answers, what you did and
what you found. Then say what you recommend and what it costs.

#callout[Key findings][
  - The new pipeline processes a typical batch 42% faster than the current one.
  - Error rates fall from 1.8% to 0.4% on the same input data.
  - Running costs stay within the current budget.
]

#v(0.6em)
#callout[Recommendation][
  Adopt the new pipeline for all production workloads by the end of the next
  quarter. @sec:recommendations lists the steps and owners.
]

#v(1em)
#outline(title: [Contents], indent: auto, depth: 2)

#pagebreak()

= Introduction <sec:intro>
Explain why this report exists. Name the decision it supports and who will make
it. Keep this section short.

== Purpose
Describe the question the report answers in one or two sentences.

== Scope
Say what the report covers and what it leaves out. Readers trust a report more
when it is clear about its limits.

= Background <sec:background>
Give the context a reader needs. Summarize earlier studies and the current
state of the system. Cite sources by key, as in @knuth1984 and @lamport1994.
Earlier design notes on incremental processing @haug2022 informed this work.

= Approach <sec:approach>
Describe how you did the work so that someone else could repeat it.
@fig:pipeline shows the main stages of the new pipeline.

#figure(
  grid(
    columns: 7,
    align: horizon,
    column-gutter: 3pt,
    stage[Ingest][Read raw records], arrow(),
    stage[Validate][Reject bad input], arrow(),
    stage[Transform][Normalize fields], arrow(),
    stage[Publish][Serve results],
  ),
  caption: [Stages of the new data pipeline.],
) <fig:pipeline>

== Measurements
Explain what you measured and how. Define each metric. We report throughput
$T$ as the number of records $n$ processed in time $t$, as shown in
@eq:throughput.

$ T = n / t quad "records per second" $ <eq:throughput>

== Test setup
List the hardware, the software versions and the data sets. Note anything that
could affect the results.

= Results <sec:results>
Present the results without interpretation first. @tab:results compares the
two pipelines and @fig:throughput shows throughput by batch size.

#figure(
  table(
    columns: (1.6fr, 1fr, 1fr, 1fr),
    align: (left, right, right, right),
    table.header([*Metric*], [*Current*], [*New*], [*Change*]),
    [Batch time (min)], [38.0], [22.1], [-42%],
    [Error rate (%)], [1.8], [0.4], [-78%],
    [Peak memory (GB)], [12.4], [10.9], [-12%],
    [Monthly cost (USD)], [4,200], [3,900], [-7%],
  ),
  caption: [Current and new pipeline on the same workload.],
) <tab:results>

#let batches = (("1k", 120, 180), ("10k", 410, 690), ("100k", 820, 1350), ("1M", 900, 1610))
#figure(
  box(width: 85%, {
    let chart-height = 4cm
    let max-value = 1800
    grid(
      columns: batches.len(),
      column-gutter: 1fr,
      align: center + bottom,
      ..batches.map(((label, old, new)) => stack(
        dir: ltr,
        spacing: 3pt,
        rect(width: 0.6cm, height: old / max-value * chart-height, fill: luma(185)),
        rect(width: 0.6cm, height: new / max-value * chart-height, fill: accent),
      )),
      ..batches.map(((label, old, new)) => pad(top: 4pt, text(size: 9pt, label))),
    )
    v(0.4em)
    align(center, text(size: 9pt)[
      #box(rect(width: 8pt, height: 8pt, fill: luma(185))) Current #h(1.2em)
      #box(rect(width: 8pt, height: 8pt, fill: accent)) New
    ])
  }),
  caption: [Throughput in records per second by batch size. Higher is better.],
) <fig:throughput>

= Discussion <sec:discussion>
Interpret the results. Explain why the new pipeline is faster and where it is
not. Discuss risks, open questions and anything that surprised you.

= Recommendations <sec:recommendations>
Turn the findings into actions. Give each action an owner and a date.
+ Run the new pipeline in parallel with the current one for two weeks.
+ Move half of the workloads once the error rate stays below 0.5%.
+ Retire the current pipeline after a final review.

= Conclusion <sec:conclusion>
Summarize the answer to the question from @sec:intro in a few sentences.

#bibliography("refs.bib", title: [References], style: "ieee")
