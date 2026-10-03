#let thesis-title = [A Study of Something Important]
#let thesis-subtitle = [Methods, Results and Open Questions]
#let author = "Your Name"
#let degree = [Master of Science in Computer Science]
#let university = [University Name]
#let department = [Department of Computer Science]
#let supervisor = [Prof. Supervisor Name]
#let submitted = datetime.today().display("[month repr:long] [year]")
#let accent = rgb("#7b2d43")

#set document(title: thesis-title, author: author)
#set page(paper: "a4", margin: (x: 3cm, top: 3cm, bottom: 3.2cm))
#set text(font: "Libertinus Serif", size: 11.5pt, lang: "en")
#set par(justify: true, leading: 0.8em, spacing: 1.2em, first-line-indent: 1.2em)

#set heading(numbering: "1.1")
#show heading: set text(fill: accent)
#show heading.where(level: 2): set block(above: 1.8em, below: 1em)
#show heading.where(level: 2): set text(size: 13pt)
#show heading.where(level: 3): set text(size: 11.5pt, style: "italic")

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  counter(figure.where(kind: image)).update(0)
  counter(figure.where(kind: table)).update(0)
  counter(math.equation).update(0)
  set par(first-line-indent: 0em, justify: false)
  block(width: 100%, inset: (top: 2.5cm, bottom: 1.2cm), {
    if it.numbering != none {
      text(size: 13pt, fill: accent, smallcaps[#it.supplement #counter(heading).display(it.numbering)])
      v(0.2em)
    }
    text(size: 24pt, weight: "bold", fill: accent, it.body)
  })
}
#show heading.where(level: 1): set heading(supplement: [Chapter])

#let chapter-numbering(pattern) = n => {
  let chapter = counter(heading).get().first()
  let prefix = if query(heading.where(numbering: "A.1").before(here())).len() > 0 {
    numbering("A", chapter)
  } else {
    str(chapter)
  }
  prefix + "." + numbering(pattern, n)
}

#set figure(numbering: chapter-numbering("1"), gap: 1em)
#set math.equation(numbering: n => "(" + chapter-numbering("1")(n) + ")")
#show figure.where(kind: table): set figure.caption(position: top)
#show figure.caption: set text(size: 10pt)
#set table(stroke: none, inset: (x: 8pt, y: 5pt))

#let arrow(length: 1cm, paint: accent) = box(width: length, height: 6pt, {
  place(left + horizon, line(length: length - 4pt, stroke: 0.9pt + paint))
  place(right + horizon, polygon(fill: paint, (0pt, 0pt), (6pt, 3pt), (0pt, 6pt)))
})

#let stage(body) = rect(
  fill: accent.lighten(88%),
  stroke: 0.8pt + accent,
  radius: 4pt,
  inset: (x: 10pt, y: 9pt),
  text(size: 10pt, body),
)

#page(numbering: none, margin: (x: 2.5cm, y: 3cm))[
  #set align(center)
  #set par(justify: false, first-line-indent: 0em)
  #text(size: 13pt, smallcaps(university)) \
  #text(size: 11pt, department)
  #v(1fr)
  #line(length: 60%, stroke: 0.8pt + accent)
  #v(0.8cm)
  #text(size: 26pt, weight: "bold", fill: accent, thesis-title)
  #v(0.4cm)
  #text(size: 15pt, style: "italic", thesis-subtitle)
  #v(0.8cm)
  #line(length: 60%, stroke: 0.8pt + accent)
  #v(1.5cm)
  #text(size: 11pt)[by] \
  #v(0.2cm)
  #text(size: 16pt, author)
  #v(1fr)
  A thesis submitted in partial fulfillment of the requirements \
  for the degree of #degree
  #v(1cm)
  Supervised by #supervisor
  #v(1cm)
  #submitted
]

#set page(numbering: "i")
#counter(page).update(1)

#heading(numbering: none, outlined: false)[Abstract]
Summarize the whole thesis on one page. State the problem and why it matters.
Describe your approach in a few sentences. Give the main results with numbers
where you have them. End with the most important conclusion.

Keep the abstract self-contained. A reader should understand it without the
rest of the thesis.

#heading(numbering: none, outlined: false)[Acknowledgments]
Thank your supervisor, your colleagues and the people who supported you. Name
any funding sources and grant numbers here.

#[
  #show outline.entry.where(level: 1): set block(above: 1.1em)
  #show outline.entry.where(level: 1): strong
  #outline(title: [Contents], indent: auto)
]

