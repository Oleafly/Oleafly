#import "../lib.typ": arrow, elbow

= Material and experimental methods <sec:experimental>

== Alloys

Two laboratory heats of 20Cr-25Ni-Nb austenitic steel were vacuum induction
melted, hot rolled to 12 mm plate, solution treated at 1,323 K for 1 h, and
water quenched. The heats differ in niobium content and in nothing else that
exceeded the analytical scatter. Compositions are given in @tab:composition.
Grain size after solution treatment was 42 ± 6 μm in
heat A and 39 ± 5 μm in heat B, measured by the linear
intercept method on 400 intercepts per condition.

#figure(
  caption: [Chemical composition of the two heats in wt.%, with iron as the
    balance. Carbon and nitrogen were measured by combustion and inert gas
    fusion; the remaining elements by inductively coupled plasma optical
    emission spectrometry. Uncertainties are one standard deviation over three
    analyses.],
  table(
    columns: 9,
    align: (left, center, center, center, center, center, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header([Heat], [C], [Si], [Mn], [Cr], [Ni], [Nb], [N], [Nb/C]),
    table.hline(stroke: 0.4pt),
    [A], [0.048], [0.51], [0.78], [20.3], [24.9], [0.79], [0.021], [16.5],
    [B], [0.047], [0.49], [0.81], [20.1], [25.2], [0.68], [0.020], [14.5],
    [±], [0.003], [0.02], [0.03], [0.2], [0.3], [0.02], [0.002], [1.0],
    table.hline(stroke: 0.9pt),
  ),
) <tab:composition>

== Creep testing

Constant-load creep tests were run in single-specimen lever-arm frames at 923
± 2 K under a laboratory-grade argon cover. Specimens were
threaded cylinders with a 6.00 mm gauge diameter and a 30 mm gauge length.
Temperature was held by a three-zone furnace with control thermocouples
attached to the specimen shoulders and gauge centre; the gradient over the
gauge length never exceeded 3 K. Extension was measured by a pair of ceramic
rods clamped at the gauge shoulders and read by a linear variable differential
transformer outside the hot zone, with a resolution of 0.4 μm. The
arrangement is shown in @fig:rig.

