#import "../notebook.typ": *

= Dark adsorption equilibrium and catalyst screening

#entry(
  date: "2026-03-11",
  session: "NB7-S02",
  operator: "M. Ostrowska-Rehn, E. Vondracek",
  instrument: [PR-2 dark, SPEC-1, BAL-1],
  conditions: "22.1 °C, 41 % RH, 1008 hPa",
  sample: [NT-450, NT-500, NT-550, reference AR-1],
)[

== Purpose

A photocatalytic run reports the disappearance of dissolved substrate, and
dissolved substrate disappears for two reasons: it is oxidised, and it sticks
to the catalyst. If the two are not separated then a catalyst with a large
surface area looks fast when it is merely adsorbent. This session measures the
dark adsorption isotherm of carbamazepine on the three doped titania batches
and on the undoped reference, and fixes the equilibration time that every later
run must use before the lamp is struck.

== Materials

Three nitrogen-doped titania batches from the NB-6 sol-gel series were used,
distinguished by calcination temperature: NT-450, NT-500 and NT-550. The
reference AR-1 is a commercial undoped anatase from the departmental store,
lot AR-2408. Characterisation data carried forward from NB-6 are repeated in
@tab:cat-char because they are needed to interpret the isotherms. Note that the
band gaps are Tauc estimates and should be treated as indicative only; the
Tauc construction assumes a parabolic band edge and a single transition type,
neither of which is safe for a substitutionally doped oxide with mid-gap
states @suzuki2019tauc. The narrowing relative to the undoped reference is
nevertheless in the range reported for substitutional nitrogen in sol-gel
titania, where the visible absorption is attributed to occupied nitrogen 2p
states lying above the oxygen 2p valence band edge rather than to a genuine
contraction of the gap @hatzimanolis2019visible.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Catalyst],
      [Calcination\ (°C)],
      [BET area\ (m#super[2] g#super[-1])],
      [Tauc gap\ (eV)],
      [Nitrogen content\ (at. %)],
    ),
    table.hline(stroke: 0.5pt),
    [NT-450], [450], [#pm[78][3]], [#pm[2.86][0.04]], [#pm[1.94][0.11]],
    [NT-500], [500], [#pm[92][4]], [#pm[2.79][0.03]], [#pm[2.21][0.09]],
    [NT-550], [550], [#pm[61][3]], [#pm[2.94][0.05]], [#pm[1.42][0.13]],
    [AR-1], [not applicable], [#pm[52][2]], [#pm[3.19][0.02]], [below detection],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Catalyst characterisation carried forward from NB-6. Surface areas are
    five-point BET nitrogen physisorption; nitrogen content is by combustion
    elemental analysis.
  ],
) <tab:cat-char>

== Procedure

For each isotherm point, 250 mL of carbamazepine solution at the stated initial
concentration was charged to PR-2 with the lamp housing removed and the vessel
wrapped in aluminium foil. Catalyst was added at 1.00 g L#super[-1] and the
suspension stirred at 400 rpm and thermostatted at 25.0 °C. Aliquots of 3 mL
were withdrawn at 0, 5, 10, 15, 20, 30, 45, 60 and 90 min, filtered through
0.22 µm polytetrafluoroethylene syringe filters and read at 285 nm. The filter
material matters: an early trial with cellulose acetate filters lost 6 % of the
carbamazepine to the membrane itself, which would have been recorded as
adsorption on the catalyst. Polytetrafluoroethylene filters were checked
against unfiltered centrifuged supernatant and agree to within 0.4 %.

== Equilibration time

Uptake on all four solids was complete within 30 min and unchanged at 60 and
90 min. The equilibration period for every subsequent illuminated run is
therefore fixed at 45 min in the dark, which carries a comfortable margin, and
the concentration measured at the end of that period, not the nominal charge,
is what will be used as $C_0$ in every rate calculation.

== Isotherm

@tab:isotherm gives the equilibrium uptake on NT-500 across six initial
concentrations. The uptake per unit mass is

$ q_e = ((C_0 - C_e) dot.c V) / m $ <eq:uptake>

with $V$ the working volume in litres and $m$ the catalyst mass in grams.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Charge\ (µmol L#super[-1])],
      [$C_e$\ (µmol L#super[-1])],
      [$q_e$ measured\ (µmol g#super[-1])],
      [$q_e$ Langmuir\ (µmol g#super[-1])],
      [Residual\ (%)],
    ),
    table.hline(stroke: 0.5pt),
    [4.71], [#pm[1.8][0.1]], [#pm[2.9][0.2]], [2.93], [#sym.minus 1.0],
    [9.80], [#pm[4.1][0.2]], [#pm[5.7][0.2]], [5.67], [#sym.plus 0.5],
    [16.20], [#pm[7.6][0.2]], [#pm[8.6][0.3]], [8.58], [#sym.plus 0.2],
    [23.70], [#pm[12.4][0.3]], [#pm[11.3][0.4]], [11.17], [#sym.plus 1.2],
    [31.30], [#pm[17.9][0.4]], [#pm[13.4][0.4]], [13.09], [#sym.plus 2.4],
    [37.80], [#pm[23.2][0.5]], [#pm[14.6][0.5]], [14.36], [#sym.plus 1.7],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Dark adsorption of carbamazepine on NT-500 at 1.00 g L#super[-1], 25.0 °C
    and unadjusted pH 6.8, after 60 min equilibration. Langmuir values are from
    the fit in @eq:langmuir.
  ],
) <tab:isotherm>

The data were fitted to the Langmuir form

$ q_e = (q_max dot.c K_L dot.c C_e) / (1 + K_L dot.c C_e) $ <eq:langmuir>

by nonlinear least squares on the untransformed variables, not by the
double-reciprocal linearisation, because the reciprocal transform weights the
low-concentration points by the square of their own error and would have driven
the fit from the two least reliable measurements @okonjo2018langmuir. The fit
gives a monolayer capacity $q_max = 21.4 plus.minus 0.9$ µmol g#super[-1] and
an affinity $K_L = 0.088 plus.minus 0.009$ L µmol#super[-1], with residuals
below 2.5 % across the whole range as shown in the final column of
@tab:isotherm. @fig:isotherm shows the fit.

#figure(
  chart(7.4cm, 4.5cm, {
    axes(
      7.4cm, 4.5cm, (0, 26), (0, 18),
      ((0, [0]), (5, [5]), (10, [10]), (15, [15]), (20, [20]), (25, [25])),
      ((0, [0]), (4, [4]), (8, [8]), (12, [12]), (16, [16])),
      [Equilibrium concentration $C_e$ (µmol L#super[-1])],
      [Uptake $q_e$ (µmol g#super[-1])],
    )
    series(
      (
        (0, 0.00), (1, 1.73), (2, 3.20), (3, 4.47), (4, 5.58), (5, 6.55),
        (6, 7.41), (8, 8.86), (10, 10.05), (12, 11.05), (14, 11.90),
        (16, 12.63), (18, 13.27), (20, 13.83), (23, 14.55), (26, 15.17),
      ),
      (0, 26), (0, 18), 7.4cm, 4.5cm, luma(50%), line-only: true,
    )
    series(
      ((1.8, 2.9), (4.1, 5.7), (7.6, 8.6), (12.4, 11.3), (17.9, 13.4), (23.2, 14.6)),
      (0, 26), (0, 18), 7.4cm, 4.5cm, accent, kind: "ring", size: 2.3pt,
    )
    errbars(
      ((1.8, 2.9, 0.2), (4.1, 5.7, 0.2), (7.6, 8.6, 0.3), (12.4, 11.3, 0.4), (17.9, 13.4, 0.4), (23.2, 14.6, 0.5)),
      (0, 26), (0, 18), 7.4cm, 4.5cm, accent,
    )
    series(
      ((0, 21.4), (26, 21.4)),
      (0, 26), (0, 18), 7.4cm, 4.5cm, accent-warm,
      line-only: true, dash: "dashed",
    )
    legend(3.5cm, 2.55cm, (
      (accent, [Measured uptake]),
      (luma(50%), [Langmuir fit]),
      (accent-warm, [$q_max = 21.4$]),
    ), width: 3.5cm)
  }),
  caption: [
    Dark adsorption isotherm of carbamazepine on NT-500. Error bars are one
    standard deviation of duplicate charges. The dashed line marks the fitted
    monolayer capacity, which the accessible range does not approach closely
    enough to determine it independently of the affinity constant.
  ],
) <fig:isotherm>

== Screening across catalysts

At the single charge of 20.0 µmol L#super[-1] that the kinetic sessions will
use, equilibrium uptake was 8.1, 10.3, 6.4 and 5.2 µmol g#super[-1] for NT-450,
NT-500, NT-550 and AR-1 respectively. Normalised by BET area these become
0.104, 0.112, 0.105 and 0.100 µmol m#super[-2], a spread of only 12 % against
the 77 % spread in the raw uptakes. Adsorption is therefore governed by
available surface and not by the doping, which is the expected result for a
neutral molecule on a surface near its point of zero charge, and it means the
doping can be assessed on photocatalytic grounds without an adsorption
confound.

== Observations

The 45 min dark period is not merely a convenience. In a trial where the lamp
was struck after only 10 min of stirring, the first two illuminated samples
showed an apparent removal rate roughly twice the eventual steady value, and
the excess is exactly the adsorption that had not yet finished. Any run that
skips the dark equilibration will report an inflated initial rate. The dark
period is now a checklist item with a recorded start and stop time.

Suspension homogeneity was checked by drawing simultaneous aliquots from the
top and bottom sampling ports at 400 rpm; catalyst concentrations agreed to
within 3 %. At 200 rpm the bottom port read 21 % higher and visible settling
occurred within two minutes of stopping the stirrer. The stirring speed is
fixed at 400 rpm for the campaign.

#note[Decision.][
  NT-500 is carried forward as the working catalyst. It has the largest surface
  area, the highest nitrogen incorporation and the narrowest optical gap of the
  series, and its adsorption behaviour is not anomalous. NT-450 is retained as
  a comparison point for a later session if time allows.
]

== Next

Session 3 is the first illuminated run with NT-500 at 1.00 g L#super[-1].
]