#outline(title: [List of Figures], target: figure.where(kind: image))

#outline(title: [List of Tables], target: figure.where(kind: table))

#set page(
  numbering: "1",
  header: context {
    let here-page = here().page()
    let starts-chapter = query(heading.where(level: 1)).any(h => h.location().page() == here-page)
    let previous = query(heading.where(level: 1).before(here()))
    if not starts-chapter and previous.len() > 0 {
      set text(size: 9.5pt, style: "italic", fill: luma(90))
      align(right, previous.last().body)
      v(-0.6em)
      line(length: 100%, stroke: 0.4pt + luma(170))
    }
  },
)
#counter(page).update(1)

= Introduction <ch:intro>
Introduce the problem and the setting. Explain why the problem is worth a
thesis. Then give a short preview of your answer. Each chapter starts on a new
page and appears in the table of contents.

== Motivation
Describe the situation that led to this work. Use a concrete example if you
can. Readers remember examples better than definitions.

== Research questions
State the questions this thesis answers. Number them so later chapters can
refer back.
+ What limits current methods in this setting?
+ Can a simpler method match or beat them?
+ Which parts of the method matter most?

== Contributions
List what is new in this thesis. Point to the chapter that covers each item.
For example, @ch:method introduces the method and @ch:results reports the
results.

== Structure of the thesis
Give a one-line summary of each remaining chapter.

= Background <ch:background>
Cover the background a reader needs and the most relevant related work. Cite
sources by key, as in @knuth1984 and @lamport1994. Group related work by idea,
not by paper.

== Foundations
Explain the concepts the rest of the thesis builds on. Classic work such as
#cite(<knuthplass1981>, form: "prose") often belongs here.

== Related work
Compare the closest approaches with yours. Recent work on programmable markup
@maedje2022 and incremental compilation @haug2022 are examples of sources you
might discuss.

= Method <ch:method>
Describe your approach in enough detail that someone else could build it.
@fig:pipeline gives an overview of the main stages.

#figure(
  grid(
    columns: 7,
    align: horizon,
    column-gutter: 4pt,
    stage[Raw data], arrow(), stage[Cleaning], arrow(), stage[Model], arrow(), stage[Evaluation],
  ),
  caption: [Overview of the method. Each stage feeds the next.],
) <fig:pipeline>

== Model
Define every symbol when you first use it. The model assigns a score to each
input $x$ with weights $w$ and bias $b$, as shown in @eq:model.

$ f(x) = sigma(w^top x + b), quad sigma(z) = 1 / (1 + e^(-z)) $ <eq:model>

== Training
Explain how you fit the model. Give the loss, the optimizer and the stopping
rule. @tab:settings in @app:extra lists the settings used in every experiment.

= Results <ch:results>
Present the results and discuss what they mean. Start with the main comparison
in @tab:main. Then show the details.

#figure(
  table(
    columns: (auto, 1fr, 1fr, 1fr),
    align: (left, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header([*Method*], [*Accuracy*], [*Runtime (s)*], [*Memory (MB)*]),
    table.hline(stroke: 0.5pt),
    [Baseline], [81.2], [14.0], [512],
    [Prior work], [85.7], [22.5], [740],
    [This thesis], [*88.9*], [*9.8*], [*430*],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Main results on the test set.],
) <tab:main>

== Discussion
Interpret the numbers. Explain where the method works well and where it fails.
Be honest about the limits of the evaluation.

= Conclusion <ch:conclusion>
Answer the research questions from @ch:intro in turn. Summarize what the thesis
adds to the field.

== Future work
Describe the next steps that follow from your results.

#bibliography("refs.bib", title: [Bibliography], style: "chicago-author-date")

#set heading(numbering: "A.1")
#show heading.where(level: 1): set heading(supplement: [Appendix])
#counter(heading).update(0)

= Additional Results <app:extra>
Put material here that supports the thesis but would interrupt the main text.
Examples are full tables, proofs and extra figures.

#figure(
  table(
    columns: (1fr, 1fr, 1fr),
    align: center,
    table.hline(stroke: 0.9pt),
    table.header([*Setting*], [*Value*], [*Notes*]),
    table.hline(stroke: 0.5pt),
    [Learning rate], [0.001], [Fixed],
    [Batch size], [64], [Per device],
    [Epochs], [30], [Early stopping],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Training settings used in all experiments.],
) <tab:settings>
