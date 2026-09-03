#let ink = rgb("#1c1c1c")
#let rule-grey = luma(78%)
#let panel = luma(96%)
#let accent = rgb("#1f4e79")
#let accent-warm = rgb("#a2560f")
#let accent-green = rgb("#2f6b3d")
#let accent-plum = rgb("#6b2f5f")

#let conf(doc) = {
  set page(
    paper: "a4",
    margin: (top: 2.6cm, bottom: 2.2cm, left: 2.4cm, right: 2.2cm),
    header: context {
      let here-page = here().page()
      if here-page <= 1 {
        return
      }
      let sessions = query(selector(heading.where(level: 1)).before(here()))
        .filter(it => it.numbering != none)
      let running = if sessions.len() > 0 {
        let last = sessions.last()
        let number = counter(heading).at(last.location()).first()
        [Session #number. #last.body]
      } else {
        [Front matter]
      }
      set text(size: 8.5pt, fill: luma(35%))
      grid(
        columns: (1fr, auto),
        align: (left, right),
        [Notebook NB-7 #sym.dot.c CBZ photocatalysis],
        running,
      )
      v(-3pt)
      line(length: 100%, stroke: 0.4pt + rule-grey)
    },
    footer: context {
      set text(size: 8.5pt, fill: luma(35%))
      grid(
        columns: (1fr, auto, 1fr),
        align: (left, center, right),
        [Vasterhamn Institute],
        counter(page).display("1"),
        [M. Ostrowska-Rehn],
      )
    },
    numbering: "1",
  )
  set text(font: "New Computer Modern", size: 10.5pt, fill: ink, lang: "en")
  set par(justify: true, leading: 0.62em, spacing: 1.05em)
  set heading(numbering: "1.1")
  set math.equation(numbering: "(1)")

  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(above: 0pt, below: 1.1em)[
      #set text(size: 15pt, weight: "bold")
      #if it.numbering != none {
        block(spacing: 0.4em)[
          #text(size: 9pt, weight: "regular", fill: accent, tracking: 0.08em)[
            #upper[Session #counter(heading).display("1")]
          ]
        ]
      }
      #it.body
      #v(-6pt)
      #line(length: 100%, stroke: 0.8pt + accent)
    ]
  }
  show heading.where(level: 2): set text(size: 11.5pt, weight: "bold")
  show heading.where(level: 3): set text(size: 10.5pt, weight: "bold", style: "italic")
  show raw: set text(font: "DejaVu Sans Mono", size: 8.6pt)
  show raw.where(block: true): it => block(
    width: 100%,
    fill: panel,
    inset: (x: 8pt, y: 7pt),
    radius: 2pt,
    stroke: (left: 1.6pt + accent),
    it,
  )
  show figure.caption: set text(size: 9pt)
  show figure: set block(spacing: 1.4em)
  set table(stroke: none, inset: (x: 6pt, y: 4pt))
  set figure(gap: 0.9em)

  doc
}

#let field(name, value) = (
  text(size: 8pt, fill: luma(40%), tracking: 0.05em)[#upper(name)],
  text(size: 9.2pt)[#value],
)

#let entry(
  date: "",
  session: "",
  operator: "",
  instrument: "",
  conditions: "",
  sample: "",
  body,
) = {
  block(
    width: 100%,
    fill: panel,
    inset: (x: 9pt, y: 8pt),
    radius: 2pt,
    stroke: (left: 2pt + accent, rest: 0.4pt + rule-grey),
    grid(
      columns: (auto, 1fr, auto, 1.35fr),
      column-gutter: 9pt,
      row-gutter: 5pt,
      ..field("Date", date),
      ..field("Session", raw(session)),
      ..field("Operator", operator),
      ..field("Apparatus", instrument),
      ..field("Ambient", conditions),
      ..field("Sample", sample),
    ),
  )
  v(0.4em)
  body
}

#let note(title, body) = block(
  width: 100%,
  fill: rgb("#fbf4e8"),
  inset: (x: 9pt, y: 8pt),
  radius: 2pt,
  stroke: (left: 2pt + accent-warm),
  [#text(weight: "bold", size: 9.6pt)[#title] #h(0.4em) #text(size: 9.6pt)[#body]],
)

#let xmap(v, dom, w) = w * (v - dom.at(0)) / (dom.at(1) - dom.at(0))
#let ymap(v, rng, h) = h * (1.0 - (v - rng.at(0)) / (rng.at(1) - rng.at(0)))

