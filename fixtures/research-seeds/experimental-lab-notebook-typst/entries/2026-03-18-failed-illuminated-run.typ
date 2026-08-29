#import "../notebook.typ": *

= First illuminated run and diagnosis of its failure

#entry(
  date: "2026-03-18",
  session: "NB7-S03",
  operator: "M. Ostrowska-Rehn",
  instrument: [PR-2, LAMP-1, RAD-1, SPEC-1],
  conditions: "23.0 °C, 39 % RH, 1015 hPa",
  sample: [NT-500 batch NT500-B3 at 1.00 g L#super[-1]],
)[

== Purpose

First illuminated run of the campaign, designated PR2-011. The intent was a
straightforward 180 min decay curve at the conditions fixed in session 2, to be
used as the reference against which the loading series would be compared. The
run failed, and most of this entry is the diagnosis rather than the result,
because the failure turned out to have two independent causes and finding the
second one only after correcting the first is exactly the kind of thing this
notebook exists to record.

== Apparatus

@fig:reactor is the configuration as built today. The lamp sits on the axis of
a quartz sleeve, the suspension occupies the annulus around the sleeve, and an
outer water jacket carries thermostatted coolant. The geometry is standard for
this class of experiment @thorsen2019photoreactors and it matters chiefly
because the optical path from the lamp to any point in the suspension is short
and roughly uniform, so a single wall irradiance measurement characterises the
whole volume to within about 15 %.

#figure(
  box(width: 11.4cm, height: 7.6cm, {
    node(0.10cm, 2.30cm, 2.00cm, 1.05cm, [CHIL-1 chiller\ 25.0 °C setpoint], size: 7pt)
    node(0.10cm, 0.50cm, 2.00cm, 0.78cm, [Air sparge\ 0.5 L min#super[-1]], size: 7pt)

    place(dx: 2.60cm, dy: 0.90cm, rect(
      width: 2.80cm, height: 4.90cm,
      fill: rgb("#eef3f7"), stroke: 0.8pt + ink, radius: 2pt,
    ))
    place(dx: 2.95cm, dy: 1.25cm, rect(
      width: 2.10cm, height: 4.20cm,
      fill: rgb("#cfe0ec"), stroke: 0.6pt + accent,
    ))
    place(dx: 3.55cm, dy: 1.05cm, rect(
      width: 0.90cm, height: 3.90cm,
      fill: white, stroke: 0.7pt + ink,
    ))
    place(dx: 3.75cm, dy: 1.35cm, rect(
      width: 0.50cm, height: 3.30cm,
      fill: rgb("#f6e6b8"), stroke: 0.5pt + accent-warm,
    ))
    place(dx: 3.78cm, dy: 2.78cm, circle(radius: 0.22cm, fill: rgb("#e8b64c"), stroke: none))
    place(dx: 3.70cm, dy: 5.12cm, rect(
      width: 0.60cm, height: 0.16cm, fill: luma(30%), stroke: none, radius: 1pt,
    ))
    node(2.60cm, 6.00cm, 2.80cm, 0.55cm, [Stirrer, 400 rpm], size: 7pt, fill: luma(94%))

    elbow(2.05cm, 3.20cm, 2.60cm, 5.00cm, head: "right", vertical-first: true, col: accent)
    elbow(2.60cm, 1.50cm, 2.05cm, 2.30cm, head: "down", vertical-first: false, col: accent)
    elbow(2.05cm, 0.86cm, 3.15cm, 1.25cm, head: "down", vertical-first: false)

    node(6.50cm, 0.95cm, 2.75cm, 0.85cm, [RAD-1 radiometer\ 400 to 700 nm], size: 7pt)
    conn(5.40cm, 1.38cm, 6.50cm, 1.38cm, head: "right", dash: "dashed", col: accent-warm)

    conn(5.40cm, 4.40cm, 6.50cm, 4.40cm, head: "right")
    place(dx: 5.34cm, dy: 4.26cm, rect(width: 0.16cm, height: 0.28cm, fill: luma(30%), stroke: none))
    node(6.50cm, 3.98cm, 2.75cm, 0.85cm, [Syringe filter\ 0.22 µm PTFE], size: 7pt)
    conn(7.87cm, 4.83cm, 7.87cm, 5.55cm, head: "down")
    node(6.50cm, 5.55cm, 2.75cm, 0.90cm, [SPEC-1 at 285 nm\ HPLC-2 diode array], size: 7pt)

    conn(4.45cm, 2.45cm, 6.45cm, 2.45cm, col: luma(55%), dash: "dotted", thickness: 0.5pt)
    tag(6.55cm, 2.20cm, [Quartz sleeve and\ 420 nm cut-on filter], w: 3.0cm, alignment: left)
    conn(5.05cm, 3.35cm, 6.45cm, 3.35cm, col: luma(55%), dash: "dotted", thickness: 0.5pt)
    tag(6.55cm, 3.10cm, [Annular suspension,\ 250 mL working volume], w: 3.0cm, alignment: left)

    tag(2.20cm, 0.36cm, [LAMP-1, 300 W xenon arc], w: 3.6cm)
    tag(0.10cm, 3.46cm, [Coolant loop], w: 2.0cm)
    tag(2.20cm, 6.70cm, [PR-2 annular photoreactor], w: 3.6cm)
  }),
  caption: [
    The PR-2 annular photoreactor as configured for session 3, drawn in
    cross-section. Coolant enters the outer jacket at the base and returns from
    the head. The sampling line draws from the annulus through an in-line
    filter directly to the analytical instruments, so no sample stands in
    contact with catalyst between withdrawal and reading.
  ],
) <fig:reactor>

== Run PR2-011 and what it showed

The run followed the fixed protocol: 45 min dark equilibration, irradiance
check, lamp struck, sampling at 0, 15, 30, 45, 60, 90, 120, 150 and 180 min.
@tab:failed gives the result. Removal over three hours was 6.0 %, against an
expectation from the NB-6 dye work of something in the region of 55 to 65 %.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: (center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Time\ (min)],
      [Absorbance\ at 285 nm],
      [Concentration\ (µmol L#super[-1])],
      [Removal\ (%)],
    ),
    table.hline(stroke: 0.5pt),
    [0], [1.1502], [#pm[20.02][0.21]], [0.0],
    [15], [1.1445], [#pm[19.92][0.21]], [0.5],
    [30], [1.1385], [#pm[19.82][0.21]], [1.0],
    [45], [1.1330], [#pm[19.72][0.20]], [1.5],
    [60], [1.1215], [#pm[19.52][0.20]], [2.5],
    [90], [1.1157], [#pm[19.42][0.20]], [3.0],
    [120], [1.1042], [#pm[19.22][0.20]], [4.0],
    [150], [1.0927], [#pm[19.02][0.20]], [5.0],
    [180], [1.0812], [#pm[18.82][0.19]], [6.0],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Run PR2-011. The trend is monotonic and well outside measurement noise, so
    something was happening, but the magnitude is an order below expectation.
  ],
) <tab:failed>

The shape of @tab:failed is informative. A completely dark reactor would give a
flat line, and a leaking interlock or a failed stirrer would give scatter. What
was recorded is a clean, slow, first-order decay, which says the photochemistry
was working and the photon supply was not.

== Diagnosis

The wall irradiance measured with RAD-1 immediately before the run was
22.6 W m#super[-2]. The value recorded in NB-6 for the same lamp, sleeve and
probe position was 41.8 W m#super[-2]. That is a 46 % loss and it accounts for
most of the deficit on its own.

Two contributions were separated. The lamp hour meter read 940 h against a
manufacturer service life of 800 h. @tab:lamp is the irradiance history
assembled from the radiometer log going back to lamp installation, and
@fig:lamp plots it. The decay is the expected consequence of envelope
devitrification and electrode sputtering in a short-arc xenon source, which
darkens the envelope progressively and accelerates once the arc gap has widened
@delacroix2015lampaging.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: (center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Lamp hours\ (h)],
      [Date],
      [Wall irradiance\ (W m#super[-2])],
      [Relative to new\ (%)],
    ),
    table.hline(stroke: 0.5pt),
    [0], [2025-09-02], [#pm[44.6][0.5]], [100.0],
    [120], [2025-10-08], [#pm[43.1][0.5]], [96.6],
    [260], [2025-11-14], [#pm[41.8][0.5]], [93.7],
    [400], [2025-12-16], [#pm[39.6][0.4]], [88.8],
    [560], [2026-01-22], [#pm[36.2][0.4]], [81.2],
    [700], [2026-02-19], [#pm[31.4][0.4]], [70.4],
    [850], [2026-03-11], [#pm[26.9][0.3]], [60.3],
    [940], [2026-03-18], [#pm[22.6][0.3]], [50.7],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Irradiance history of LAMP-1 measured at the fixed probe position on the
    reactor wall, 400 to 700 nm. The manufacturer service life is 800 h.
  ],
) <tab:lamp>

#figure(
  chart(8.0cm, 4.6cm, {
    axes(
      8.0cm, 4.6cm, (0, 1000), (20, 46),
      ((0, [0]), (200, [200]), (400, [400]), (600, [600]), (800, [800]), (1000, [1000])),
      ((20, [20]), (25, [25]), (30, [30]), (35, [35]), (40, [40]), (45, [45])),
      [Lamp operating hours (h)],
      [Wall irradiance (W m#super[-2])],
    )
    place(dx: xmap(800, (0, 1000), 8.0cm), dy: 0pt, line(
      angle: 90deg, length: 4.6cm,
      stroke: (paint: accent-warm, thickness: 0.8pt, dash: "dashed"),
    ))
    tag(xmap(800, (0, 1000), 8.0cm) - 2.35cm, 0.05cm, [Service life 800 h], w: 2.3cm, alignment: right)
    series(
      ((0, 44.6), (120, 43.1), (260, 41.8), (400, 39.6), (560, 36.2), (700, 31.4), (850, 26.9), (940, 22.6)),
      (0, 1000), (20, 46), 8.0cm, 4.6cm, accent, kind: "circle", size: 2.2pt,
    )
    series(
      ((260, 41.8), (940, 41.8)),
      (0, 1000), (20, 46), 8.0cm, 4.6cm, luma(55%),
      line-only: true, dash: "dotted",
    )
    tag(4.60cm, ymap(41.8, (20, 46), 4.6cm) + 0.09cm, [Value assumed from NB-6], w: 3.2cm, alignment: right)
  }),
  caption: [
    Irradiance decay of LAMP-1. The run was planned on the dotted value carried
    forward from NB-6, measured at 260 h, and the lamp had since lost a further
    46 % of its output.
  ],
) <fig:lamp>

A new lamp was installed and the irradiance remeasured at 38.9 W m#super[-2],
which is 13 % below the 44.6 W m#super[-2] recorded for the previous lamp when
it was new. That residual gap is the second cause. Inspection of the quartz
sleeve under a torch showed a faint but continuous brown film on the outer
surface over the immersed length, invisible when the sleeve is wet and obvious
when it is dry. The film is presumably an oxidised organic deposit accumulated
over the NB-6 dye campaign. After 15 min in 10 % nitric acid, an ultrapure
rinse and drying, the sleeve was reinstalled and the irradiance came back to
44.1 W m#super[-2], within 1.1 % of the new-lamp reference.

== Observations

The failure was avoidable and the reason it was not avoided is a process
problem rather than a technical one. The irradiance was treated as a property
of the apparatus, measured once and carried forward in the protocol, when it is
in fact a consumable quantity that decays every hour the lamp runs. The single
value written into the NB-6 protocol was four months and 680 lamp hours old.

The second lesson is that the two causes were multiplicative and the first one
masked the second. Had the lamp been within life, the sleeve fouling alone
would have produced a 13 % rate deficit, which is comfortably inside run to run
scatter and would very likely have been absorbed into the data as noise for
several sessions before anyone looked at the sleeve.

#note[Run status.][
  PR2-011 is void and its data are not to be used for any rate constant. The
  entry is retained because the decay it shows is genuine and because the
  diagnosis constrains the protocol revision that follows.
]

== Next

Session 4 rebuilds the protocol around a measured photon flux rather than a
recorded irradiance, and adds sleeve inspection and lamp hour checks as
mandatory pre-run steps.
]
