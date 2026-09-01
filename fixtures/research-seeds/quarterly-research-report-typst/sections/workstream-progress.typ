#import "../lib/report.typ": *

= Workstream progress

== WS1: Observing network operations

=== The upper marsh retrofit

The dominant activity of the quarter was the retrofit of the five upper marsh nodes
with copper shutter assemblies over their optical backscatter windows. The intervention
was proposed after the first quarter review established that the upper marsh data loss
was not, as had been assumed, driven by mooring failure. Of the 1 224 upper marsh
bursts rejected in the first quarter, 71 percent failed the drift gate rather than the
completeness gate, meaning the instrument was on station and telemetering but returning
a signal that had walked outside its calibrated range. Fouling growth on the optical
window, not mooring loss, was the binding constraint @ferreira2025biofouling.

The retrofit was carried out between 14 and 22 April from a shallow draught workboat.
Each node was recovered, the sensor head exchanged for a shuttered unit, and the mooring
redeployed on the same clump weight within 30 metres of its original position. Recovery
of the original units allowed the fouling growth curve to be measured directly against
the post retrofit units in the same water. Median drift in the retrofitted nodes fell
from 1.9 to 0.6 milligrams per litre per week, which extends the interval between
calibration visits from roughly three weeks to nine and is the mechanism by which data
return improved.

@tab:moorings gives the deployment record for a representative subset of the network.
The scheduled burst count for a 91 day quarter is 13 104 at a ten minute interval and
8 736 at a fifteen minute interval; the upper marsh stations run at the longer interval
to conserve battery through the winter deployment.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto, auto, auto),
    align: (left, left, right, right, right, right, right),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Station*], [*Array*], [*Depth*], [*Burst*], [*Bursts*], [*Return*], [*Drift*],
      [], [], [m], [min], [n], [%], [mg L#super[-1] wk#super[-1]],
    ),
    table.hline(stroke: 0.5pt),
    [TM-01], [Estuary mouth], [8.4], [10], [12 606], [96.2], [0.4],
    [TM-04], [Estuary mouth], [6.1], [10], [11 650], [88.9], [0.7],
    [TM-08], [Mid-channel], [4.7], [10], [12 462], [95.1], [0.5],
    [TM-11], [Mid-channel], [3.9], [10], [12 763], [97.4], [0.3],
    [TM-15], [Upper marsh], [1.8], [15], [7 347], [84.1], [1.9],
    [TM-18], [Upper marsh], [1.2], [15], [7 880], [90.2], [0.6],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Deployment record for six representative stations over the quarter. Depth
  is referred to chart datum. Drift is the median weekly excursion of the optical
  backscatter zero against the post recovery calibration. Station TM-15 was not
  retrofitted until the second visit and carries the pre retrofit drift figure; TM-18
  carries the post retrofit figure, and the difference between the two rows is the
  effect being reported.],
) <tab:moorings>

=== Vessel campaign and matchup collection

The April campaign ran for six days across two spring and two neap tides and collected
214 water samples with concurrent optical profiles, of which all 214 passed the
laboratory gravimetric check and entered the matchup set used by WS3. Two stations were
occupied outside the planned grid to capture a turbidity maximum that had migrated
approximately 1.4 kilometres upstream of its climatological position. That excursion is
now the subject of an unplanned but low cost analysis reported in Section 8.

The June campaign, which would have provided the cross-calibration between the moored
and shipborne optical sensors, did not sail. The research vessel was withdrawn for
unplanned hull survey on 2 June and was unavailable for the remainder of the window.
This is milestone M2.4 and its slip is discussed in Section 4.

=== Mooring survivability

No moorings were lost in the quarter. This is the first quarter in the programme's
history with no loss, and it is a weak result rather than a strong one: the quarter
contained no event exceeding a significant wave height of 1.8 metres at the mouth
station, well below the 3.1 metre condition that parted three moorings in December
2025. The survivability question is therefore untested rather than resolved, and the
design margin recommended by @brennan2021moorings has not yet been exercised in the
Hollowmere. The programme should not report improved mooring reliability until it has
observed a comparable storm.

== WS2: Sediment flux modelling

=== Transition to sequential assimilation

The HOLT-2 transport model moved from a free running configuration to sequential
assimilation of moored turbidity during the quarter. At each analysis time the model
concentration field is updated by

$ bold(c)^a = bold(c)^f + bold(K) (bold(y) - bold(H) bold(c)^f) $ <eq:analysis>

where $bold(c)^f$ is the forecast concentration vector, $bold(y)$ the vector of
accepted moored observations, $bold(H)$ the observation operator that maps the model
grid onto the mooring positions, and the gain is

$ bold(K) = bold(P) bold(H)^T (bold(H) bold(P) bold(H)^T + bold(R))^(-1) $ <eq:gain>

with $bold(P)$ the forecast error covariance and $bold(R)$ the observation error
covariance. $bold(R)$ is diagonal and is populated from the per instrument uncertainty
budget of @whitfield2023uncertainty rather than being tuned, which was a deliberate
choice: it makes the assimilation result falsifiable against an independent
uncertainty estimate instead of absorbing model error into an observation weight.

