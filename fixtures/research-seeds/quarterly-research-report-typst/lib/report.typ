#let ink = (
  navy: rgb("#1f3f66"),
  rust: rgb("#a8552a"),
  moss: rgb("#3c6b4f"),
  slate: rgb("#5b6b80"),
  gold: rgb("#9c7a12"),
  plum: rgb("#6b3f6b"),
  rule: rgb("#8c98a8"),
  faint: rgb("#d7dce3"),
)

#let status-tint = (
  complete: rgb("#dcead9"),
  active: rgb("#dce6f2"),
  slipped: rgb("#f5e0d4"),
  hold: rgb("#eceef1"),
)

#let status-mark(kind, label) = {
  let tint = status-tint.at(kind)
  box(
    fill: tint,
    inset: (x: 4pt, y: 2pt),
    radius: 2pt,
    text(size: 8pt, label),
  )
}

#let swatch(colour, width: 0.44cm, height: 0.16cm) = box(
  baseline: -0.5pt,
  width: width,
  height: height,
  fill: colour,
  radius: 1pt,
)

#let chart-legend(items, size: 8pt, spacing: 0.75cm) = {
  set text(size: size)
  stack(
    dir: ltr,
    spacing: spacing,
    ..items.map(entry => {
      swatch(entry.at(1))
      h(0.16cm)
      entry.at(0)
    }),
  )
}

#let axis-label(body, size: 7.5pt) = text(size: size, fill: ink.slate, body)

#let line-chart(
  width: 12cm,
  height: 6.2cm,
  pad: (left: 1.15cm, right: 0.55cm, top: 0.45cm, bottom: 0.95cm),
  y-min: 0.0,
  y-max: 100.0,
  y-ticks: (),
  x-labels: (),
  series: (),
  marker: 1.7pt,
) = {
  let pw = width - pad.left - pad.right
  let ph = height - pad.top - pad.bottom
  let n = x-labels.len()
  let span = calc.max(n - 1, 1)
  let xat(i) = pad.left + pw * (i / span)
  let yat(v) = pad.top + ph * (1.0 - (v - y-min) / (y-max - y-min))
  box(width: width, height: height, {
    for tick in y-ticks {
      let y = yat(tick.at(0))
      place(dx: pad.left, dy: y, line(length: pw, stroke: 0.3pt + ink.faint))
      place(dx: pad.left - 0.1cm, dy: y, line(length: 0.1cm, stroke: 0.5pt + ink.rule))
      place(
        dx: 0pt,
        dy: y - 0.17cm,
        box(width: pad.left - 0.18cm, align(right, axis-label(tick.at(1)))),
      )
    }
    place(dx: pad.left, dy: pad.top, line(angle: 90deg, length: ph, stroke: 0.6pt + ink.rule))
    place(dx: pad.left, dy: pad.top + ph, line(length: pw, stroke: 0.6pt + ink.rule))
    for i in range(n) {
      let x = xat(i)
      place(dx: x, dy: pad.top + ph, line(angle: 90deg, length: 0.1cm, stroke: 0.5pt + ink.rule))
      place(
        dx: x - 0.85cm,
        dy: pad.top + ph + 0.16cm,
        box(width: 1.7cm, align(center, axis-label(x-labels.at(i)))),
      )
    }
    for entry in series {
      let colour = entry.colour
      let values = entry.values
      let dash = if "dash" in entry { entry.dash } else { none }
      let points = range(values.len()).map(i => (xat(i), yat(values.at(i))))
      place(dx: 0pt, dy: 0pt, curve(
        stroke: (paint: colour, thickness: 1pt, dash: dash),
        curve.move(points.at(0)),
        ..points.slice(1).map(p => curve.line(p)),
      ))
      for p in points {
        place(
          dx: p.at(0) - marker,
          dy: p.at(1) - marker,
          circle(radius: marker, fill: colour, stroke: none),
        )
      }
    }
  })
}

