#import "../notebook.typ": *

= Kinetic series over NT-500 at four catalyst loadings

#entry(
  date: "2026-04-01",
  session: "NB7-S05",
  operator: "M. Ostrowska-Rehn, E. Vondracek",
  instrument: [PR-2, LAMP-1, RAD-1, SPEC-1, HPLC-2],
  conditions: "22.9 °C, 42 % RH, 1013 hPa",
  sample: [NT-500 batch NT500-B3, runs PR2-013 to PR2-016],
)[

== Purpose

The substantive experiment of the campaign. Four runs at catalyst loadings of
0.25, 0.50, 1.00 and 2.00 g L#super[-1], all under protocol PR2-CBZ-02, all on
the same catalyst batch, all on the same day so that lamp ageing across the
series is negligible. The objective is the apparent first-order rate constant
as a function of loading and, in particular, whether an optimum exists within
the accessible range.

== Conditions common to the four runs

Wall irradiance was 44.1 W m#super[-2] before the first run and
43.2 W m#super[-2] after the last, a drift of 2.0 % over 14 lamp hours, inside
the 3 % limit. The interlock passed on each of the four tests. The dark
equilibration concentrations after 45 min were 19.63, 19.31, 18.72 and
17.54 µmol L#super[-1] respectively, which track the adsorption capacity
measured in session 2 and are used as $C_0$ in every calculation below rather
than the 20.0 µmol L#super[-1] nominal charge.

== Readings

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Time\ (min)],
      [0.25 g L#super[-1]\ (µmol L#super[-1])],
      [0.50 g L#super[-1]\ (µmol L#super[-1])],
      [1.00 g L#super[-1]\ (µmol L#super[-1])],
      [2.00 g L#super[-1]\ (µmol L#super[-1])],
    ),
    table.hline(stroke: 0.5pt),
    [0], [#pm[20.0][0.2]], [#pm[20.0][0.2]], [#pm[20.0][0.2]], [#pm[20.0][0.2]],
    [15], [#pm[18.7][0.2]], [#pm[17.7][0.2]], [#pm[16.9][0.2]], [#pm[17.3][0.2]],
    [30], [#pm[17.6][0.2]], [#pm[15.7][0.2]], [#pm[14.3][0.2]], [#pm[14.9][0.2]],
    [45], [#pm[16.4][0.2]], [#pm[13.9][0.2]], [#pm[12.0][0.2]], [#pm[12.9][0.2]],
    [60], [#pm[15.4][0.2]], [#pm[12.3][0.2]], [#pm[10.2][0.1]], [#pm[11.1][0.2]],
    [90], [#pm[13.5][0.2]], [#pm[9.6][0.1]], [#pm[7.2][0.1]], [#pm[8.3][0.1]],
    [120], [#pm[11.9][0.2]], [#pm[7.6][0.1]], [#pm[5.2][0.1]], [#pm[6.2][0.1]],
    [150], [#pm[10.5][0.1]], [#pm[5.9][0.1]], [#pm[3.7][0.1]], [#pm[4.6][0.1]],
    [180], [#pm[9.2][0.1]], [#pm[4.7][0.1]], [#pm[2.6][0.1]], [#pm[3.4][0.1]],
    table.hline(stroke: 0.5pt),
    [Removal (%)], [54.0], [76.5], [87.0], [83.0],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Carbamazepine concentration against irradiation time for runs PR2-013 to
    PR2-016. Concentrations are normalised to a common $C_0$ of
    20.0 µmol L#super[-1] so that the four curves can be compared directly;
    the measured dark equilibration values are given in the text.
  ],
) <tab:kinetics>

== Rate model

Heterogeneous photocatalysis of a dilute substrate is conventionally described
by Langmuir-Hinshelwood kinetics, in which reaction occurs between adsorbed
substrate and surface-bound oxidant:

$ r = - (dif C) / (dif t) = (k_r dot.c K dot.c C) / (1 + K dot.c C) $ <eq:lh>

Session 2 gives $K = 0.088$ L µmol#super[-1], so at the working concentration
of 20 µmol L#super[-1] the product $K C$ is 1.76 and the denominator is far
from unity. The usual step of asserting $K C << 1$ and collapsing @eq:lh to a
first-order form is therefore not justified on the adsorption data
@okonjo2018langmuir. What is nevertheless observed is that the decay is
first-order to good precision, which is a well-known and slightly awkward
feature of these systems: the linearised plot works better than the underlying
model says it should, because the adsorption equilibrium under illumination is
not the dark equilibrium that was measured. The pragmatic position taken here
is to report an apparent constant

$ ln (C_0 / C) = k_"app" dot.c t $ <eq:firstorder>

and to treat $k_"app"$ as an empirical descriptor valid at this concentration
and this photon flux, not as an elementary rate constant. Every comparison in
this notebook holds both quantities fixed, so the descriptor is a fair basis
for comparison even though it is not a mechanistic parameter.

#figure(
  chart(9.4cm, 5.4cm, {
    axes(
      9.4cm, 5.4cm, (0, 190), (0, 21),
      ((0, [0]), (30, [30]), (60, [60]), (90, [90]), (120, [120]), (150, [150]), (180, [180])),
      ((0, [0]), (5, [5]), (10, [10]), (15, [15]), (20, [20])),
      [Irradiation time (min)],
      [Concentration (µmol L#super[-1])],
    )
    series(
      ((0, 20.0), (15, 18.7), (30, 17.6), (45, 16.4), (60, 15.4), (90, 13.5), (120, 11.9), (150, 10.5), (180, 9.2)),
      (0, 190), (0, 21), 9.4cm, 5.4cm, accent, kind: "ring", size: 2.2pt,
    )
    series(
      ((0, 20.0), (15, 17.7), (30, 15.7), (45, 13.9), (60, 12.3), (90, 9.6), (120, 7.6), (150, 5.9), (180, 4.7)),
      (0, 190), (0, 21), 9.4cm, 5.4cm, accent-green, kind: "square", size: 1.9pt,
    )
    series(
      ((0, 20.0), (15, 16.9), (30, 14.3), (45, 12.0), (60, 10.2), (90, 7.2), (120, 5.2), (150, 3.7), (180, 2.6)),
      (0, 190), (0, 21), 9.4cm, 5.4cm, accent-warm, kind: "circle", size: 2.1pt,
    )
    series(
      ((0, 20.0), (15, 17.3), (30, 14.9), (45, 12.9), (60, 11.1), (90, 8.3), (120, 6.2), (150, 4.6), (180, 3.4)),
      (0, 190), (0, 21), 9.4cm, 5.4cm, accent-plum, kind: "diamond", size: 2.3pt, dash: "dashed",
    )
    legend(6.10cm, 0.25cm, (
      (accent, [0.25 g L#super[-1]]),
      (accent-green, [0.50 g L#super[-1]]),
      (accent-warm, [1.00 g L#super[-1]]),
      (accent-plum, [2.00 g L#super[-1]]),
    ), width: 3.0cm)
  }),
  caption: [
    Carbamazepine decay at four catalyst loadings under identical photon flux.
    The 2.00 g L#super[-1] series lies above the 1.00 g L#super[-1] series
    throughout, which is the signature of an optimum loading rather than of a
    failed run.
  ],
) <fig:decay>

== Linearised analysis

@fig:linear plots @eq:firstorder for the four runs. All four are linear to
$R^2 > 0.998$ across the full 180 min, with no systematic curvature that would
indicate catalyst deactivation or a competing pathway opening up as
transformation products accumulate.

#figure(
  chart(9.0cm, 5.0cm, {
    axes(
      9.0cm, 5.0cm, (0, 190), (0, 2.2),
      ((0, [0]), (30, [30]), (60, [60]), (90, [90]), (120, [120]), (150, [150]), (180, [180])),
      ((0, [0.0]), (0.5, [0.5]), (1.0, [1.0]), (1.5, [1.5]), (2.0, [2.0])),
      [Irradiation time (min)],
      [$ln(C_0 \/ C)$],
    )
    series(
      ((0, 0.000), (15, 0.067), (30, 0.128), (45, 0.198), (60, 0.261), (90, 0.393), (120, 0.519), (150, 0.645), (180, 0.777)),
      (0, 190), (0, 2.2), 9.0cm, 5.0cm, accent, kind: "ring", size: 2.2pt,
    )
    series(
      ((0, 0.000), (15, 0.122), (30, 0.241), (45, 0.363), (60, 0.486), (90, 0.734), (120, 0.968), (150, 1.221), (180, 1.448)),
      (0, 190), (0, 2.2), 9.0cm, 5.0cm, accent-green, kind: "square", size: 1.9pt,
    )
    series(
      ((0, 0.000), (15, 0.168), (30, 0.336), (45, 0.511), (60, 0.673), (90, 1.022), (120, 1.347), (150, 1.686), (180, 2.040)),
      (0, 190), (0, 2.2), 9.0cm, 5.0cm, accent-warm, kind: "circle", size: 2.1pt,
    )
    series(
      ((0, 0.000), (15, 0.145), (30, 0.294), (45, 0.438), (60, 0.588), (90, 0.879), (120, 1.171), (150, 1.470), (180, 1.772)),
      (0, 190), (0, 2.2), 9.0cm, 5.0cm, accent-plum, kind: "diamond", size: 2.3pt, dash: "dashed",
    )
    legend(0.35cm, 0.2cm, (
      (accent-warm, [1.00 g L#super[-1]]),
      (accent-plum, [2.00 g L#super[-1]]),
      (accent-green, [0.50 g L#super[-1]]),
      (accent, [0.25 g L#super[-1]]),
    ), width: 3.0cm)
  }),
  caption: [
    Linearised form of the four runs. The ordering of the slopes, with
    1.00 g L#super[-1] above 2.00 g L#super[-1], is stable across the whole
    series and is not an artefact of the endpoint.
  ],
) <fig:linear>

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Loading\ (g L#super[-1])],
      [$k_"app"$\ (10#super[-3] min#super[-1])],
      [$R^2$],
      [Half-life\ (min)],
      [Rate per gram\ (10#super[-3] L g#super[-1] min#super[-1])],
    ),
    table.hline(stroke: 0.5pt),
    [0.25], [#pm[4.31][0.09]], [0.9993], [160.8], [17.24],
    [0.50], [#pm[8.12][0.11]], [0.9997], [85.4], [16.24],
    [1.00], [#pm[11.31][0.14]], [0.9998], [61.3], [11.31],
    [2.00], [#pm[9.81][0.19]], [0.9984], [70.7], [4.91],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Apparent first-order rate constants from the slopes in @fig:linear.
    Uncertainties are the standard error of the regression slope. The final
    column normalises by catalyst mass and falls monotonically, which the
    unnormalised constant does not.
  ],
) <tab:kapp>

== Interpretation

@tab:kapp contains the result of the session. The apparent rate constant rises
with loading to 1.00 g L#super[-1] and then falls. The rise is straightforward:
more catalyst means more active surface and more absorbed photons, up to the
point where the suspension absorbs essentially all the incident light. Beyond
that point additional catalyst adds no absorption but does add scattering and
shading, so the outer shell of the suspension intercepts photons that no longer
reach the inner volume, and the volume-averaged rate falls. The optical depth
argument predicts the turnover should occur near the loading at which the
suspension becomes opaque over the annular gap, and a transmission measurement
through a 1 cm cell of the 1.00 g L#super[-1] suspension gave 4.1 % at 450 nm,
which is consistent.

The final column of @tab:kapp is the more honest efficiency measure. Rate per
unit catalyst mass falls monotonically across the whole series, from 17.2 to
4.9 in the tabulated units. There is no loading at which the catalyst is used
more efficiently than at the lowest one tested; the optimum at
1.00 g L#super[-1] is an optimum in volumetric rate only. For a process design
that pays for catalyst, the relevant optimum is elsewhere.

== Observations

Run PR2-016 at 2.00 g L#super[-1] was the only one where filtration became
difficult, with the 0.22 µm filters loading up after about three samples and
needing replacement mid-run. Two filters were changed and the change points are
noted in the raw log. The concern is that a partially loaded filter retains
carbamazepine, which would bias readings low and inflate the apparent rate. The
150 min sample was therefore drawn twice, once through a filter that had passed
two prior samples and once through a fresh filter, and the two readings agreed
to 0.6 %. The effect is below the noise at this loading.

The $R^2$ of 0.9984 for the 2.00 g L#super[-1] run is the lowest of the four
and the residuals are slightly larger at the early times. This is consistent
with incomplete mixing at high solids loading, where the local catalyst
concentration near the sampling port takes longer to stabilise after each
withdrawal.

#note[Result.][
  Optimum volumetric rate at 1.00 g L#super[-1],
  $k_"app" = (11.31 plus.minus 0.14) times 10^(-3)$ min#super[-1]. This
  condition becomes the reference for the remaining sessions.
]

== Next

Session 6 replicates the reference condition on an independently synthesised
catalyst batch and measures the pH dependence.
]
