#import "lib.typ": *
#set page(width: 12cm)
#show: report.with(title: "Typst include walk")

= Introduction
Prose with inline $x^2 + y^2$ and display $ sum_(i=1)^n x_i $ math.

#include "sections/intro.typ"
#include "sections/method"
// #include "sections/never.typ"
/* #include "sections/never-block.typ" */
#include "@preview/example:0.1.0"
#include "sections/missing.typ"
#bibliography("refs.bib")
