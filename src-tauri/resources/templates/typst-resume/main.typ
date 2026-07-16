#set document(title: "Alex Chen Resume")
#set page(margin: (x: 1.6cm, y: 1.4cm))
#set text(size: 10.5pt)
#set par(justify: false)
#show heading: it => block(above: 10pt, below: 6pt)[
  #text(size: 11pt, weight: "bold", upper(it.body))
  #v(-4pt)
  #line(length: 100%, stroke: 0.4pt)
]

#align(center)[
  #text(size: 20pt, weight: "bold")[Alex Chen] \
  #v(2pt)
  Software Engineer #sym.dot.c alex.chen\@example.com #sym.dot.c +1 (555) 123-4567 #sym.dot.c San Francisco, CA
]
#v(4pt)

= Experience
*Senior Software Engineer*, Acme Corp #h(1fr) 2021 -- Present \
- Led the billing pipeline redesign, cutting p95 latency by 40%.
- Mentored four engineers and introduced a code-review rubric.

*Software Engineer*, Globex #h(1fr) 2019 -- 2021 \
- Shipped the customer analytics dashboard used by 3,000 teams.

= Education
*B.S. in Computer Science*, State University #h(1fr) 2015 -- 2019

= Skills
Rust, TypeScript, React, PostgreSQL, distributed systems.
