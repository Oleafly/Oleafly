#import "../lib.typ": chart, series, legend

= Results <sec:results>

== Creep curves and minimum creep rate

@fig:creep shows engineering creep strain against time for heat A at four
stresses. The curves have the shape expected of a precipitation-strengthened
austenitic steel: a short primary stage, a long region of nearly constant rate,
and a tertiary acceleration that begins at roughly 60% of the rupture life. At
150 MPa the secondary stage occupies more than 2,000 h, which is the regime the
segregation argument concerns.

#figure(
  chart(
    width: 400pt,
    height: 180pt,
    pad-left: 42pt,
    pad-bottom: 30pt,
    xrange: (0, 3600),
    yrange: (0, 12),
    xticks: ((0, [0]), (600, [600]), (1200, [1200]), (1800, [1800]), (2400, [2400]), (3000, [3000]), (3600, [3600])),
    yticks: ((0, [0]), (3, [3]), (6, [6]), (9, [9]), (12, [12])),
    xlabel: [time under load (h)],
    ylabel: [engineering creep strain (%)],
    body: (px, py) => {
      series(px, py, (
        (0, 0), (40, 0.9), (90, 1.4), (180, 2.0), (300, 2.9), (420, 3.9),
        (520, 5.1), (600, 6.7), (660, 8.6), (700, 10.6), (720, 11.9),
      ), stroke: (paint: rgb("#8a2b13"), thickness: 1.1pt))
      series(px, py, (
        (0, 0), (60, 0.7), (150, 1.1), (350, 1.7), (600, 2.4), (900, 3.2),
        (1150, 4.1), (1330, 5.2), (1460, 6.7), (1550, 8.5), (1610, 10.4),
        (1650, 11.8),
      ), stroke: (paint: rgb("#b07a1e"), thickness: 1.1pt, dash: "dash-dotted"))
      series(px, py, (
        (0, 0), (80, 0.5), (250, 0.9), (600, 1.4), (1100, 2.1), (1600, 2.8),
        (2050, 3.6), (2400, 4.5), (2650, 5.6), (2830, 7.1), (2950, 9.0),
        (3020, 11.0), (3050, 11.9),
      ), stroke: (paint: rgb("#2f5fa8"), thickness: 1.1pt, dash: "dashed"))
      series(px, py, (
        (0, 0), (120, 0.35), (400, 0.6), (900, 0.95), (1500, 1.35),
        (2100, 1.78), (2700, 2.2), (3200, 2.6), (3600, 2.95),
      ), stroke: (paint: luma(90), thickness: 1.1pt, dash: "dotted"))
      place(
        dx: px(1900),
        dy: py(11.6),
        box(fill: white, inset: (x: 4pt, y: 3pt), legend((
          (rgb("#8a2b13"), "solid", [220 MPa]),
          (rgb("#b07a1e"), "dash-dotted", [190 MPa]),
          (rgb("#2f5fa8"), "dashed", [170 MPa]),
          (luma(90), "dotted", [150 MPa, interrupted at 3,600 h]),
        ), size: 8pt)),
      )
    },
  ),
  caption: [Creep curves for heat A at 923 K. The 150 MPa test was interrupted
    at 3,600 h and 2.95% strain for atom-probe analysis rather than run to
    rupture.],
) <fig:creep>

The Monkman-Grant product in the last column of @tab:creep is constant to
within 15% across both heats and all stresses, which is the behaviour the
empirical relation asserts @monkman1956empirical and a useful check that the
minimum rates and rupture times were extracted consistently.

Minimum creep rates and rupture data for both heats are collected in
@tab:creep. Heat B, with 0.11 wt.% less niobium, is uniformly weaker: at 190
MPa its minimum rate is 3.4 times that of heat A and its rupture life is 3.1
times shorter, while its rupture ductility is slightly higher, which is the
usual trade.

