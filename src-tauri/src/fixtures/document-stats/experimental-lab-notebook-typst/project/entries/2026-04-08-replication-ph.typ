#import "../notebook.typ": *

= Replication on an independent batch and the pH dependence

#entry(
  date: "2026-04-08",
  session: "NB7-S06",
  operator: "E. Vondracek, M. Ostrowska-Rehn",
  instrument: [PR-2, LAMP-1, RAD-1, SPEC-1, PH-1],
  conditions: "21.8 °C, 46 % RH, 1006 hPa",
  sample: [NT-500 batches NT500-B3 and NT500-B7, runs PR2-017 to PR2-022],
)[

== Purpose

Two questions. First, whether the reference rate constant from session 5 is a
property of the material or of the particular batch that was synthesised in
January. Sol-gel preparations are notoriously sensitive to hydrolysis rate,
ageing time and the ramp used during calcination, and interbatch spreads of
30 % or more are reported for nominally identical preparations
@oyelaran2023replication. Second, how the rate depends on pH, which matters
because any real water to be treated will not arrive at pH 6.8.

== Replication

Batch NT500-B7 was synthesised on 2026-03-30 by the same written procedure as
NT500-B3, by a different operator, using a fresh bottle of titanium
isopropoxide and a fresh urea lot. Characterisation gave a BET area of
89 #sym.plus.minus 4 m#super[2] g#super[-1] against 92
#sym.plus.minus 4 m#super[2] g#super[-1] for B3, a Tauc gap of 2.81
#sym.plus.minus 0.03 eV against 2.79 #sym.plus.minus 0.03 eV, and a nitrogen
content of 2.14 #sym.plus.minus 0.10 at. % against 2.21
#sym.plus.minus 0.09 at. %. The materials are indistinguishable on every
characterisation axis available here.

Run PR2-017 repeated the reference condition exactly: 1.00 g L#super[-1],
20.0 µmol L#super[-1], pH 6.8 unadjusted, protocol PR2-CBZ-02. The result is
$k_"app" = (10.98 plus.minus 0.21) times 10^(-3)$ min#super[-1], against
$(11.31 plus.minus 0.14) times 10^(-3)$ min#super[-1] for B3. The difference is
$0.33 times 10^(-3)$ min#super[-1] and the combined standard uncertainty is
$sqrt(0.21^2 + 0.14^2) = 0.25 times 10^(-3)$ min#super[-1], so the ratio of the
difference to its uncertainty is 1.3 and the two batches are not
distinguishable at the 95 % level. The relative difference is 2.9 %, an order
below the interbatch spread that would have been unremarkable in the
literature.

#note[Replication outcome.][
  The reference rate constant reproduces across independently synthesised
  batches. Results in this notebook can be attributed to NT-500 as a material
  rather than to batch NT500-B3.
]

== pH series

