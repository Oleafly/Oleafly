#set document(title: "A Short Report", author: "Your Name")
#set page(numbering: "1", margin: 2.2cm)
#set text(size: 11pt)
#set par(justify: true, leading: 0.62em, first-line-indent: 1.2em)
#set heading(numbering: "1.1")
#show heading.where(level: 1): set text(size: 13pt)

#align(center)[
  #text(size: 18pt, weight: "bold")[A Short Report on Something Interesting]
  #v(5pt)
  Your Name #h(0.8em) #sym.dot.c #h(0.8em) January 2026
]
#v(8pt)

#block(width: 100%, inset: (x: 8%))[
  #set text(size: 10pt)
  #set par(first-line-indent: 0em)
  *Abstract.* This report summarizes the motivation, method, and findings of the
  study. Replace this text with a concise, self-contained summary.
]
#v(8pt)

= Introduction
State the problem and why it matters. You can cross-reference sections such as
@sec-method, and add figures and tables.

= Method <sec-method>
Describe the approach.

== Data
Explain the data sources and preparation.

= Results
Present the results, with figures where useful.

= Conclusion
Summarize the findings and outline future work.
