#set document(title: "Working title", author: "Author One")
#set page(paper: "us-letter", margin: 1in, numbering: "1")
#set text(size: 11pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#show heading: set block(above: 1.4em, below: 0.8em)

#align(center)[
  #text(size: 17pt, weight: "bold")[Working title]

  #v(0.6em)
  Author One \
  Institution \
  #link("mailto:author@example.org")
]

#v(1.2em)

#align(center)[
  #block(width: 85%)[
    #set par(justify: true)
    *Abstract.* One paragraph. State the problem, what you did, the single most
    important result with a number, and why it matters. Write this last.
  ]
]

#v(1em)

= Introduction

What question this paper answers, why it is open, and what the paper
contributes. End with an explicit list of contributions.

= Related work

The lines of work this paper sits between, and what each one leaves unsolved.

= Method

The setup, the notation, and the procedure. Define every symbol before using it.

$ cal(L)(theta) = 1/n sum_(i=1)^n ell(f_theta (x_i), y_i) $ <eq-objective>

@eq-objective is the objective optimized throughout.

= Experiments

Data, baselines, protocol, and metrics, in that order. Report uncertainty and
say what it is.

#figure(
  table(
    columns: 3,
    stroke: none,
    table.hline(),
    table.header([Method], [Accuracy (%)], [Latency (ms)]),
    table.hline(),
    [Baseline], [00.0], [000],
    [This work], [00.0], [000],
    table.hline(),
  ),
  caption: [Results on the evaluation suite. Replace with real numbers.],
) <tab-results>

= Conclusion

What is now known that was not known before, and the concrete limitation a
reader should carry away.
