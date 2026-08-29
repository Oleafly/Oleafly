#import "../notebook.typ": *

= Radical scavenger assignment and matrix interference

#entry(
  date: "2026-04-15",
  session: "NB7-S07",
  operator: "M. Ostrowska-Rehn",
  instrument: [PR-2, LAMP-1, RAD-1, SPEC-1, HPLC-2, TOC-1],
  conditions: "23.4 °C, 40 % RH, 1009 hPa",
  sample: [NT-500 batch NT500-B3, runs PR2-023 to PR2-031],
)[

== Purpose

Two related sets of runs. The scavenger series asks which reactive species
carries the degradation, by adding a reagent that selectively consumes one of
them and measuring how much of the rate survives. The matrix series asks what
happens when the ultrapure water is replaced by something closer to a real
one. Both sets are single runs per condition, so the conclusions are
directional rather than quantitative, and the scavenger set in particular has
interpretive traps that are addressed below.

== Scavenger series

All runs at the reference condition, 1.00 g L#super[-1] NT-500,
20.0 µmol L#super[-1] carbamazepine, pH 6.8, with the scavenger present from
the start of the dark equilibration so that any adsorption competition is
already at equilibrium when the lamp is struck.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, center, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Scavenger],
      [Concentration\ (mmol L#super[-1])],
      [Nominal target],
      [$k_"app"$\ (10#super[-3] min#super[-1])],
      [Inhibition\ (%)],
    ),
    table.hline(stroke: 0.5pt),
    [None, control], [#sym.dash.en], [#sym.dash.en], [#pm[11.31][0.14]], [0.0],
    [tert-Butanol], [10.0], [Hydroxyl radical], [#pm[3.64][0.16]], [67.8],
    [p-Benzoquinone], [1.0], [Superoxide], [#pm[7.28][0.19]], [35.6],
    [Disodium EDTA], [10.0], [Valence band hole], [#pm[5.21][0.17]], [53.9],
    [Potassium iodide], [10.0], [Surface hole and adsorbed hydroxyl], [#pm[2.87][0.22]], [74.6],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Scavenger series at the reference condition. Inhibition is computed against
    the control constant measured on the same day. Note that the inhibitions
    sum to 157 %, which is discussed below.
  ],
) <tab:scav>

#figure(
  chart(9.2cm, 5.0cm, {
    axes(
      9.2cm, 5.0cm, (0, 11), (0, 17),
      (
        (1, [Control]), (2, [TBA]), (3, [BQ]), (4, [EDTA]), (5, [KI]),
        (6.5, [Pure]), (7.5, [HCO#sub[3]]), (8.5, [Cl]), (9.5, [NOM]),
      ),
      ((0, [0]), (4, [4]), (8, [8]), (12, [12]), (16, [16])),
      [Scavenger series (left) and matrix series (right)],
      [$k_"app"$ (10#super[-3] min#super[-1])],
      xtick-width: 0.80cm,
    )
    bars(
      ((1, 11.31, 0.14), (2, 3.64, 0.16), (3, 7.28, 0.19), (4, 5.21, 0.17), (5, 2.87, 0.22)),
      (0, 11), (0, 17), 9.2cm, 5.0cm, accent, bar-width: 0.52cm,
    )
    bars(
      ((6.5, 11.31, 0.14), (7.5, 6.93, 0.18), (8.5, 10.44, 0.20), (9.5, 5.81, 0.19)),
      (0, 11), (0, 17), 9.2cm, 5.0cm, accent-green, bar-width: 0.52cm,
    )
    place(dx: xmap(5.75, (0, 11), 9.2cm), dy: 0pt, line(
      angle: 90deg, length: 5.0cm, stroke: (paint: luma(60%), thickness: 0.6pt, dash: "dotted"),
    ))
    series(
      ((0, 11.31), (11, 11.31)),
      (0, 11), (0, 17), 9.2cm, 5.0cm, accent-warm, line-only: true, dash: "dashed",
    )
    legend(0.30cm, 0.14cm, (
      (accent, [Selective scavengers]),
      (accent-green, [Matrix additions]),
      (accent-warm, [Uninhibited control]),
    ), width: 3.5cm)
  }),
  caption: [
    Apparent rate constants for the scavenger and matrix series against the
    common control. Bars are drawn from a single run per condition and the
    error bars are regression standard errors, so they understate the true
    run to run uncertainty established in session 8.
  ],
) <fig:scav>

== What the scavenger series does and does not show

The ordering is clear enough. Removing hydroxyl radicals costs about two thirds
of the rate, removing holes costs about half, and removing superoxide costs
about a third. Taken naively that says hydroxyl radical is the dominant
oxidant, with a substantial direct hole contribution and a minor superoxide
contribution.

The naive reading is not safe, and the arithmetic in @tab:scav says so plainly:
the inhibitions sum to 157 %. A set of genuinely orthogonal scavengers acting
on genuinely parallel pathways would sum to 100 %. Three things break the
assumption, and all three are documented problems with this class of experiment
@valdivieso2021scavenger.

The pathways are not parallel but sequential. Surface hydroxyl radical is
produced by hole oxidation of adsorbed water, so a hole scavenger suppresses
hydroxyl radical production as well as direct hole transfer, and its inhibition
double counts. The same logic makes potassium iodide the largest inhibitor in
the set, since it consumes both the hole and the adsorbed hydroxyl radical, and
its 74.6 % is therefore closer to an upper bound on the total oxidative
pathway than to a measurement of one species.

The scavengers are not inert. p-Benzoquinone absorbs in the visible: a
1.0 mmol L#super[-1] solution measured on SPEC-1 transmits 89 % at 450 nm over
the 1 cm path, so it removes roughly 11 % of the photons before they reach the
catalyst. Correcting the benzoquinone run for that inner filter effect on the
assumption of a linear photon flux dependence brings its constant from 7.28 to
about 8.1, and the inhibition from 35.6 % to roughly 28 %. Disodium EDTA
chelates surface titanium and alters the surface itself rather than merely
consuming holes in solution.

The scavengers compete for adsorption sites. tert-Butanol at
10 mmol L#super[-1] is present at five hundred times the substrate
concentration, and although it adsorbs weakly, at that ratio even weak
adsorption displaces a measurable fraction of the carbamazepine.

The defensible conclusion is therefore qualitative. Oxidation dominates over
reduction, the hydroxyl radical pathway is the largest single contributor, and
superoxide plays a real but secondary role. Any percentage split beyond that is
not supported by this experiment.

== Matrix series

The matrix runs replace ultrapure water with a defined addition or, in the
final case, with a real secondary effluent collected on 2026-04-14 from the
Vasterhamn municipal works and filtered at 0.45 µm. Its dissolved organic
carbon was 6.2 mg L#super[-1], alkalinity 3.1 mmol L#super[-1] as bicarbonate,
chloride 78 mg L#super[-1], and pH 7.4.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: (left, center, center, center),
    table.hline(stroke: 0.8pt),
    head-row(
      [Matrix],
      [Addition],
      [$k_"app"$\ (10#super[-3] min#super[-1])],
      [Inhibition\ (%)],
    ),
    table.hline(stroke: 0.5pt),
    [Ultrapure water], [#sym.dash.en], [#pm[11.31][0.14]], [0.0],
    [Bicarbonate], [2.0 mmol L#super[-1]], [#pm[6.93][0.18]], [38.7],
    [Chloride], [5.0 mmol L#super[-1]], [#pm[10.44][0.20]], [7.7],
    [Humic acid], [5.0 mg L#super[-1]], [#pm[5.81][0.19]], [48.6],
    [Secondary effluent], [as collected], [#pm[4.12][0.26]], [63.6],
    table.hline(stroke: 0.8pt),
  ),
  caption: [
    Matrix interference at the reference condition. The effluent run is the
    only one whose inhibition cannot be attributed to a single named species.
  ],
) <tab:matrix>

Bicarbonate costs 38.7 % of the rate. It reacts with hydroxyl radical to give
the carbonate radical, which is a far more selective oxidant with a
substantially lower rate constant toward carbamazepine, so the effect is a
conversion of a fast general oxidant into a slow selective one rather than a
simple removal @lindqvist2016bicarbonate. Chloride at 5 mmol L#super[-1] costs
only 7.7 %, which is within twice the run to run uncertainty and should be
treated as a small effect rather than a firm one.

Humic acid at 5 mg L#super[-1] costs 48.6 %, and it acts by at least three
mechanisms at once: it absorbs visible light in competition with the catalyst,
it scavenges hydroxyl radical, and it adsorbs onto the titania surface and
blocks sites @mbeki2022humic. The relative weight of the three was not
separated here. A transmission measurement gave 7 % attenuation at 450 nm over
the reactor path, which accounts for only a small part of the loss, so surface
blocking and radical scavenging carry most of it.

The real effluent costs 63.6 %, which is less than the sum of its bicarbonate
and organic carbon components taken from the single-addition runs, again
because the interferences are not independent. The rate that survives,
$4.12 times 10^(-3)$ min#super[-1], still corresponds to a half-life of 168 min
under this photon flux, so the process works in a real water but the reactor
would have to be roughly three times larger for the same duty.

== Observations

The potassium iodide run discoloured visibly over the first 30 min, going pale
yellow, which is triiodide formation and confirms that the iodide is being
oxidised as intended. It also means the solution absorbance at 285 nm acquired
a contribution that is not carbamazepine, so that run alone was quantified by
chromatography rather than by absorbance. Had it been read on the
spectrophotometer the apparent rate would have been substantially understated.

The humic acid stock required its own blank correction at 285 nm, and the
correction is not a constant: the humic absorbance itself declines during the
run as the material is oxidised. The blank was therefore measured on a
parallel catalyst-free irradiated humic solution sampled at the same times.
This is recorded because the naive single blank subtraction would have made the
carbamazepine removal look about 8 % larger than it is.

#note[Assignment.][
  Oxidative pathways dominate, with the hydroxyl radical the principal carrier
  and superoxide secondary. The scavenger percentages are not additive and are
  not to be quoted as a mechanistic split. Bicarbonate and natural organic
  matter are the interferences that matter in a real water.
]

== Next

Session 8 closes the campaign with the mineralisation question, the
transformation product survey, and the uncertainty budget that the single-run
comparisons above have been leaning on.
]