Five runs at pH 3.0, 5.0, 6.8, 8.5 and 10.0, all on batch NT500-B3 at
1.00 g L#super[-1]. pH was set before the dark equilibration with dilute
perchloric acid or sodium hydroxide, both chosen because they contribute no
radical scavenging anion, and was monitored throughout. Drift over the 180 min
run was below 0.15 pH units in every case except pH 10.0, which fell by 0.31
units despite the sealed headspace, presumably through slow carbon dioxide
ingress at the sampling port.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [pH],
      [$k_"app"$\ (10#super[-3] min#super[-1])],
      [Zeta potential\ (mV)],
      [Dark uptake\ (µmol g#super[-1])],
      [Removal at 180 min\ (%)],
    ),
    table.hline(stroke: 0.5pt),
    [3.0], [#pm[7.42][0.18]], [#pm[28.4][1.2]], [#pm[4.1][0.3]], [73.7],
    [5.0], [#pm[10.42][0.16]], [#pm[14.1][0.9]], [#pm[8.9][0.3]], [84.7],
    [6.8], [#pm[11.31][0.14]], [#sym.minus 2.6 #sym.plus.minus 0.8], [#pm[10.3][0.4]], [87.0],
    [8.5], [#pm[9.15][0.21]], [#sym.minus 19.3 #sym.plus.minus 1.1], [#pm[7.2][0.3]], [80.7],
    [10.0], [#pm[6.18][0.25]], [#sym.minus 31.8 #sym.plus.minus 1.4], [#pm[3.8][0.3]], [67.1],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    pH dependence of the apparent rate constant on NT-500 at 1.00 g L#super[-1].
    Zeta potentials are electrophoretic mobility measurements on separate
    dilute suspensions at the same pH and ionic strength. The point of zero
    charge determined by potentiometric titration is pH 6.2.
  ],
) <tab:ph>

#figure(
  chart(8.2cm, 5.0cm, {
    axes(
      8.2cm, 5.0cm, (0, 6), (0, 13),
      ((1, [3.0]), (2, [5.0]), (3, [6.8]), (4, [8.5]), (5, [10.0])),
      ((0, [0]), (2, [2]), (4, [4]), (6, [6]), (8, [8]), (10, [10]), (12, [12])),
      [Suspension pH],
      [$k_"app"$ (10#super[-3] min#super[-1])],
    )
    bars(
      ((1, 7.42, 0.18), (2, 10.42, 0.16), (3, 11.31, 0.14), (4, 9.15, 0.21), (5, 6.18, 0.25)),
      (0, 6), (0, 13), 8.2cm, 5.0cm, accent, bar-width: 0.72cm,
    )
    place(dx: xmap(2.85, (0, 6), 8.2cm), dy: 0pt, line(
      angle: 90deg, length: 5.0cm,
      stroke: (paint: accent-warm, thickness: 0.8pt, dash: "dashed"),
    ))
    tag(xmap(3.55, (0, 6), 8.2cm), 0.10cm, [Point of zero\ charge, pH 6.2],
      w: 2.4cm, alignment: left)
  }),
  caption: [
    Apparent rate constant against pH. The maximum sits within 0.6 pH units of
    the point of zero charge, and the dark uptake in @tab:ph peaks at the same
    condition.
  ],
) <fig:ph>

== Interpretation

The rate and the dark uptake in @tab:ph peak together at pH 6.8, and the peak
is close to the point of zero charge at pH 6.2. Carbamazepine is neutral across
this entire range, its amide nitrogen having a $p K_a$ near 13.9, so the
electrostatics cannot be acting on the substrate charge. What the double layer
does affect is the surface itself. Away from the point of zero charge the
surface carries net charge and orders a hydration shell that a neutral, weakly
polar molecule has to displace in order to adsorb, and adsorption is a
prerequisite for reaction on a Langmuir-Hinshelwood pathway
@weissbach2018pzc. The uptake column is the direct evidence for this: it falls
by a factor of 2.5 on either side of the maximum, and the rate falls with it.

Two additional effects act at the extremes and both push the same way. At
pH 3.0 the high proton activity provides a competing sink for conduction band
electrons, which diverts them from the oxygen reduction that generates
superoxide and, more importantly, leaves fewer electrons available to be
scavenged, raising the recombination rate. At pH 10.0 the surface is strongly
negative and repels superoxide, and the higher hydroxide activity does not
compensate because hole trapping at this surface is already saturated.

The practical reading is that the process is at its best near neutral pH, which
is convenient, since that is where municipal secondary effluent arrives, and
that no pH adjustment step is warranted.

== Observations

The zeta potential measurements were made on suspensions diluted twentyfold
from the reactor concentration, because the instrument cannot handle the
working suspension optically. Whether the double layer of the dilute suspension
represents that of the working suspension is an assumption, not a measurement.
It is probably safe at the ionic strengths used here, all below
5 mmol L#super[-1], but it should be stated rather than passed over.

The pH 10.0 run is the weakest of the set. The 0.31 unit drift means the run
did not hold a single condition, and the reported constant is an average over a
pH that moved. It is retained because the trend is unambiguous and one drifting
endpoint does not change it, but it should be repeated with a carbonate-free
buffered headspace before the value is used quantitatively.

== Next

Session 7 identifies which reactive species carries the degradation, using
selective scavengers, and tests the matrix effects that will decide whether any
of this survives contact with a real water.
]