#figure(
  box(width: 444pt, height: 278pt, {
    set par(justify: false, leading: 0.5em)
    let cx = 215pt
    place(rect(width: 18pt, height: 222pt, fill: luma(236), stroke: 0.5pt), dx: 62pt, dy: 22pt)
    place(rect(width: 18pt, height: 222pt, fill: luma(236), stroke: 0.5pt), dx: 352pt, dy: 22pt)
    place(rect(width: 326pt, height: 16pt, fill: luma(224), stroke: 0.6pt), dx: 58pt, dy: 14pt)
    place(rect(width: 340pt, height: 14pt, fill: luma(214), stroke: 0.6pt), dx: 55pt, dy: 244pt)

    place(line(start: (cx, 30pt), end: (cx, 68pt), stroke: 3pt + luma(85)))
    place(rect(width: 110pt, height: 114pt, fill: luma(247), stroke: 0.7pt), dx: 160pt, dy: 66pt)
    place(rect(width: 58pt, height: 98pt, fill: white, stroke: 0.5pt), dx: 186pt, dy: 74pt)
    for k in range(9) {
      let y = 70pt + 13pt * k
      place(line(start: (161pt, y), end: (185pt, y), stroke: 0.35pt + luma(160)))
      place(line(start: (245pt, y), end: (269pt, y), stroke: 0.35pt + luma(160)))
    }

    place(rect(width: 20pt, height: 18pt, fill: luma(178), stroke: 0.5pt), dx: 205pt, dy: 72pt)
    place(rect(width: 10pt, height: 64pt, fill: luma(206), stroke: 0.5pt), dx: 210pt, dy: 90pt)
    place(rect(width: 20pt, height: 18pt, fill: luma(178), stroke: 0.5pt), dx: 205pt, dy: 154pt)
    place(line(start: (cx, 172pt), end: (cx, 200pt), stroke: 3pt + luma(85)))
    place(rect(width: 60pt, height: 32pt, fill: luma(148), stroke: 0.6pt), dx: 185pt, dy: 200pt)
    place(dx: 185pt, dy: 209pt, box(width: 60pt, align(center, text(size: 7.5pt, fill: white)[1.24 kN])))

    place(line(start: (211pt, 96pt), end: (140pt, 96pt), stroke: 0.6pt))
    place(line(start: (211pt, 150pt), end: (140pt, 150pt), stroke: 0.6pt))
    place(rect(width: 36pt, height: 70pt, fill: white, stroke: 0.6pt), dx: 104pt, dy: 88pt)
    place(dx: 104pt, dy: 118pt, box(width: 36pt, align(center, text(size: 7.5pt)[LVDT])))
    place(dx: 62pt, dy: 188pt, box(width: 120pt, align(center, text(size: 7.5pt)[alumina extensometer rods])))

    for (k, y) in ((0, 96pt), (1, 122pt), (2, 148pt)) {
      place(dx: 254.6pt, dy: y - 2.4pt, circle(radius: 2.4pt, fill: black))
      place(dx: 264pt, dy: y - 5pt, text(size: 7.5pt)[TC#(k + 1)])
    }

    arrow((332pt, 76pt), (272pt, 76pt), stroke: 0.6pt + rgb("#2f5fa8"))
    arrow((272pt, 170pt), (332pt, 170pt), stroke: 0.6pt + rgb("#2f5fa8"))
    place(dx: 292pt, dy: 62pt, text(size: 7.5pt, fill: rgb("#2f5fa8"))[argon in])
    place(dx: 290pt, dy: 174pt, text(size: 7.5pt, fill: rgb("#2f5fa8"))[argon out])

    place(dx: 0pt, dy: 16pt, box(width: 54pt, align(right, text(size: 7.5pt)[fixed crosshead])))
    place(dx: 0pt, dy: 124pt, box(width: 54pt, align(right, text(size: 7.5pt)[load frame\ column])))
    place(dx: 0pt, dy: 244pt, box(width: 50pt, align(right, text(size: 7.5pt)[base plate])))
    place(dx: 96pt, dy: 40pt, box(width: 78pt, align(right, text(size: 7.5pt)[specimen,\ ⌀6 mm gauge])))
    elbow(((176pt, 52pt), (200pt, 52pt), (200pt, 80pt)), stroke: 0.5pt + luma(80), size: 3.4pt)
    place(dx: 376pt, dy: 92pt, box(width: 68pt, text(size: 7.5pt)[three-zone furnace, 923 ± 2 K]))
    place(dx: 376pt, dy: 198pt, box(width: 68pt, text(size: 7.5pt)[dead load, constant engineering stress]))
  }),
  caption: [Constant-load creep frame. The specimen gauge sits at the centre of
    a three-zone furnace with control thermocouples TC1 to TC3 on the shoulders
    and the gauge centre. Extension is transferred out of the hot zone by
    alumina rods and read by a linear variable differential transformer, which
    keeps the transducer below 340 K. Load is applied as dead weight through a
    lever arm that is omitted for clarity.],
) <fig:rig>

Tests were interrupted at nominal accumulated strains of 0.5%, 1.5%, and 4%,
and at rupture. Interrupted specimens were cooled under load at 3 K per minute
to 673 K and then unloaded, a sequence chosen so that the boundary chemistry
recorded by the atom probe corresponds to the loaded state rather than to
whatever redistributes during a fast quench.

== Atom probe tomography

Specimens for atom probe were lifted out by focused ion beam from gauge-length
sections, targeting boundaries within 30° of the tensile axis so
that the analysed boundaries are the ones carrying the highest normal stress.
Each needle was sharpened at 5 kV and cleaned at 2 kV to limit gallium
implantation. Runs were performed at 50 K in laser mode with a 60 pJ pulse
energy and a 0.7% detection rate. Boundary composition was extracted from
proximity histograms over an isoconcentration surface at 3 at.% Nb, and the
enrichment values quoted below are Gibbsian interfacial excesses converted to
an equivalent monolayer concentration for comparability with the literature.
Between 6 and 11 boundaries were analysed per condition.