#let bar-chart(
  width: 12cm,
  height: 6cm,
  pad: (left: 1.15cm, right: 0.55cm, top: 0.45cm, bottom: 0.95cm),
  y-min: 0.0,
  y-max: 20.0,
  y-ticks: (),
  groups: (),
  series: (),
  group-gap: 0.42,
  bar-gap: 0.06cm,
) = {
  let pw = width - pad.left - pad.right
  let ph = height - pad.top - pad.bottom
  let n = groups.len()
  let k = series.len()
  let slot = pw / n
  let cluster = slot * (1.0 - group-gap)
  let bw = (cluster - bar-gap * (k - 1)) / k
  let yat(v) = pad.top + ph * (1.0 - (v - y-min) / (y-max - y-min))
  box(width: width, height: height, {
    for tick in y-ticks {
      let y = yat(tick.at(0))
      place(dx: pad.left, dy: y, line(length: pw, stroke: 0.3pt + ink.faint))
      place(
        dx: 0pt,
        dy: y - 0.17cm,
        box(width: pad.left - 0.18cm, align(right, axis-label(tick.at(1)))),
      )
    }
    place(dx: pad.left, dy: pad.top, line(angle: 90deg, length: ph, stroke: 0.6pt + ink.rule))
    place(dx: pad.left, dy: pad.top + ph, line(length: pw, stroke: 0.6pt + ink.rule))
    for gi in range(n) {
      let left = pad.left + slot * gi + slot * group-gap / 2.0
      for si in range(k) {
        let value = groups.at(gi).values.at(si)
        let top = yat(value)
        let bar-height = pad.top + ph - top
        place(
          dx: left + (bw + bar-gap) * si,
          dy: top,
          rect(
            width: bw,
            height: bar-height,
            fill: series.at(si).at(1),
            stroke: none,
          ),
        )
      }
      place(
        dx: pad.left + slot * gi,
        dy: pad.top + ph + 0.16cm,
        box(width: slot, align(center, axis-label(groups.at(gi).label))),
      )
    }
  })
}

#let scatter-chart(
  width: 8.4cm,
  height: 6.4cm,
  pad: (left: 1.15cm, right: 0.45cm, top: 0.45cm, bottom: 1.0cm),
  x-min: 0.0,
  x-max: 120.0,
  y-min: 0.0,
  y-max: 120.0,
  x-ticks: (),
  y-ticks: (),
  points: (),
  colour: rgb("#1f3f66"),
  identity: true,
  radius: 1.6pt,
) = {
  let pw = width - pad.left - pad.right
  let ph = height - pad.top - pad.bottom
  let xat(v) = pad.left + pw * ((v - x-min) / (x-max - x-min))
  let yat(v) = pad.top + ph * (1.0 - (v - y-min) / (y-max - y-min))
  box(width: width, height: height, {
    for tick in y-ticks {
      let y = yat(tick.at(0))
      place(dx: pad.left, dy: y, line(length: pw, stroke: 0.3pt + ink.faint))
      place(
        dx: 0pt,
        dy: y - 0.17cm,
        box(width: pad.left - 0.18cm, align(right, axis-label(tick.at(1)))),
      )
    }
    for tick in x-ticks {
      let x = xat(tick.at(0))
      place(dx: x, dy: pad.top + ph, line(angle: 90deg, length: 0.1cm, stroke: 0.5pt + ink.rule))
      place(
        dx: x - 0.7cm,
        dy: pad.top + ph + 0.16cm,
        box(width: 1.4cm, align(center, axis-label(tick.at(1)))),
      )
    }
    if identity {
      place(dx: 0pt, dy: 0pt, curve(
        stroke: (paint: ink.slate, thickness: 0.6pt, dash: "dashed"),
        curve.move((xat(x-min), yat(y-min))),
        curve.line((xat(x-max), yat(y-max))),
      ))
    }
    place(dx: pad.left, dy: pad.top, line(angle: 90deg, length: ph, stroke: 0.6pt + ink.rule))
    place(dx: pad.left, dy: pad.top + ph, line(length: pw, stroke: 0.6pt + ink.rule))
    for p in points {
      place(
        dx: xat(p.at(0)) - radius,
        dy: yat(p.at(1)) - radius,
        circle(radius: radius, stroke: 0.5pt + colour, fill: colour.transparentize(55%)),
      )
    }
  })
}

