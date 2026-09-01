#let accent = rgb("#1f4e79")
#let accent2 = rgb("#a8431f")
#let accent3 = rgb("#2f7d4f")
#let accent4 = rgb("#6b4c9a")
#let faint = luma(88%)

#let in-appendix = state("thesis-in-appendix", false)

#let defcount = counter("thesis-definition")
#let propcount = counter("thesis-proposition")

#let callout(kind, name, body, tint: accent) = block(
  width: 100%,
  fill: luma(97%),
  stroke: (left: 1.8pt + tint),
  inset: (left: 9pt, right: 9pt, top: 7pt, bottom: 7pt),
  radius: (top-right: 2pt, bottom-right: 2pt),
  breakable: true,
)[
  #text(weight: "bold")[#kind.] #if name != none { text(style: "italic")[(#name)] }
  #body
]

#let definition(name, body) = {
  defcount.step()
  context callout([Definition #defcount.display()], name, body, tint: accent)
}

#let proposition(name, body) = {
  propcount.step()
  context callout([Proposition #propcount.display()], name, body, tint: accent2)
}

#let remark(body) = block(
  width: 100%,
  inset: (left: 9pt, right: 9pt, top: 6pt, bottom: 6pt),
  stroke: (left: 1.2pt + luma(60%)),
)[#text(size: 9.5pt)[#body]]

#let plotbox(w, h, body) = box(
  width: w + 2.3cm,
  height: h + 1.5cm,
  place(dx: 1.9cm, dy: 0.7cm, box(width: w, height: h, body)),
)

#let axes(w, h, xticks: (), yticks: (), xlabel: none, ylabel: none) = {
  place(dx: 0pt, dy: h, line(length: w, stroke: 0.7pt))
  place(dx: 0pt, dy: 0pt, line(angle: 90deg, length: h, stroke: 0.7pt))
  for t in xticks {
    place(dx: t.at(0) * w, dy: h, line(angle: 90deg, length: 3pt, stroke: 0.7pt))
    place(
      dx: t.at(0) * w - 0.85cm,
      dy: h + 5pt,
      box(width: 1.7cm, align(center, text(size: 7pt, t.at(1)))),
    )
  }
  for t in yticks {
    place(dx: -3pt, dy: (1.0 - t.at(0)) * h, line(length: 3pt, stroke: 0.7pt))
    place(
      dx: -1.75cm,
      dy: (1.0 - t.at(0)) * h - 5pt,
      box(width: 1.6cm, align(right, text(size: 7pt, t.at(1)))),
    )
  }
  if xlabel != none {
    place(dx: 0pt, dy: h + 0.5cm, box(width: w, align(center, text(size: 8pt, xlabel))))
  }
  if ylabel != none {
    place(dx: -1.85cm, dy: -0.62cm, box(width: 3.4cm, align(left, text(size: 8pt, ylabel))))
  }
}

#let gridlines(w, h, ys) = {
  for y in ys {
    place(
      dx: 0pt,
      dy: (1.0 - y) * h,
      line(length: w, stroke: (paint: luma(80%), thickness: 0.4pt, dash: "dotted")),
    )
  }
}

#let series(w, h, pts, color: black, thickness: 1pt, dash: none) = {
  let cs = pts.map(p => (p.at(0) * w, (1.0 - p.at(1)) * h))
  place(curve(
    stroke: (paint: color, thickness: thickness, dash: dash),
    curve.move(cs.first()),
    ..cs.slice(1).map(c => curve.line(c)),
  ))
}

#let dots(w, h, pts, color: black, r: 1.7pt) = {
  for p in pts {
    place(
      dx: p.at(0) * w - r,
      dy: (1.0 - p.at(1)) * h - r,
      circle(radius: r, fill: color, stroke: none),
    )
  }
}

