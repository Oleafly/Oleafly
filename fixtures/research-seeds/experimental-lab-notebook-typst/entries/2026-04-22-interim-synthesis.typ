#import "../notebook.typ": *

= Mineralisation, uncertainty budget and interim conclusions

#entry(
  date: "2026-04-22",
  session: "NB7-S08",
  operator: "M. Ostrowska-Rehn, H. Njiru",
  instrument: [PR-2, LAMP-1, SPEC-1, HPLC-2, TOC-1],
  conditions: "22.2 °C, 45 % RH, 1011 hPa",
  sample: [NT-500 batch NT500-B3, run PR2-032 and archived filtrates],
)[

== Purpose

Closing session of the campaign. Three tasks: measure how much of the
carbamazepine that disappears is actually mineralised rather than merely
transformed, survey the transformation products that the chromatograms have
been showing all along, and construct the uncertainty budget that every
comparison in the preceding sessions has implicitly assumed.

== Mineralisation

Run PR2-032 repeated the reference condition with a doubled charge volume so
that the larger samples required by the total organic carbon analyser could be
drawn without depleting the reactor. Carbamazepine was followed by
chromatography and total organic carbon by combustion.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Time\ (min)],
      [Carbamazepine\ (µmol L#super[-1])],
      [CBZ removal\ (%)],
      [Total organic carbon\ (mg L#super[-1])],
      [TOC removal\ (%)],
    ),
    table.hline(stroke: 0.5pt),
    [0], [#pm[20.0][0.2]], [0.0], [#pm[4.21][0.06]], [0.0],
    [30], [#pm[14.3][0.2]], [28.5], [#pm[4.04][0.06]], [4.1],
    [60], [#pm[10.2][0.1]], [49.0], [#pm[3.81][0.06]], [9.6],
    [90], [#pm[7.2][0.1]], [64.0], [#pm[3.53][0.05]], [16.2],
    [120], [#pm[5.2][0.1]], [74.0], [#pm[3.25][0.05]], [22.8],
    [150], [#pm[3.7][0.1]], [81.5], [#pm[2.99][0.05]], [28.9],
    [180], [#pm[2.6][0.1]], [87.0], [#pm[2.77][0.04]], [34.2],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Parent compound removal against total organic carbon removal in run
    PR2-032. The initial organic carbon includes the 2 % methanol cosolvent,
    which contributes 3.16 mg L#super[-1] of the 4.21 mg L#super[-1] total and
    is itself slowly oxidised.
  ],
) <tab:toc>

#figure(
  chart(8.6cm, 5.0cm, {
    axes(
      8.6cm, 5.0cm, (0, 190), (0, 100),
      ((0, [0]), (30, [30]), (60, [60]), (90, [90]), (120, [120]), (150, [150]), (180, [180])),
      ((0, [0]), (20, [20]), (40, [40]), (60, [60]), (80, [80]), (100, [100])),
      [Irradiation time (min)],
      [Removal (%)],
    )
    series(
      ((0, 0.0), (30, 28.5), (60, 49.0), (90, 64.0), (120, 74.0), (150, 81.5), (180, 87.0)),
      (0, 190), (0, 100), 8.6cm, 5.0cm, accent, kind: "circle", size: 2.2pt,
    )
    series(
      ((0, 0.0), (30, 4.1), (60, 9.6), (90, 16.2), (120, 22.8), (150, 28.9), (180, 34.2)),
      (0, 190), (0, 100), 8.6cm, 5.0cm, accent-green, kind: "square", size: 2.0pt,
    )
    place(
      dx: xmap(150, (0, 190), 8.6cm),
      dy: ymap(28.9, (0, 100), 5.0cm),
      line(angle: 90deg, length: ymap(81.5, (0, 100), 5.0cm) - ymap(28.9, (0, 100), 5.0cm) - 0pt,
        stroke: (paint: accent-warm, thickness: 0.7pt)),
    )
    tag(xmap(150, (0, 190), 8.6cm) - 3.15cm, ymap(55, (0, 100), 5.0cm) - 0.2cm,
      [52.6 point gap\ at 150 min], w: 3.0cm, alignment: right)
    legend(0.35cm, 0.20cm, (
      (accent, [Carbamazepine, chromatographic]),
      (accent-green, [Total organic carbon]),
    ), width: 4.9cm)
  }),
  caption: [
    Parent removal runs far ahead of mineralisation throughout. The gap is the
    organic carbon still in solution as transformation products.
  ],
) <fig:toc>

The result in @fig:toc is the most important qualification in this notebook.
At 180 min, 87 % of the carbamazepine is gone but only 34 % of the organic
carbon has been converted to carbon dioxide. Correcting for the methanol
contribution, which is itself being oxidised, the carbon originating from
carbamazepine is roughly 21 % mineralised while the parent is 87 % converted.
The overwhelming majority of the carbon is still in solution, as products this
assay does not identify. Reporting the 87 % as a treatment efficiency would be
misleading, which is exactly the criticism made of this literature
@arriaga2020toc, and the campaign report must lead with the mineralisation
number rather than the parent removal.

== Transformation products

Three peaks appear in the chromatograms that are absent at time zero.
@tab:tp summarises them from the archived filtrates of runs PR2-013 to
PR2-016 and PR2-032. Assignments are tentative and rest on retention order and
ultraviolet spectra only; no mass spectrometry was available in this campaign.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, center, left, center, left),
    table.hline(stroke: 0.8pt),
    head-row(
      [Peak],
      [Retention\ (min)],
      [Absorbance maximum],
      [Peak behaviour],
      [Tentative assignment],
    ),
    table.hline(stroke: 0.5pt),
    [TP-1], [4.21], [268 nm], [Rises to 60 min, then falls], [10,11-epoxide],
    [TP-2], [3.05], [254 nm], [Monotonic rise], [Acridine carbaldehyde],
    [TP-3], [2.48], [246 nm], [Monotonic rise], [Ring-opened, unassigned],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Transformation products observed by diode array detection. TP-1 behaves as
    a true intermediate, accumulating and then being consumed, while TP-2 and
    TP-3 accumulate throughout the run.
  ],
) <tab:tp>

TP-1 is the only one that behaves as an intermediate, rising through the first
hour and declining thereafter, which is the expected profile for the epoxide
that is the first hydroxyl radical addition product on this scaffold. The
concern is TP-2, whose ultraviolet spectrum is consistent with an acridine
derivative. Compounds in that family have been reported as more biologically
active than the parent @nakagawa2021transformation, and it accumulates
monotonically to the end of the run. A treatment that removes the parent while
accumulating that product is not obviously an improvement, and this needs mass
spectrometric confirmation before the campaign can claim anything about
treatment benefit.

== Uncertainty budget

Every comparison in sessions 5 to 7 has quoted the standard error of a
regression slope as though it were the uncertainty of the rate constant. It is
not. It describes only how well a straight line fits nine points that were all
collected in one run under one set of systematic conditions, and it is blind to
everything those conditions might be getting wrong @fenwick2014uncertainty. The
budget below collects the systematic contributions, each expressed as a
relative standard uncertainty in $k_"app"$.

#figure(
  table(
    columns: (auto, 1fr, auto, auto),
    align: (left, left, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Source],
      [Basis of the estimate],
      [$u(x_i)\/x_i$\ (%)],
      [Type],
    ),
    table.hline(stroke: 0.5pt),
    [Calibration slope], [Regression of session 1 standards, propagated], [1.4], [B],
    [Dilution and pipetting], [Manufacturer tolerance on the 3 mL pipette], [0.9], [B],
    [Filtration retention], [Fresh against loaded filter comparison], [1.8], [A],
    [Irradiance drift in run], [Start and end radiometer readings], [2.1], [A],
    [Temperature control], [Chiller stability, 0.3 °C, with activation energy], [0.7], [B],
    [Catalyst mass], [Balance repeatability at 250 mg], [0.5], [B],
    [Sampling time], [Manual clock, 5 s at the shortest interval], [0.4], [B],
    table.hline(stroke: 0.5pt),
    [Combined], [Root sum of squares of the above], [3.4], [],
    [Expanded], [Coverage factor 2, roughly 95 %], [6.8], [],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Uncertainty budget for the apparent rate constant at the reference
    condition. Type A contributions are evaluated statistically from repeated
    observation and type B from other information.
  ],
) <tab:budget>

The combination follows the usual propagation rule for a quantity that depends
on several independent inputs:

$ (u(k_"app")) / k_"app" = sqrt(sum_(i=1)^n ((partial ln k_"app") / (partial x_i))^2 u^2 (x_i)) $ <eq:propagation>

Evaluating @eq:propagation over @tab:budget gives a combined relative standard
uncertainty of 3.4 % and an expanded uncertainty of 6.8 % at roughly 95 %
confidence. The reference constant is therefore properly stated as
$k_"app" = (11.3 plus.minus 0.8) times 10^(-3)$ min#super[-1], not
$(11.31 plus.minus 0.14) times 10^(-3)$ min#super[-1].

This changes how the earlier sessions should be read. The 2.9 % interbatch
difference in session 6 is now comfortably inside a single expanded
uncertainty, which strengthens the replication conclusion. The 7.7 % chloride
effect in session 7 is barely one standard uncertainty and should not be
reported as an effect at all. The loading optimum in session 5 survives, since
the difference between the 1.00 and 2.00 g L#super[-1] constants is 15 %, but
the margin is smaller than the regression errors made it look.

The three largest contributions are irradiance drift, filtration retention and
the calibration slope. All three are reducible. A feedback-stabilised lamp
supply would address the first, an in-line filter changed on a fixed schedule
rather than on resistance the second, and a bracketing calibration run on the
day of each experiment the third. Together they would bring the combined
uncertainty to roughly 1.6 %.

The reduction below was applied uniformly to every run in this campaign, and is
recorded so that the archived absorbance logs can be reprocessed identically.

```python
import numpy as np


def apparent_rate_constant(t_min, absorbance, slope, intercept, blank):
    """Fit ln(C0/C) against time and return k_app with its standard error."""
    concentration = (absorbance - blank - intercept) / slope
    c0 = concentration[0]
    y = np.log(c0 / concentration)

    n = len(t_min)
    sxx = np.sum((t_min - t_min.mean()) ** 2)
    k = np.sum((t_min - t_min.mean()) * (y - y.mean())) / sxx

    residual = y - k * t_min
    s2 = np.sum((residual - residual.mean()) ** 2) / (n - 2)
    return k, np.sqrt(s2 / sxx)


def combined_uncertainty(relative_terms):
    """Root sum of squares of independent relative standard uncertainties."""
    return np.sqrt(np.sum(np.square(relative_terms)))


SYSTEMATIC = np.array([1.4, 0.9, 1.8, 2.1, 0.7, 0.5, 0.4])
print(f"combined {combined_uncertainty(SYSTEMATIC):.1f} %")
print(f"expanded {2 * combined_uncertainty(SYSTEMATIC):.1f} %")
```

== Interim conclusions

Nitrogen-doped titania calcined at 500 °C degrades carbamazepine under visible
light at a useful rate. At the optimum loading of 1.00 g L#super[-1] and a
volumetric photon delivery of $2.32 times 10^(-7)$ einstein L#super[-1]
s#super[-1], the apparent first-order constant is
$(11.3 plus.minus 0.8) times 10^(-3)$ min#super[-1], corresponding to a
half-life of 61 min. The constant reproduces across independently synthesised
batches to within 3 %.

The optimum in volumetric rate is not an optimum in catalyst utilisation. Rate
per unit mass falls monotonically over the whole loading range tested, so the
economically interesting operating point is at lower loading than the
kinetically fastest one, and a proper optimisation would need a cost model that
this campaign does not have.

The process is at its best near neutral pH, which is where municipal secondary
effluent arrives, and needs no pH adjustment. In a real effluent the rate falls
by 64 %, most of it attributable to bicarbonate alkalinity and dissolved
organic matter acting together.

The mineralisation result is the finding that constrains everything else. The
parent compound is 87 % converted at three hours but only about a fifth of its
carbon is mineralised, and one accumulating transformation product may belong
to a family more bioactive than carbamazepine itself. Nothing in this campaign
supports a claim of treatment benefit until those products are identified.

== Next campaign

Four items carry forward to NB-8. Mass spectrometric identification of TP-1 to
TP-3, in collaboration with the analytical facility, which is the blocking
item. Extension of the irradiation window to 12 h to establish whether
mineralisation eventually completes or plateaus. Replacement of the methanol
cosolvent, which contributes three quarters of the initial organic carbon and
obscures the mineralisation measurement, with a sonication-assisted dissolution
protocol. And the three uncertainty reductions identified in @tab:budget,
which should be implemented before any further comparative runs are made.

#note[Campaign status.][
  Notebook NB-7 closed 2026-04-22. Raw absorbance logs, chromatograms and
  radiometer records are archived under VIW-NB-2026-007. Continues in NB-8.
]
]