#let gantt(
  width: 13cm,
  row-height: 0.72cm,
  label-width: 3.1cm,
  months: (),
  rows: (),
  markers: (),
) = {
  let n = months.len()
  let track = width - label-width - 0.3cm
  let slot = track / n
  let height = row-height * rows.len() + 1.05cm
  let xat(pos) = label-width + track * (pos / n)
  box(width: width, height: height, {
    for i in range(n) {
      place(
        dx: label-width + slot * i,
        dy: 0pt,
        box(width: slot, align(center, axis-label(months.at(i), size: 6.8pt))),
      )
      place(
        dx: label-width + slot * i,
        dy: 0.42cm,
        line(angle: 90deg, length: row-height * rows.len(), stroke: 0.3pt + ink.faint),
      )
    }
    place(dx: label-width, dy: 0.42cm, line(length: track, stroke: 0.6pt + ink.rule))
    place(
      dx: label-width + track,
      dy: 0.42cm,
      line(angle: 90deg, length: row-height * rows.len(), stroke: 0.3pt + ink.faint),
    )
    for ri in range(rows.len()) {
      let row = rows.at(ri)
      let top = 0.42cm + row-height * ri
      place(
        dx: 0pt,
        dy: top + 0.14cm,
        box(width: label-width - 0.2cm, text(size: 7.6pt, row.label)),
      )
      place(
        dx: xat(row.start),
        dy: top + 0.12cm,
        rect(
          width: xat(row.end) - xat(row.start),
          height: 0.3cm,
          fill: row.colour,
          radius: 1.5pt,
          stroke: none,
        ),
      )
      if "planned" in row {
        place(
          dx: xat(row.planned.at(0)),
          dy: top + 0.09cm,
          rect(
            width: xat(row.planned.at(1)) - xat(row.planned.at(0)),
            height: 0.36cm,
            fill: none,
            radius: 1.5pt,
            stroke: (paint: ink.slate, thickness: 0.5pt, dash: "dashed"),
          ),
        )
      }
    }
    for mark in markers {
      let cx = xat(mark.pos)
      let cy = 0.42cm + row-height * mark.row + 0.27cm
      place(
        dx: cx - 0.14cm,
        dy: cy - 0.14cm,
        polygon(
          fill: ink.rust,
          stroke: 0.4pt + white,
          (0.14cm, 0cm),
          (0.28cm, 0.14cm),
          (0.14cm, 0.28cm),
          (0cm, 0.14cm),
        ),
      )
      place(
        dx: cx + 0.17cm,
        dy: cy - 0.16cm,
        box(
          fill: white,
          inset: (x: 1.4pt, y: 0.6pt),
          radius: 1pt,
          text(size: 6.4pt, fill: ink.rust, weight: "bold", mark.label),
        ),
      )
    }
  })
}

#let node-box(dx: 0pt, dy: 0pt, width: 3cm, height: 1.05cm, fill: white, body) = place(
  dx: dx,
  dy: dy,
  box(
    width: width,
    height: height,
    fill: fill,
    stroke: 0.6pt + ink.slate,
    radius: 2pt,
    inset: 4pt,
    align(center + horizon, text(size: 8pt, body)),
  ),
)

#let arrow-head(dx: 0pt, dy: 0pt, dir: "right", colour: rgb("#1f3f66"), size: 3.2pt) = {
  let w = size
  let h = size * 0.68
  let shape = if dir == "right" {
    ((0pt, 0pt), (w, h), (0pt, h * 2))
  } else if dir == "left" {
    ((w, 0pt), (0pt, h), (w, h * 2))
  } else if dir == "down" {
    ((0pt, 0pt), (h * 2, 0pt), (h, w))
  } else {
    ((h, 0pt), (0pt, w), (h * 2, w))
  }
  let ox = if dir == "left" or dir == "right" { 0pt } else { -h }
  let oy = if dir == "left" or dir == "right" { -h } else { 0pt }
  place(dx: dx + ox, dy: dy + oy, polygon(fill: colour, stroke: none, ..shape))
}

#let arrow-h(dx: 0pt, dy: 0pt, len: 1cm, colour: rgb("#1f3f66"), dash: none) = {
  place(dx: dx, dy: dy, line(length: len - 2.6pt, stroke: (paint: colour, thickness: 0.6pt, dash: dash)))
  arrow-head(dx: dx + len - 3.2pt, dy: dy, dir: "right", colour: colour)
}

#let arrow-v(dx: 0pt, dy: 0pt, len: 1cm, colour: rgb("#1f3f66"), dash: none) = {
  place(dx: dx, dy: dy, line(angle: 90deg, length: len - 2.6pt, stroke: (paint: colour, thickness: 0.6pt, dash: dash)))
  arrow-head(dx: dx, dy: dy + len - 3.2pt, dir: "down", colour: colour)
}

#let callout(title, body, tint: rgb("#eef2f7"), bar: rgb("#1f3f66")) = block(
  width: 100%,
  fill: tint,
  inset: (x: 9pt, y: 8pt),
  radius: (right: 3pt),
  stroke: (left: 2pt + bar),
  {
    text(weight: "bold", size: 9.5pt, title)
    linebreak()
    set text(size: 9.5pt)
    body
  },
)

#let figure-note(body) = block(
  width: 100%,
  above: 0.35em,
  text(size: 8pt, fill: ink.slate, body),
)
