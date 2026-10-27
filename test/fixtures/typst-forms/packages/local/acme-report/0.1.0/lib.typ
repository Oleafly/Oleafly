// Placeholder report template for the Typst function forms tests.

#let tones = (
  note: (fill: rgb("#eef4ff"), stroke: rgb("#4a74c9")),
  risk: (fill: rgb("#fff1ef"), stroke: rgb("#c4513f")),
  neutral: (fill: luma(245), stroke: luma(160)),
)

#let cover-page(title: none, subtitle: none, confidential: false) = {
  set align(center)
  v(30%)
  text(size: 24pt, weight: "bold", title)
  if subtitle != none {
    v(1em)
    text(size: 14pt, subtitle)
  }
  if confidential {
    v(2em)
    text(fill: rgb("#c4513f"), weight: "bold")[Confidential]
  }
  pagebreak()
}

#let info-box(title: none, tone: "note", body) = {
  let colors = tones.at(tone, default: tones.neutral)
  block(
    width: 100%,
    inset: 10pt,
    radius: 4pt,
    fill: colors.fill,
    stroke: (left: 3pt + colors.stroke),
  )[
    #text(weight: "bold", title)
    #parbreak()
    #body
  ]
}

#let status-badge(status) = {
  let labels = (draft: "Draft", review: "In review", approved: "Approved")
  box(
    inset: (x: 4pt, y: 2pt),
    radius: 3pt,
    fill: luma(230),
    text(size: 0.85em, labels.at(status, default: status)),
  )
}

#let sign-off(name: none, revision: 1, final: false) = {
  v(2em)
  line(length: 40%)
  [Signed by #name, revision #revision]
  if final [ (final)]
}

#let table(caption: none, ..args) = figure(std.table(..args), caption: caption)