#figure(
  caption: [Creep results at 923 K. $dot(epsilon)_min$ is the minimum creep
    rate, $t_r$ the rupture time, $A_5$ the elongation at rupture over a five
    diameter gauge, and $Z$ the reduction of area. Entries marked with a dagger
    were interrupted before rupture.],
  table(
    columns: (auto, auto, auto, auto, auto, auto),
    align: (left, center, center, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [Heat and stress], [$dot(epsilon)_min$], [$t_r$], [$A_5$], [$Z$], [Monkman-Grant],
      [(MPa)], [($10^(-9)$ s#super[-1])], [(h)], [(%)], [(%)], [$dot(epsilon)_min t_r$],
    ),
    table.hline(stroke: 0.4pt),
    [A, 220], [21.4], [724], [11.9], [38.1], [0.056],
    [A, 190], [8.9], [1,655], [11.8], [36.4], [0.053],
    [A, 170], [4.1], [3,061], [11.9], [35.2], [0.045],
    [A, 150], [1.6], [#super[†]3,600], [#super[†]2.95], [--], [--],
    table.hline(stroke: 0.3pt),
    [B, 220], [70.2], [242], [13.4], [43.0], [0.061],
    [B, 190], [30.3], [536], [13.1], [41.7], [0.058],
    [B, 170], [14.0], [1,148], [12.6], [40.2], [0.058],
    table.hline(stroke: 0.9pt),
  ),
) <tab:creep>

== Stress dependence and the threshold

Fitting a Norton law to the minimum rates,

$ dot(epsilon)_min = A sigma^n exp(- Q_c / (R T)), $ <eq:norton>

gives an apparent stress exponent of $n = 8.7$ for heat A and $n = 7.9$ for
heat B, and an apparent activation energy of 412 kJ mol#super[-1] from
supplementary tests at 898 K and 948 K. Both values are far above the
expectations for lattice-diffusion-controlled climb in austenite, where $n
approx 5$ and $Q_c approx 280$ kJ mol#super[-1] @sherby1968creep. That
discrepancy is the standard signature of a threshold stress, and the standard
remedy is to refit with

$ dot(epsilon)_min = A' (sigma - sigma_"th")^(n') exp(- Q_c / (R T)) $ <eq:threshold>

holding $n' = 5$ and $Q_c = 280$ kJ mol#super[-1] at their physically expected
values and solving for $sigma_"th"$. @tab:fit gives the result. The
threshold obtained this way is 61 MPa for heat A and 34 MPa for heat B in the
solution-treated condition, and it rises with exposure in both.

#figure(
  caption: [Parameters of the threshold-stress fit of @eq:threshold with $n' =
    5$ and $Q_c = 280$ kJ mol#super[-1] fixed. $sigma_"th"$ is the fitted
    threshold, $lambda_p$ the mean MX particle spacing from transmission
    electron microscopy, $Gamma_"Nb"$ the boundary niobium enrichment from atom
    probe, and $R^2$ the coefficient of determination of the fit.],
  table(
    columns: (auto, auto, auto, auto, auto, auto),
    align: (left, center, center, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [Condition], [$sigma_"th"$], [$lambda_p$], [$Gamma_"Nb"$], [$sigma_"Orowan"$], [$R^2$],
      [], [(MPa)], [(nm)], [(at.%)], [(MPa)], [],
    ),
    table.hline(stroke: 0.4pt),
    [A, solution treated], [61], [78], [2.1], [58], [0.994],
    [A, 1,000 h at 923 K], [68], [104], [4.6], [44], [0.991],
    [A, 3,000 h at 923 K], [74], [141], [7.4], [32], [0.988],
    table.hline(stroke: 0.3pt),
    [B, solution treated], [34], [81], [1.4], [56], [0.990],
    [B, 3,000 h at 923 K], [41], [148], [3.9], [31], [0.985],
    table.hline(stroke: 0.9pt),
  ),
) <tab:fit>

== Boundary chemistry

The atom-probe reconstructions show a monotonic rise in boundary niobium with
exposure. In heat A the equivalent monolayer concentration goes from 2.1 at.%
in the solution-treated condition to 4.6 at.% after 1,000 h and 7.4 at.% after
3,000 h, against a bulk niobium level of 0.47 at.%. Chromium shows a weak
co-segregation of about 1.3 times bulk, and nickel is depleted at the boundary
by roughly the same factor, both of which are consistent with the site
competition expected in this system. No boundary carbide films were observed on
the analysed boundaries; discrete MX particles were present on some of them and
were excluded from the proximity histograms.