=== Skill assessment

@tab:modelskill reports hindcast skill at the two validation moorings, TM-04 and TM-15,
which are withheld from the assimilation and used only for evaluation. The headline
result is a reduction in root mean square error from 18.4 to 11.7 milligrams per litre
between the free running and the one hour assimilating configuration, together with the
near elimination of the positive bias that has characterised the model since
commissioning @adeleye2024assimilation.

#figure(
  table(
    columns: (1fr, auto, auto, auto, auto),
    align: (left, right, right, right, right),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Model configuration*], [*RMSE*], [*Bias*], [*Willmott $d$*], [*$r$*],
      [], [mg L#super[-1]], [mg L#super[-1]], [], [],
    ),
    table.hline(stroke: 0.5pt),
    [Free running, no assimilation], [18.4], [$+$3.1], [0.71], [0.68],
    [Assimilating, 6 hour window], [13.2], [$+$1.2], [0.84], [0.81],
    [Assimilating, 1 hour window], [*11.7*], [$-$0.4], [*0.89*], [*0.87*],
    [Assimilating, 1 hour, revised settling], [11.9], [$-$0.6], [0.88], [0.86],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Hindcast skill at the withheld validation moorings TM-04 and TM-15 over the
  quarter. The revised settling closure of @moreau2023settling improves the free running
  model but degrades the assimilating model slightly, which is the basis of the effort
  reallocation recommended below.],
) <tab:modelskill>

The final row of @tab:modelskill is the one that should change the programme's plan.
The flocculation dependent settling closure of @moreau2023settling was expected to be
the principal quality lever for the year and roughly 0.6 full time equivalents were
allocated to implementing and tuning it. Applied to the free running model it reduces
error materially. Applied on top of assimilation it does not: RMSE moves from 11.7 to
11.9 milligrams per litre, which is inside the run to run spread and is therefore no
change. The interpretation is straightforward. Assimilation is already correcting the
error that the settling closure addresses, and the two are substitutes rather than
complements over the observed concentration range.

The recommendation to the Oversight Board is to stop further tuning of the settling
closure and to move the associated effort to development of the observation operator
$bold(H)$, which currently performs a nearest neighbour lookup and takes no account of
the vertical structure between the mooring depth and the model layer midpoint. That
approximation is the largest identified unquantified error in the assimilation chain.

== WS3: Remote sensing retrieval

=== Recalibration

The suspended sediment retrieval uses a band ratio of red to green surface reflectance,

$ hat(C) = a (R_"red" / R_"green")^b $ <eq:bandratio>

recalibrated this quarter against the 214 matchups collected in April. Least squares
fitting in log space returned $a = 41.7$ and $b = 2.34$, against the previous
coefficients of $a = 38.2$ and $b = 2.51$. Performance is summarised by

$ "RMSE" = sqrt(1/n sum_(k=1)^n (hat(C)_k - C_k)^2), quad "bias" = 1/n sum_(k=1)^n (hat(C)_k - C_k) $ <eq:errmetrics>

evaluated over the matchup set. @fig:matchup shows retrieved against measured
concentration and @tab:retrieval decomposes performance by concentration band.

#figure(
  {
    scatter-chart(
      width: 8.6cm,
      height: 6.4cm,
      x-min: 0.0, x-max: 130.0, y-min: 0.0, y-max: 130.0,
      x-ticks: ((0, "0"), (30, "30"), (60, "60"), (90, "90"), (120, "120")),
      y-ticks: ((0, "0"), (30, "30"), (60, "60"), (90, "90"), (120, "120")),
      points: (
        (7.0, 9.0), (11.0, 8.0), (14.0, 17.0), (18.0, 15.0), (21.0, 24.0),
        (24.0, 21.0), (27.0, 31.0), (31.0, 28.0), (34.0, 37.0), (38.0, 34.0),
        (41.0, 45.0), (44.0, 41.0), (48.0, 52.0), (51.0, 47.0), (55.0, 58.0),
        (58.0, 54.0), (62.0, 66.0), (66.0, 61.0), (69.0, 73.0), (73.0, 67.0),
        (77.0, 81.0), (81.0, 74.0), (85.0, 88.0), (88.0, 79.0), (92.0, 81.0),
        (97.0, 84.0), (101.0, 86.0), (106.0, 88.0), (112.0, 91.0), (119.0, 94.0),
      ),
      colour: ink.navy,
    )
    v(0.15cm)
    align(center, chart-legend((
      ([Matchup pairs, n = 214], ink.navy),
      ([One to one line], ink.slate),
    )))
  },
  caption: [Retrieved against gravimetric suspended sediment concentration in
  milligrams per litre for the April matchup set. Agreement is close below 90
  milligrams per litre. Above that threshold the red to green ratio saturates and the
  retrieval underestimates systematically, which is the behaviour predicted by
  @ossei2025bandratio.],
) <fig:matchup>

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, right, right, right, right),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Concentration band*], [*n*], [*RMSE*], [*Bias*], [*$R^2$*],
      [mg L#super[-1]], [], [mg L#super[-1]], [mg L#super[-1]], [],
    ),
    table.hline(stroke: 0.5pt),
    [0 to 30], [78], [5.9], [$-$0.8], [0.88],
    [30 to 60], [71], [8.4], [$-$1.1], [0.90],
    [60 to 90], [44], [11.6], [$-$2.0], [0.85],
    [Above 90], [21], [24.3], [$-$9.7], [0.41],
    table.hline(stroke: 0.5pt),
    [*All matchups*], [*214*], [*9.8*], [*$-$1.4*], [*0.91*],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Retrieval performance by concentration band. The aggregate figure meets the
  12 milligram per litre acceptance threshold, but the aggregate conceals a failure
  above 90 milligrams per litre that bounds operational use of the product.],
) <tab:retrieval>

