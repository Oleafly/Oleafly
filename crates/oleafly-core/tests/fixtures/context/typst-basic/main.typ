#set document(title: "Typst basic")
#let accent = rgb("#0074d9")

= Introduction <sec:intro>
Typst writes references as @fig:a and citations as @knuth.
An unknown target: @ghost.

== Method
#figure(rect(width: 1cm), caption: [A box]) <fig:a>

Explicit: #cite(<lamport>) and #ref(<sec:intro>).

#include "chapter.typ"

#bibliography("refs.bib")