#let chart(w, h, body) = box(
  width: w + 2.5cm,
  height: h + 1.35cm,
  place(dx: 2.1cm, dy: 0.25cm, box(width: w, height: h, body)),
)

#let axes(
  w,
  h,
  dom,
  rng,
  xticks,
  yticks,
  xlabel,
  ylabel,
  grid-x: false,
  grid-y: true,
  xtick-width: 1.8cm,
) = {
  if grid-y {
    for t in yticks {
      place(dx: 0pt, dy: ymap(t.at(0), rng, h), line(
        length: w,
        stroke: (paint: luma(88%), thickness: 0.4pt),
      ))
    }
  }
  if grid-x {
    for t in xticks {
      place(dx: xmap(t.at(0), dom, w), dy: 0pt, line(
        angle: 90deg,
        length: h,
        stroke: (paint: luma(88%), thickness: 0.4pt),
      ))
    }
  }
  place(dx: 0pt, dy: h, line(length: w, stroke: 0.7pt + ink))
  place(dx: 0pt, dy: 0pt, line(angle: 90deg, length: h, stroke: 0.7pt + ink))
  for t in xticks {
    let x = xmap(t.at(0), dom, w)
    place(dx: x, dy: h, line(angle: 90deg, length: 3.5pt, stroke: 0.7pt + ink))
    place(
      dx: x - xtick-width / 2,
      dy: h + 5pt,
      box(width: xtick-width, {
        set par(justify: false, leading: 0.45em)
        set text(hyphenate: false, size: 7.4pt)
        align(center, t.at(1))
      }),
    )
  }
  for t in yticks {
    let y = ymap(t.at(0), rng, h)
    place(dx: -3.5pt, dy: y, line(length: 3.5pt, stroke: 0.7pt + ink))
    place(
      dx: -1.75cm,
      dy: y - 5pt,
      box(width: 1.6cm, align(right, text(size: 7.4pt, t.at(1)))),
    )
  }
  place(
    dx: 0pt,
    dy: h + 0.52cm,
    box(width: w, align(center, text(size: 8.4pt, xlabel))),
  )
  place(
    dx: -3.5cm - 0.35cm,
    dy: h / 2 - 0.35cm,
    rotate(-90deg, box(
      width: 3.5cm,
      height: 0.7cm,
      align(center + horizon, text(size: 8.4pt, ylabel)),
    )),
  )
}

#let marker(kind, col, size) = {
  if kind == "circle" {
    circle(radius: size, fill: col, stroke: none)
  } else if kind == "ring" {
    circle(radius: size, fill: white, stroke: 0.8pt + col)
  } else if kind == "square" {
    rect(width: 2 * size, height: 2 * size, fill: col, stroke: none)
  } else if kind == "diamond" {
    polygon(
      fill: col,
      stroke: none,
      (size, 0pt),
      (2 * size, size),
      (size, 2 * size),
      (0pt, size),
    )
  } else {
    polygon(
      fill: col,
      stroke: none,
      (size, 0pt),
      (2 * size, 2 * size),
      (0pt, 2 * size),
    )
  }
}

#let series(
  pts,
  dom,
  rng,
  w,
  h,
  col,
  kind: "circle",
  size: 2pt,
  dash: none,
  line-only: false,
  markers-only: false,
) = {
  if not markers-only and pts.len() > 1 {
    let steps = ()
    for (i, p) in pts.enumerate() {
      let c = (xmap(p.at(0), dom, w), ymap(p.at(1), rng, h))
      if i == 0 { steps.push(curve.move(c)) } else { steps.push(curve.line(c)) }
    }
    place(curve(stroke: (paint: col, thickness: 1pt, dash: dash), ..steps))
  }
  if not line-only {
    for p in pts {
      place(
        dx: xmap(p.at(0), dom, w) - size,
        dy: ymap(p.at(1), rng, h) - size,
        marker(kind, col, size),
      )
    }
  }
}

#let errbars(pts, dom, rng, w, h, col) = {
  for p in pts {
    let x = xmap(p.at(0), dom, w)
    let top = ymap(p.at(1) + p.at(2), rng, h)
    let bot = ymap(p.at(1) - p.at(2), rng, h)
    place(dx: x, dy: top, line(angle: 90deg, length: bot - top, stroke: 0.7pt + col))
    place(dx: x - 2pt, dy: top, line(length: 4pt, stroke: 0.7pt + col))
    place(dx: x - 2pt, dy: bot, line(length: 4pt, stroke: 0.7pt + col))
  }
}

