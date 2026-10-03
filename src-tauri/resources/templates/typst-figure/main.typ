#set page(width: auto, height: auto, margin: 8pt)
#set text(font: "New Computer Modern", size: 11pt)

#let ink = luma(60)

#let node(body, fill: luma(240)) = rect(
  width: 3.2cm,
  height: 1cm,
  fill: fill,
  stroke: 0.9pt + ink,
  radius: 5pt,
  align(center + horizon, body),
)

#let arrow-down(length: 1.1cm, label: none) = box(width: 3.2cm, height: length, {
  place(center + top, line(start: (0pt, 0pt), end: (0pt, length - 6pt), stroke: 0.9pt + ink))
  place(center + bottom, polygon(fill: ink, (0pt, 0pt), (7pt, 0pt), (3.5pt, 6pt)))
  if label != none {
    place(left + horizon, dx: 1.75cm, text(size: 8.5pt, style: "italic", fill: ink, label))
  }
})

#grid(
  columns: 1,
  align: center,
  node(fill: rgb("#dbe4ff"))[Input],
  arrow-down(label: [features]),
  node(fill: rgb("#e5dbff"))[Encoder],
  arrow-down(label: [embedding]),
  node(fill: rgb("#d3f9d8"))[Classifier],
)
