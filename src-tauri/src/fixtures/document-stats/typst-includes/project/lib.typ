#let accent = rgb("#1f77b4")
#let report(title: none, body) = {
  set text(font: "Libertinus Serif")
  align(center, text(size: 18pt, weight: "bold", title))
  body
}