#let squares(w, h, pts, color: black, s: 3.4pt) = {
  for p in pts {
    place(
      dx: p.at(0) * w - s / 2,
      dy: (1.0 - p.at(1)) * h - s / 2,
      rect(width: s, height: s, fill: color, stroke: none),
    )
  }
}

#let errbars(w, h, pts, color: black) = {
  for p in pts {
    let e = p.at(2)
    place(
      dx: p.at(0) * w,
      dy: (1.0 - p.at(1) - e) * h,
      line(angle: 90deg, length: 2 * e * h, stroke: 0.6pt + color),
    )
    place(dx: p.at(0) * w - 2pt, dy: (1.0 - p.at(1) - e) * h, line(length: 4pt, stroke: 0.6pt + color))
    place(dx: p.at(0) * w - 2pt, dy: (1.0 - p.at(1) + e) * h, line(length: 4pt, stroke: 0.6pt + color))
  }
}

#let vbars(w, h, vals, color: luma(65%), frac: 0.62, offset: 0.0) = {
  let n = vals.len()
  let slot = w / n
  for (i, v) in vals.enumerate() {
    let bw = slot * frac
    place(
      dx: i * slot + (slot - bw) / 2 + offset * bw,
      dy: (1.0 - v) * h,
      rect(width: bw, height: v * h, fill: color, stroke: 0.4pt + luma(25%)),
    )
  }
}

#let swatch(color) = box(width: 9pt, height: 4pt, fill: color, baseline: -1pt)

#let legendbox(items) = block(
  inset: 4pt,
  stroke: 0.4pt + luma(70%),
  fill: white,
  radius: 2pt,
)[
  #stack(
    dir: ttb,
    spacing: 3.5pt,
    ..items.map(it => text(size: 7.5pt)[#swatch(it.at(1)) #h(3pt) #it.at(0)]),
  )
]

#let node(x, y, w, h, body, fill: white, dash: none, size: 8pt) = place(
  dx: x,
  dy: y,
  box(
    width: w,
    height: h,
    fill: fill,
    radius: 2pt,
    inset: 4pt,
    stroke: (paint: luma(25%), thickness: 0.7pt, dash: dash),
    align(center + horizon, text(size: size, body)),
  ),
)

#let arrowhead(x, y, dir: "right", color: black) = {
  let a = 3.8pt
  let b = 2.3pt
  if dir == "right" {
    place(dx: x - a, dy: y - b, polygon(fill: color, (0pt, 0pt), (a, b), (0pt, 2 * b)))
  } else if dir == "left" {
    place(dx: x, dy: y - b, polygon(fill: color, (a, 0pt), (0pt, b), (a, 2 * b)))
  } else if dir == "down" {
    place(dx: x - b, dy: y - a, polygon(fill: color, (0pt, 0pt), (b, a), (2 * b, 0pt)))
  } else {
    place(dx: x - b, dy: y, polygon(fill: color, (0pt, a), (b, 0pt), (2 * b, a)))
  }
}

#let seg(x1, y1, x2, y2, color: black, dash: none, thickness: 0.7pt) = place(curve(
  stroke: (paint: color, thickness: thickness, dash: dash),
  curve.move((x1, y1)),
  curve.line((x2, y2)),
))

#let harrow(x, y, len, color: black, dash: none) = {
  place(dx: x, dy: y, line(length: len, stroke: (paint: color, thickness: 0.7pt, dash: dash)))
  arrowhead(x + len, y, dir: if len < 0pt { "left" } else { "right" }, color: color)
}

#let varrow(x, y, len, color: black, dash: none) = {
  place(dx: x, dy: y, line(angle: 90deg, length: len, stroke: (paint: color, thickness: 0.7pt, dash: dash)))
  arrowhead(x, y + len, dir: if len < 0pt { "up" } else { "down" }, color: color)
}

#let lbl(x, y, body, size: 7.5pt, w: 2.6cm, al: center) = place(
  dx: x,
  dy: y,
  box(width: w, align(al, text(size: size, body))),
)