=== Operational bound

The programme's position is that the satellite product may be substituted for in situ
measurement below 90 milligrams per litre and may not be substituted above it. This is
a stronger statement than the aggregate error in @tab:retrieval would support and it is
made deliberately. The high concentration cases are exactly the storm and spring tide
conditions that dominate the annual budget, so an aggregate accuracy figure that is
carried by 149 low concentration matchups is misleading for the application the
programme cares about. WS3 will trial a switched retrieval using a near infrared band
in the third quarter @kanemura2025retrieval.

== WS4: Data infrastructure

=== Archive release

Version two of the TMOP archive was published on 19 May 2026 carrying 11 datasets and
1.42 terabytes, each with a persistent identifier resolving to a versioned landing
page. The release closed milestone M4.2. In the six weeks to the end of the quarter the
archive recorded 31 distinct institutional downloaders and 486 dataset retrievals,
against a first year target of 20 institutions.

The quality control gate applied at ingest is declarative and versioned alongside the
data, so a record can always be re-evaluated against the ruleset in force when it was
accepted. @lst:qc gives the upper marsh ruleset in force at the end of the quarter.

#figure(
  kind: "listing",
  supplement: [Listing],
  caption: [Level one quality control ruleset for the upper marsh array. Thresholds are
  array specific; the drift gate was relaxed from 1.5 to 2.5 milligrams per litre per
  week after the retrofit because the shuttered units exhibit a step at servicing rather
  than a ramp.],
  ```yaml
  ruleset: tmop.l1.upper-marsh
  version: 4
  effective: 2026-04-23
  gates:
    - id: completeness
      requires: samples_in_burst >= 54
      on_fail: reject
    - id: range
      requires: 0.0 <= turbidity_ntu <= 4000.0
      on_fail: reject
    - id: drift
      requires: abs(zero_offset_delta_per_week) <= 2.5
      units: mg/L/week
      on_fail: flag
    - id: spike
      requires: abs(value - median_5) <= 6.0 * mad_5
      on_fail: flag
    - id: pressure_consistency
      requires: abs(depth_m - nominal_depth_m) <= 0.35
      on_fail: flag
  promotion:
    to_level_2: all_reject_gates_passed and flag_count <= 1
  ```
) <lst:qc>

=== Gap filling

Records that fail the completeness gate leave gaps that must be filled before the
series can be assimilated. The programme uses the variance preserving interpolation of
@takahashi2024gapfilling rather than linear interpolation, because linear filling of a
tidally modulated series suppresses variance at exactly the frequency the flux
decomposition in @eq:decomp depends on. Filled values are written to the archive with a
provenance flag and are never silently substituted. @lst:ingest shows the operator
command that produces a level two series from an accession.

#figure(
  kind: "listing",
  supplement: [Listing],
  caption: [Archive command that promotes a level one accession to a level two series.
  The ruleset version is recorded in the output metadata so the promotion is
  reproducible after the ruleset changes.],
  ```
  tmop-archive promote TMOP-2026Q2-UM-0114 \
      --from-level 1 --to-level 2 \
      --ruleset tmop.l1.upper-marsh@4 \
      --gap-fill variance-preserving --max-gap 90min \
      --provenance-flag filled \
      --emit-identifier
  ```
) <lst:ingest>

== WS5: Management translation

The Estuary Partnership workshop was held on 11 June 2026 with 34 attendees from 12
organisations, including all four statutory consultees. The workshop reviewed the draft
guidance note on the use of observatory data in dredge consent conditions. The
substantive outcome was a request that the guidance distinguish between the moored
product and the satellite product, which the Partnership had until then treated as
interchangeable. The bound established in Section 3.3 has been written into the draft
accordingly and the revised note will be issued for consultation in the third quarter
@oyelaran2025stakeholder.

Programme effort in WS5 ran below plan at 2.4 against 3.0 full time equivalent months,
because the second engagement event was deferred to align with the guidance
consultation. No deliverable is at risk.
