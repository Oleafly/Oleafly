#let paper-title = [A Clear Title That States Your Main Result]
#let accent = rgb("#1f4e79")

#let authors = (
  (name: "First Author", mark: "1", email: "first.author@example.org"),
  (name: "Second Author", mark: "1", email: "second.author@example.org"),
  (name: "Third Author", mark: "2", email: "third.author@example.com"),
)

#let affiliations = (
  (mark: "1", text: [Department of Computer Science, Example University, City, Country]),
  (mark: "2", text: [Research Lab, Example Institute, City, Country]),
)

#set document(title: paper-title, author: authors.map(a => a.name))
#set page(
  paper: "us-letter",
  margin: (x: 0.75in, top: 0.85in, bottom: 0.9in),
  columns: 2,
  numbering: "1",
)
#set columns(gutter: 0.3in)
#set text(font: "New Computer Modern", size: 10pt, lang: "en")
#set par(justify: true, leading: 0.55em, spacing: 0.6em, first-line-indent: 1em)

#set heading(numbering: "1.1")
#show heading: set text(size: 10pt)
#show heading.where(level: 1): set block(above: 1.3em, below: 0.75em)
#show heading.where(level: 1): set text(size: 11pt, fill: accent)
#show heading.where(level: 2): set block(above: 1em, below: 0.6em)
#show heading.where(level: 2): set text(style: "italic")

#set math.equation(numbering: "(1)")
#set figure(gap: 0.8em)
#show figure.caption: set text(size: 8.5pt)
#show figure.where(kind: table): set figure.caption(position: top)
#set table(stroke: none, inset: (x: 6pt, y: 3.5pt))
#set list(indent: 0.6em)
#show link: set text(fill: accent)

#place(top + center, float: true, scope: "parent", clearance: 1.8em)[
  #align(center)[
    #block(width: 85%)[
      #set par(justify: false)
      #text(size: 18pt, weight: "bold", paper-title)
    ]
    #v(0.9em)
    #grid(
      columns: (1fr,) * authors.len(),
      ..authors.map(a => [
        #text(size: 11pt, a.name)#super(a.mark) \
        #text(size: 8.5pt, raw(a.email))
      ]),
    )
    #v(0.6em)
    #text(size: 8.5pt)[
      #for a in affiliations [
        #super(a.mark)#a.text \
      ]
    ]
  ]
  #v(0.4em)
  #line(length: 100%, stroke: 0.5pt + accent)
]

#block(inset: (bottom: 0.3em))[
  #set par(first-line-indent: 0em)
  #set text(size: 9pt)
  *Abstract.* Summarize the paper in one short paragraph. Name the problem and
  the gap in current work. Describe your method in a sentence or two. Then give
  the main result as a number the reader can remember. End with what the result
  means for the field.

  #v(0.3em)
  *Keywords.* typesetting, document engineering, evaluation
]

= Introduction
Open with the problem your paper solves. Say why it matters and who benefits.
Then state your main idea in one or two sentences. A reader should know what
you did by the end of this section.

Close the introduction with your contributions.
- A precise statement of the problem.
- A method that is simple to reproduce.
- An evaluation on two public datasets.

= Related Work
Group earlier work by approach, not by paper. Cite sources by key, as in
@knuth1984 and @lamport1994. Explain how your work differs from each group.
Classic results such as @knuthplass1981 still shape modern systems. Recent work
on programmable markup @maedje2022 and incremental compilation @haug2022 shows
where the field is heading.

= Method <sec:method>
Describe the approach so that another team could build it. Define each symbol
when you first use it. We train a model $p_theta$ on $N$ labeled pairs
$(x_i, y_i)$ and minimize the loss in @eq:loss.

$ cal(L)(theta) = -1 / N sum_(i=1)^N log p_theta (y_i | x_i) $ <eq:loss>

== Implementation
Give the settings a reader needs to repeat the work. List the hardware, the
training time and every hyperparameter you tuned.

= Experiments
@tab:results compares the method with two baselines. @fig:results shows the
same numbers as a chart. Report the mean over several runs where you can.

#figure(
  table(
    columns: (auto, 1fr, 1fr, 1fr),
    align: (left, center, center, center),
    table.hline(stroke: 0.8pt),
    table.header([*Method*], [*Precision*], [*Recall*], [*F1*]),
    table.hline(stroke: 0.4pt),
    [Baseline], [0.71], [0.65], [0.68],
    [Prior work], [0.78], [0.72], [0.75],
    [Ours], [*0.84*], [*0.80*], [*0.82*],
    table.hline(stroke: 0.8pt),
  ),
  caption: [Results on the test set. Higher is better.],
) <tab:results>

#let scores = (("Baseline", 0.68), ("Prior work", 0.75), ("Ours", 0.82))
#figure(
  box(width: 92%, height: 3.4cm, {
    let chart-height = 2.6cm
    for tick in (0, 0.25, 0.5, 0.75, 1.0) {
      place(
        bottom + left,
        dy: -0.6cm - tick * chart-height,
        line(length: 100%, stroke: (paint: luma(210), thickness: 0.4pt)),
      )
      place(
        bottom + left,
        dx: -0.75cm,
        dy: -0.6cm - tick * chart-height + 0.15cm,
        box(width: 0.65cm, align(right, text(size: 7pt, str(tick)))),
      )
    }
    place(bottom + left, grid(
      columns: (1fr,) * scores.len(),
      column-gutter: 0.5cm,
      align: center + bottom,
      ..scores.map(((label, value)) => rect(
        width: 70%,
        height: value * chart-height,
        fill: if label == "Ours" { accent } else { accent.lighten(55%) },
      )),
      ..scores.map(((label, value)) => box(height: 0.6cm, align(
        horizon,
        text(size: 7.5pt, label),
      ))),
    ))
  }),
  caption: [F1 score by method on the test set.],
) <fig:results>

== Ablation
Remove one part of the method at a time and report the change. This tells the
reader which parts carry the result.

= Discussion
Explain what the numbers mean. Be honest about failure cases and about the
limits of your evaluation. Point to open questions that follow from your work.

= Conclusion
Restate the problem and the main result in a few sentences. Say what you plan to
do next.

#heading(numbering: none)[Acknowledgments]
Thank the people and funding sources that supported this work.

#show bibliography: set text(size: 8.5pt)
#bibliography("refs.bib", title: [References], style: "ieee")