#let legend(dx, dy, items, width: 3.6cm) = {
  place(
    dx: dx,
    dy: dy,
    box(
      width: width,
      fill: white.transparentize(8%),
      inset: 4pt,
      stroke: 0.4pt + rule-grey,
      radius: 1.5pt,
      stack(
        dir: ttb,
        spacing: 3.2pt,
        ..items.map(it => box(
          height: 6pt,
          stack(
            dir: ltr,
            spacing: 4pt,
            box(baseline: -1pt, rect(width: 9pt, height: 2.6pt, fill: it.at(0), stroke: none)),
            text(size: 7.4pt, it.at(1)),
          ),
        )),
      ),
    ),
  )
}

#let bars(values, dom, rng, w, h, col, bar-width: 0.42cm, labels: ()) = {
  for (i, v) in values.enumerate() {
    let x = xmap(v.at(0), dom, w)
    let top = ymap(v.at(1), rng, h)
    place(
      dx: x - bar-width / 2,
      dy: top,
      rect(
        width: bar-width,
        height: h - top,
        fill: col.transparentize(45%),
        stroke: 0.7pt + col,
      ),
    )
    if v.len() > 2 {
      let hi = ymap(v.at(1) + v.at(2), rng, h)
      let lo = ymap(v.at(1) - v.at(2), rng, h)
      place(dx: x, dy: hi, line(angle: 90deg, length: lo - hi, stroke: 0.7pt + ink))
      place(dx: x - 2.5pt, dy: hi, line(length: 5pt, stroke: 0.7pt + ink))
      place(dx: x - 2.5pt, dy: lo, line(length: 5pt, stroke: 0.7pt + ink))
    }
  }
}

#let arrowhead(x, y, dir, col: ink, size: 3.2pt) = {
  let shape = if dir == "right" {
    ((0pt, 0pt), (size * 1.6, size), (0pt, size * 2))
  } else if dir == "left" {
    ((size * 1.6, 0pt), (size * 1.6, size * 2), (0pt, size))
  } else if dir == "down" {
    ((0pt, 0pt), (size * 2, 0pt), (size, size * 1.6))
  } else {
    ((size, 0pt), (size * 2, size * 1.6), (0pt, size * 1.6))
  }
  let ox = if dir == "right" { 0pt } else if dir == "left" { -size * 1.6 } else { -size }
  let oy = if dir == "down" { 0pt } else if dir == "up" { -size * 1.6 } else { -size }
  place(dx: x + ox, dy: y + oy, polygon(fill: col, stroke: none, ..shape))
}

#let conn(x1, y1, x2, y2, col: ink, dash: none, head: "", thickness: 0.7pt) = {
  place(dx: x1, dy: y1, curve(
    stroke: (paint: col, thickness: thickness, dash: dash),
    curve.move((0pt, 0pt)),
    curve.line((x2 - x1, y2 - y1)),
  ))
  if head != "" { arrowhead(x2, y2, head, col: col) }
}

#let elbow(x1, y1, x2, y2, col: ink, dash: none, head: "", vertical-first: false) = {
  let mid = if vertical-first { (x1, y2) } else { (x2, y1) }
  place(dx: x1, dy: y1, curve(
    stroke: (paint: col, thickness: 0.7pt, dash: dash),
    curve.move((0pt, 0pt)),
    curve.line((mid.at(0) - x1, mid.at(1) - y1)),
    curve.line((x2 - x1, y2 - y1)),
  ))
  if head != "" { arrowhead(x2, y2, head, col: col) }
}

#let node(x, y, w, h, body, fill: white, stroke-col: ink, radius: 1.5pt, size: 7.6pt) = {
  place(
    dx: x,
    dy: y,
    box(
      width: w,
      height: h,
      fill: fill,
      stroke: 0.7pt + stroke-col,
      radius: radius,
      inset: 3pt,
      {
        set par(justify: false, leading: 0.45em)
        set text(hyphenate: false, size: size)
        align(center + horizon, body)
      },
    ),
  )
}

#let tag(x, y, body, w: 2.6cm, size: 7.2pt, alignment: center) = {
  place(dx: x, dy: y, box(width: w, {
    set par(justify: false, leading: 0.45em)
    set text(hyphenate: false, size: size)
    align(alignment, body)
  }))
}

#let unit(v, u) = [#v #h(0.18em) #u]

#let pm(v, e) = [#v #sym.plus.minus #e]

#let head-row(..cells) = table.header(..cells.pos().map(c => text(weight: "bold", size: 9.4pt, c)))
