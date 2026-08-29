#let accent-definition = rgb("#1f4e79")
#let accent-theorem = rgb("#7a3b1d")
#let accent-remark = rgb("#3d5a45")

#let series-a = rgb("#1f4e79")
#let series-b = rgb("#b4531f")
#let series-c = rgb("#3d6b4a")
#let series-d = rgb("#6b4c86")
#let rule-grey = luma(72%)

#let defn-counter = counter("dsh-definition")
#let thm-counter = counter("dsh-theorem")
#let rem-counter = counter("dsh-remark")

#let reset-callouts = {
  defn-counter.update(0)
  thm-counter.update(0)
  rem-counter.update(0)
}

#let callout(kind, ctr, accent, title, body) = {
  ctr.step()
  block(
    width: 100%,
    breakable: true,
    fill: accent.lighten(94%),
    stroke: (left: 2.2pt + accent),
    inset: (left: 10pt, right: 9pt, top: 8pt, bottom: 8pt),
    radius: (top-right: 2pt, bottom-right: 2pt),
    above: 10pt,
    below: 10pt,
  )[
    #context {
      let chapter = counter(heading).get()
      let index = ctr.get().first()
      let stamp = if chapter.len() > 0 and chapter.first() > 0 {
        str(chapter.first()) + "." + str(index)
      } else {
        str(index)
      }
      text(fill: accent, weight: "bold")[#kind #stamp]
      if title != none {
        text(fill: accent, weight: "bold")[ (#title)]
      }
      text(fill: accent, weight: "bold")[.]
      h(5pt)
    }
    #body
  ]
}

#let definition(title, body) = callout("Definition", defn-counter, accent-definition, title, body)
#let theorem(title, body) = callout("Result", thm-counter, accent-theorem, title, body)
#let remark(body) = callout("Remark", rem-counter, accent-remark, none, body)

#let px(value, lo, hi, span) = span * ((value - lo) / (hi - lo))
#let py(value, lo, hi, span) = span * (1.0 - (value - lo) / (hi - lo))

#let polyline(points, stroke: 0.9pt + black) = curve(
  stroke: stroke,
  curve.move(points.first()),
  ..points.slice(1).map(point => curve.line(point)),
)

#let axes(w, h, stroke: 0.7pt + luma(30%)) = {
  place(dx: 0pt, dy: h, line(length: w, stroke: stroke))
  place(dx: 0pt, dy: 0pt, line(angle: 90deg, length: h, stroke: stroke))
}

#let gridlines-y(w, h, count, stroke: 0.4pt + luma(85%)) = {
  for i in range(1, count + 1) {
    place(dx: 0pt, dy: h * (1.0 - i / count), line(length: w, stroke: stroke))
  }
}

#let xtick(x, h, body) = {
  place(dx: x, dy: h, line(angle: 90deg, length: 3pt, stroke: 0.6pt + luma(30%)))
  place(dx: x - 18pt, dy: h + 5pt, box(width: 36pt, align(center, text(size: 7pt, body))))
}

#let ytick(y, body) = {
  place(dx: -3pt, dy: y, line(length: 3pt, stroke: 0.6pt + luma(30%)))
  place(dx: -34pt, dy: y - 4.5pt, box(width: 30pt, align(right, text(size: 7pt, body))))
}

#let xlabel(w, h, body) = place(
  dx: 0pt,
  dy: h + 17pt,
  box(width: w, align(center, text(size: 8pt, body))),
)

#let ylabel(h, body) = place(
  dx: -93pt,
  dy: h / 2 - 5pt,
  rotate(-90deg, reflow: false, box(width: 90pt, align(center, text(size: 8pt, body)))),
)

#let chart(w, h, body) = pad(
  left: 58pt,
  right: 6pt,
  top: 6pt,
  bottom: 26pt,
  box(width: w, height: h, body),
)

#let swatch(colour, body) = box(baseline: 0pt)[
  #box(width: 13pt, height: 2.2pt, fill: colour, baseline: -2.5pt)
  #text(size: 8pt, body)
]

#let marker(x, y, colour, radius: 1.9pt) = place(
  dx: x - radius,
  dy: y - radius,
  circle(radius: radius, fill: colour, stroke: none),
)

#let node(x, y, w, h, body, fill: white, stroke: 0.7pt + luma(30%)) = place(
  dx: x,
  dy: y,
  box(
    width: w,
    height: h,
    fill: fill,
    stroke: stroke,
    radius: 2pt,
    inset: 4pt,
    align(center + horizon, text(size: 7.5pt, body)),
  ),
)

#let connect(x1, y1, x2, y2, stroke: 0.7pt + luma(30%)) = place(
  polyline(((x1, y1), (x2, y2)), stroke: stroke),
)

#let arrow-head(x, y, direction, colour: luma(30%), size: 3.4pt) = {
  let pts = if direction == "down" {
    ((x, y), (x - size * 0.6, y - size), (x + size * 0.6, y - size))
  } else if direction == "right" {
    ((x, y), (x - size, y - size * 0.6), (x - size, y + size * 0.6))
  } else {
    ((x, y), (x - size * 0.6, y + size), (x + size * 0.6, y + size))
  }
  place(polygon(fill: colour, stroke: none, ..pts))
}

#let book-table(..args) = table(
  stroke: none,
  inset: (x: 6pt, y: 4pt),
  ..args,
)
