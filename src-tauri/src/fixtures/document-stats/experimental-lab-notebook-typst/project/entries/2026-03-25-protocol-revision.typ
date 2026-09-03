#import "../notebook.typ": *

= Protocol revision and chemical actinometry

#entry(
  date: "2026-03-25",
  session: "NB7-S04",
  operator: "M. Ostrowska-Rehn, R. Balasingam",
  instrument: [PR-2, LAMP-1 new, RAD-1, SPEC-1],
  conditions: "22.6 °C, 43 % RH, 1010 hPa",
  sample: [Potassium ferrioxalate, 6.0 mmol L#super[-1]],
)[

== Purpose

Session 3 showed that the quantity governing the rate was not being measured.
The response is to stop treating the light source as a fixed property of the
apparatus and start measuring the photon supply itself. This session
establishes the photon flux entering the reaction volume by chemical
actinometry, which is a measurement of what the chemistry actually receives
rather than of what a broadband detector reports at one point on the wall, and
it rewrites the run protocol around that measurement.

== Why actinometry rather than radiometry

The radiometer gives an irradiance in W m#super[-2] over a 400 to 700 nm
window at a single position. Three things stand between that number and the
rate of photon absorption in the suspension. The spectral response of the head
is not the absorption spectrum of the catalyst, so the same reading can
correspond to different absorbed rates if the lamp spectrum shifts, and an
ageing xenon arc does shift. The probe sees the wall, not the annulus, and the
suspension itself attenuates. And the reflective housing returns a fraction of
the transmitted light that the probe never sees. Chemical actinometry
integrates over the whole volume and the whole spectrum weighted by what a
solution phase absorber actually takes up, which is much closer to the
quantity of interest @brandt2017actinometry.

== Ferrioxalate procedure

The reactor was charged with 250 mL of 6.0 mmol L#super[-1] potassium
ferrioxalate in 0.05 mol L#super[-1] sulfuric acid, prepared and handled under
red safelight. The lamp was struck after a 20 min warm-up with the shutter
closed. Aliquots of 2.0 mL were withdrawn at 30 s intervals, mixed immediately
with 2.0 mL of 0.1 % 1,10-phenanthroline in acetate buffer, held 30 min in the
dark for full colour development, and read at 510 nm against a dark control
carried through the same steps. The iron(II) produced was computed from a
molar absorptivity of 11 100 L mol#super[-1] cm#super[-1] for the
tris-phenanthroline complex.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: (center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Irradiation time\ (s)],
      [Absorbance\ at 510 nm],
      [Iron(II) formed\ (µmol)],
      [Dark control\ (µmol)],
    ),
    table.hline(stroke: 0.5pt),
    [0], [0.0000], [#pm[0.00][0.02]], [0.00],
    [30], [0.4310], [#pm[1.94][0.04]], [0.01],
    [60], [0.8686], [#pm[3.91][0.05]], [0.01],
    [90], [1.2953], [#pm[5.83][0.07]], [0.02],
    [120], [1.7286], [#pm[7.78][0.09]], [0.02],
    [150], [2.1463], [#pm[9.66][0.11]], [0.03],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Ferrioxalate actinometry in PR-2 with the new lamp and the cleaned sleeve.
    Absorbances above 1.2 were read on tenfold dilutions and are reported here
    rescaled to the undiluted basis. The dark control confirms that thermal
    reduction is negligible over the working period.
  ],
) <tab:actin>

== Photon flux

Iron(II) accumulates linearly with irradiation time as long as conversion stays
below about 10 %, which it does here at a maximum of 6.4 %. Least squares
regression of @tab:actin gives a formation rate of
$6.44 times 10^(-2)$ µmol s#super[-1] with a coefficient of determination of
0.99992 and an intercept indistinguishable from zero. The incident photon flux
follows from

$ q_p = (dif n("Fe"^(2+)) \/ dif t) / Phi_("Fe") $ <eq:flux>

where $Phi_("Fe") = 1.11$ is the quantum yield of iron(II) formation for
ferrioxalate in the blue region. This gives

$ q_p = (6.44 times 10^(-8) " mol s"^(-1)) / 1.11 = 5.80 times 10^(-8) " einstein s"^(-1) $ <eq:fluxval>

@fig:actin plots the accumulation with the fitted line.

#figure(
  chart(7.6cm, 4.4cm, {
    axes(
      7.6cm, 4.4cm, (0, 160), (0, 11),
      ((0, [0]), (30, [30]), (60, [60]), (90, [90]), (120, [120]), (150, [150])),
      ((0, [0]), (2, [2]), (4, [4]), (6, [6]), (8, [8]), (10, [10])),
      [Irradiation time (s)],
      [Iron(II) formed (µmol)],
    )
    series(
      ((0, 0.0), (150, 9.66)),
      (0, 160), (0, 11), 7.6cm, 4.4cm, luma(50%),
      line-only: true, dash: "dashed",
    )
    series(
      ((0, 0.00), (30, 1.94), (60, 3.91), (90, 5.83), (120, 7.78), (150, 9.66)),
      (0, 160), (0, 11), 7.6cm, 4.4cm, accent, kind: "ring", size: 2.3pt,
    )
    errbars(
      ((30, 1.94, 0.04), (60, 3.91, 0.05), (90, 5.83, 0.07), (120, 7.78, 0.09), (150, 9.66, 0.11)),
      (0, 160), (0, 11), 7.6cm, 4.4cm, accent,
    )
    series(
      ((0, 0.00), (30, 0.01), (60, 0.01), (90, 0.02), (120, 0.02), (150, 0.03)),
      (0, 160), (0, 11), 7.6cm, 4.4cm, accent-warm, kind: "square", size: 1.8pt,
    )
    legend(0.35cm, 0.2cm, (
      (accent, [Illuminated actinometer]),
      (luma(50%), [Linear fit, 0.0644 µmol s#super[-1]]),
      (accent-warm, [Dark control]),
    ), width: 4.6cm)
  }),
  caption: [
    Ferrioxalate accumulation under the revised configuration. Linearity across
    the whole window confirms that the actinometer is not depleting and that
    inner filtering by the product complex has not yet begun.
  ],
) <fig:actin>

Combining @eq:fluxval with the reaction volume gives a volumetric photon
delivery of $2.32 times 10^(-7)$ einstein L#super[-1] s#super[-1]. This is the
number that future rate constants are to be normalised against, and it must be
remeasured whenever the lamp or the sleeve is changed.

== Revised run protocol

The protocol below replaces the NB-6 version. The substantive changes are the
mandatory pre-run irradiance check against a recorded acceptance band, the
sleeve inspection, the lamp hour ceiling, and the requirement that the dark
equilibration concentration and not the nominal charge is used as the initial
concentration.

```text
PROTOCOL  PR2-CBZ-02        supersedes PR2-CBZ-01 (NB-6)
                            revised 2026-03-25, MOR / RB

PRE-RUN
  1. Read lamp hour meter. If > 700 h, flag; if > 800 h, stop and replace.
  2. Remove sleeve, inspect dry against a white card for film or etching.
     Clean if any deposit is visible: 10 % HNO3, 15 min, ultrapure rinse.
  3. Test enclosure interlock. Record pass/fail in the entry.
  4. Warm lamp 20 min with the shutter closed.
  5. Measure wall irradiance at the fixed probe position.
     ACCEPT 42.0 to 46.0 W/m2.  Outside band: stop, diagnose, do not run.

CHARGE
  6. 250 mL CBZ at 20.0 umol/L, 2.0 % methanol, ultrapure water.
  7. Add catalyst, record mass to 0.1 mg.  Stir 400 rpm, 25.0 C.
  8. Dark equilibration 45 min.  Sample at 45 min -> this is C0.

RUN
  9. Open shutter, start clock.
 10. Sample 3 mL at 15, 30, 45, 60, 90, 120, 150, 180 min.
     Filter 0.22 um PTFE immediately.  Read A285 within 10 min.
 11. Re-measure wall irradiance at 90 min and at end of run.
     Drift > 3 % over the run invalidates the run.

POST-RUN
 12. Retain the 60 and 180 min filtrates for HPLC confirmation.
 13. Filter suspension, recover solids to inorganic solid waste.
 14. Record lamp hours at end of run.
```

== Verification run

A short verification run, PR2-012, was performed at 1.00 g L#super[-1] NT-500
for 60 min under the revised protocol. Removal at 60 min was 48.7 %, against
2.5 % at the same point in the void run PR2-011. Wall irradiance was
44.1 W m#super[-2] at the start and 43.6 W m#super[-2] at the end, a drift of
1.1 % and inside the acceptance band. The apparatus is working.

== Observations

Two practical notes. The ferrioxalate solution must be made fresh; a batch held
overnight under safelight gave a dark control of 0.38 µmol at 150 s, which is
more than ten times today's value and would have introduced a 4 % systematic
error into the flux. And the phenanthroline colour development is genuinely
slow, so the 30 min hold is not padding: a batch read after 10 min gave
absorbances 7 % low and would have understated the photon flux by the same
fraction.

#note[Protocol status.][
  PR2-CBZ-02 is in force from this session. Any run not conforming to it is to
  be recorded as void, as PR2-011 was.
]

== Next

Session 5 is the substantive experiment, a four-point catalyst loading series
under the revised protocol.
]
