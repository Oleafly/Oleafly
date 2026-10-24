#import "@preview/charged-ieee:0.1.0": ieee
#show: ieee.with(
  title: [A Typst Paper],
  authors: ((name: "Ana Example", email: "ana@example.com"),),
  abstract: [We study things.],
)
#include "chapters/intro.typ"
= Results
#figure(image("figs/plot.png"), caption: []) <fig:plot>
See @fig:plot and @fig:nope. Mail ana@example.org.
#cite(<known>) #cite(<unknown>)
#image("/Users/ana/x.png")
#image("figs/missing.png")
TODO: finish.
= 
#lorem(5)
= Results again <sec:dup>
= Other <sec:dup>
#bibliography(("refs.bib", "extra.yml"))
