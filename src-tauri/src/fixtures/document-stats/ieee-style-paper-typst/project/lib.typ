#let chart(
  width: 240pt,
  height: 130pt,
  pad-left: 30pt,
  pad-bottom: 24pt,
  pad-top: 8pt,
  pad-right: 8pt,
  xrange: (0, 1),
  yrange: (0, 1),
  xticks: (),
  yticks: (),
  xlabel: none,
  ylabel: none,
  grid: true,
  body: (px, py) => none,
) = {
  let plot-w = width - pad-left - pad-right
  let plot-h = height - pad-top - pad-bottom
  let (x0, x1) = xrange
  let (y0, y1) = yrange
  let px(v) = pad-left + plot-w * (v - x0) / (x1 - x0)
  let py(v) = pad-top + plot-h * (1.0 - (v - y0) / (y1 - y0))
  box(width: width, height: height, {
    if grid {
      for (v, _) in yticks {
        place(line(
          start: (px(x0), py(v)),
          end: (px(x1), py(v)),
          stroke: 0.4pt + luma(205),
        ))
      }
      for (v, _) in xticks {
        place(line(
          start: (px(v), py(y0)),
          end: (px(v), py(y1)),
          stroke: 0.4pt + luma(226),
        ))
      }
    }
    place(line(start: (px(x0), py(y0)), end: (px(x1), py(y0)), stroke: 0.6pt))
    place(line(start: (px(x0), py(y0)), end: (px(x0), py(y1)), stroke: 0.6pt))
    for (v, label) in yticks {
      place(
        dx: 0pt,
        dy: py(v) - 4pt,
        box(width: pad-left - 5pt, align(right, text(size: 6.5pt, label))),
      )
    }
    for (v, label) in xticks {
      place(
        dx: px(v) - 14pt,
        dy: py(y0) + 3pt,
        box(width: 28pt, align(center, text(size: 6.5pt, label))),
      )
    }
    if xlabel != none {
      place(
        dx: pad-left,
        dy: height - 10pt,
        box(width: plot-w, align(center, text(size: 7pt, xlabel))),
      )
    }
    if ylabel != none {
      place(
        dx: 4pt - plot-h / 2,
        dy: pad-top + plot-h / 2 - 5pt,
        rotate(-90deg, reflow: false, box(width: plot-h, align(center, text(size: 7pt, ylabel)))),
      )
    }
    body(px, py)
  })
}

#let series(px, py, points, stroke: 1pt + black, mark: none) = {
  let steps = ()
  for (i, p) in points.enumerate() {
    let pt = (px(p.at(0)), py(p.at(1)))
    steps.push(if i == 0 { curve.move(pt) } else { curve.line(pt) })
  }
  place(curve(stroke: stroke, ..steps))
  if mark != none {
    for p in points {
      place(
        dx: px(p.at(0)) - 1.6pt,
        dy: py(p.at(1)) - 1.6pt,
        circle(radius: 1.6pt, fill: mark, stroke: none),
      )
    }
  }
}

#let bars(px, py, baseline, entries, width: 9pt, fill: luma(150)) = {
  for (v, h) in entries {
    let top = py(h)
    place(
      dx: px(v) - width / 2,
      dy: top,
      rect(width: width, height: py(baseline) - top, fill: fill, stroke: 0.4pt + black),
    )
  }
}

#let legend(entries, size: 6.5pt) = {
  set text(size: size)
  stack(
    dir: ttb,
    spacing: 3pt,
    ..entries.map(((color, dash, label)) => stack(
      dir: ltr,
      spacing: 4pt,
      box(width: 14pt, baseline: -2pt, line(length: 14pt, stroke: (paint: color, thickness: 1pt, dash: dash))),
      label,
    )),
  )
}

#let arrowhead(at, angle, size: 4pt, fill: black) = {
  let (x, y) = at
  place(
    dx: x - size * calc.cos(angle) / 2 - size / 2,
    dy: y - size * calc.sin(angle) / 2 - size / 2,
    rotate(angle, reflow: false, polygon(
      fill: fill,
      stroke: none,
      (0pt, 0pt),
      (size, size / 2),
      (0pt, size),
    )),
  )
}

#let arrow(from, to, stroke: 0.6pt + black, size: 4pt) = {
  place(line(start: from, end: to, stroke: stroke))
  let angle = calc.atan2(to.at(0).pt() - from.at(0).pt(), to.at(1).pt() - from.at(1).pt())
  arrowhead(to, angle, size: size, fill: stroke.paint)
}

#let elbow(points, stroke: 0.6pt + black, size: 4pt) = {
  for i in range(points.len() - 1) {
    place(line(start: points.at(i), end: points.at(i + 1), stroke: stroke))
  }
  let a = points.at(points.len() - 2)
  let b = points.at(points.len() - 1)
  let angle = calc.atan2(b.at(0).pt() - a.at(0).pt(), b.at(1).pt() - a.at(1).pt())
  arrowhead(b, angle, size: size, fill: stroke.paint)
}

#let node(at, w, h, body, fill: white, stroke: 0.6pt + black, radius: 1pt) = {
  place(
    dx: at.at(0) - w / 2,
    dy: at.at(1) - h / 2,
    rect(
      width: w,
      height: h,
      fill: fill,
      stroke: stroke,
      radius: radius,
      inset: 3pt,
      align(center + horizon, body),
    ),
  )
}

#let label-at(at, body, anchor: center + horizon, w: 60pt) = {
  place(
    dx: at.at(0) - w / 2,
    dy: at.at(1) - 5pt,
    box(width: w, align(center, body)),
  )
}

#let proposition(body) = figure(
  kind: "proposition",
  supplement: [Proposition],
  numbering: "1",
  placement: none,
  body,
)

#let proposition-style(doc) = {
  show figure.where(kind: "proposition"): it => block(width: 100%, above: 9pt, below: 9pt, {
    set par(first-line-indent: 0pt, justify: true)
    set align(left)
    context [*#it.supplement #it.counter.display(it.numbering).* ]
    it.body
  })
  doc
}
