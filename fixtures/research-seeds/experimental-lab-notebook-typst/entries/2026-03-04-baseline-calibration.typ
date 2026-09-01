#import "../notebook.typ": *

= Baseline calibration of the carbamazepine assay

#entry(
  date: "2026-03-04",
  session: "NB7-S01",
  operator: "M. Ostrowska-Rehn",
  instrument: [SPEC-1, HPLC-2, BAL-1],
  conditions: "21.4 °C, 44 % RH, 1012 hPa",
  sample: [CBZ stock CBZ-S26-03, 200 µmol L#super[-1] in 2 % methanol],
)[

== Purpose

Before any photocatalytic run there has to be an analytical method whose
uncertainty is smaller than the effect being measured. This session builds two
independent calibrations for carbamazepine, one by direct ultraviolet
absorbance and one by reversed-phase chromatography, and establishes the
working range, the limit of detection and the limit of quantification for each.
The two methods are not redundant. Absorbance is fast enough to follow a
kinetic run in real time but cannot distinguish the parent compound from
transformation products that absorb in the same region, whereas chromatography
separates them at the cost of a nine minute cycle. The plan is to run the
kinetics on absorbance and confirm selected points chromatographically.

== Preparation

A primary stock of 200 µmol L#super[-1] carbamazepine was prepared by weighing
4.7245 g of solid into a 100 mL volumetric flask, dissolving in 2 mL of
methanol and making to volume with ultrapure water at 18.2 M#sym.Omega cm. The
methanol fraction is 2 % by volume and is held constant across every standard
and every reactor charge, because methanol is itself a hydroxyl radical
scavenger and a varying fraction would silently vary the measured rate. Working
standards at 2.00, 5.00, 10.00, 15.00, 20.00 and 25.00 µmol L#super[-1] were
prepared by serial dilution, each in a separate 50 mL flask rather than by
cascade, so that a pipetting error does not propagate down the series.

The absorbance maximum was located by scanning a 10 µmol L#super[-1] standard
from 220 to 400 nm against an ultrapure water blank. The spectrum shows the
expected two-band structure with maxima at 212 nm and 285 nm. The 285 nm band
was selected despite its lower molar absorptivity because the 212 nm region
overlaps the absorbance edge of nitrate and of the dissolved organic matter
that will appear in the later matrix experiments.

== Readings

@tab:cal-uv reports the calibration series. Each standard was measured in
triplicate with the cuvette emptied, rinsed and refilled between replicates, so
the reported uncertainty includes cuvette positioning and not merely detector
noise.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Level],
      [Concentration\ (µmol L#super[-1])],
      [Absorbance\ at 285 nm],
      [HPLC peak area\ (mAU s)],
      [Retention time\ (min)],
    ),
    table.hline(stroke: 0.5pt),
    [Blank], [0.00], [#pm[0.006][0.003]], [not detected], [#sym.dash.en],
    [1], [2.00], [#pm[0.118][0.004]], [#pm[41.2][0.6]], [6.41],
    [2], [5.00], [#pm[0.291][0.006]], [#pm[103.4][0.9]], [6.40],
    [3], [10.00], [#pm[0.577][0.007]], [#pm[206.1][1.4]], [6.42],
    [4], [15.00], [#pm[0.864][0.009]], [#pm[309.7][1.8]], [6.41],
    [5], [20.00], [#pm[1.148][0.012]], [#pm[412.8][2.3]], [6.40],
    [6], [25.00], [#pm[1.372][0.015]], [#pm[516.3][2.9]], [6.41],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Calibration standards measured on SPEC-1 and HPLC-2. Uncertainties are one
    standard deviation of three independent measurements. Level 6 departs from
    the absorbance fit and is excluded from the working range.
  ],
) <tab:cal-uv>

== Analysis

The absorbance calibration is the Beer-Lambert relation

$ A(lambda) = epsilon(lambda) dot.c b dot.c C + A_0 $ <eq:beer>

with #sym.epsilon the molar absorptivity, $b = 1.000$ cm the optical path and
$A_0$ an intercept that absorbs any residual blank mismatch. Ordinary least
squares over levels 1 to 5 gives a slope of
$5.735 times 10^(-2)$ L µmol#super[-1] cm#super[-1], an intercept of
$3.1 times 10^(-3)$ and a coefficient of determination of 0.9998. Level 6 lies
4.4 % below the line. This is the onset of stray-light limited nonlinearity at
absorbance above about 1.2 on this instrument rather than any chemistry, and
the chromatographic response at the same concentration remains on its own line
to within 0.3 %, which confirms the standard itself was correctly prepared. The
working range for absorbance is therefore fixed at 0 to 20 µmol L#super[-1] and
every reactor charge in this campaign starts at 20.0 µmol L#super[-1] so that
all subsequent readings fall inside it.

@fig:cal-uv plots both calibrations on a common concentration axis. The
divergence of the two responses at the top standard is the visual form of the
argument above.

#figure(
  chart(7.6cm, 4.6cm, {
    axes(
      7.6cm, 4.6cm, (0, 26), (0, 1.5),
      ((0, [0]), (5, [5]), (10, [10]), (15, [15]), (20, [20]), (25, [25])),
      ((0, [0.00]), (0.30, [0.30]), (0.60, [0.60]), (0.90, [0.90]), (1.20, [1.20]), (1.50, [1.50])),
      [Nominal concentration (µmol L#super[-1])],
      [Absorbance at 285 nm],
    )
    series(
      ((0, 0.0031), (25, 1.4368)),
      (0, 26), (0, 1.5), 7.6cm, 4.6cm, luma(55%),
      line-only: true, dash: "dashed",
    )
    series(
      ((0, 0.006), (2, 0.118), (5, 0.291), (10, 0.577), (15, 0.864), (20, 1.148)),
      (0, 26), (0, 1.5), 7.6cm, 4.6cm, accent, kind: "ring", size: 2.2pt,
    )
    series(
      ((25, 1.372),),
      (0, 26), (0, 1.5), 7.6cm, 4.6cm, accent-warm, kind: "diamond", size: 2.6pt,
    )
    series(
      ((0, 0.0), (2, 0.1197), (5, 0.3005), (10, 0.5989), (15, 0.9000), (20, 1.1997), (25, 1.5006)),
      (0, 26), (0, 1.5), 7.6cm, 4.6cm, accent-green,
      kind: "square", size: 1.8pt, dash: "dotted",
    )
    errbars(
      ((5, 0.291, 0.006), (10, 0.577, 0.007), (15, 0.864, 0.009), (20, 1.148, 0.012)),
      (0, 26), (0, 1.5), 7.6cm, 4.6cm, accent,
    )
    legend(0.35cm, 0.2cm, (
      (accent, [Absorbance, levels 1 to 5]),
      (accent-warm, [Level 6, excluded]),
      (accent-green, [HPLC area, rescaled]),
      (luma(55%), [Least squares fit]),
    ), width: 4.3cm)
  }),
  caption: [
    Calibration of the carbamazepine assay. The chromatographic response has
    been rescaled onto the absorbance axis by its own slope so that the two
    methods can be compared for linearity. The absorbance response falls below
    the fitted line at the top standard while the chromatographic response does
    not.
  ],
) <fig:cal-uv>

The limits of detection and quantification were computed from the standard
deviation $s_b$ of ten blank measurements and the calibration slope $m$ as
$3.3 s_b \/ m$ and $10 s_b \/ m$ respectively:

$ "LOD" = (3.3 dot.c s_b) / m, quad "LOQ" = (10 dot.c s_b) / m $ <eq:lod>

With $s_b = 3.6 times 10^(-3)$ absorbance units this gives an absorbance limit
of detection of 0.21 µmol L#super[-1] and a limit of quantification of
0.63 µmol L#super[-1]. The chromatographic limits are 0.04 and
0.12 µmol L#super[-1]. The chromatographic method is therefore the one that
must be used for the tail of any decay curve below about 1 µmol L#super[-1],
which matters for the mineralisation question raised in the final session.

== Chromatographic conditions

The separation runs on a Kestrel C18 column, 150 by 4.6 mm with 5 µm particles,
held at 30 °C. The gradient below was transferred unchanged from NB-6 and
reverified today; the carbamazepine peak elutes at 6.41 min with a tailing
factor of 1.06 and a plate count of 14 200.

```text
METHOD  CBZ-DAD-01           column KESTREL-C18-150
FLOW    1.00 mL/min          injection 20 uL
OVEN    30.0 C               detection 285 nm, 4 nm slit
SOLVENT A  water + 0.1 % formic acid
SOLVENT B  acetonitrile

GRADIENT
  0.0 min   30 % B
  5.0 min   55 % B
  7.5 min   55 % B
  7.6 min   30 % B
  9.0 min   30 % B      end, re-equilibrate
```

== Observations

Two things worth recording. First, the 285 nm absorbance of a standard left
capped on the bench drifted upward by 1.8 % over four hours under laboratory
lighting, which is a real effect and not evaporation, because the
chromatographic area of the same vial was unchanged. The likely cause is slow
photoisomerisation under the fluorescent fixtures. All standards are therefore
stored in amber vials from now on and measured within one hour of preparation.
Second, the first blank of the day read 0.021, far outside the blank
population, and was traced to a fingerprint on the cuvette face. The cuvette
handling step was added to the session checklist.

#note[Method status.][
  Absorbance calibration accepted over 0 to 20 µmol L#super[-1]; chromatographic
  calibration accepted over 0 to 25 µmol L#super[-1]. Both calibrations are
  valid for this campaign and are to be reverified if the lamp, the column or
  the stock is changed.
]

== Next

Session 2 measures dark adsorption on the three candidate catalysts, which has
to be separated from photocatalytic conversion before any rate constant is
meaningful.
]
