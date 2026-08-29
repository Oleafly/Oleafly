#import "../lib/report.typ": *

= Risk register

== Scoring

The programme scores risk as the product of a likelihood and an impact rating, each
drawn from the three point scale low equals 2, medium equals 3, high equals 4,

$ S = L times I $ <eq:riskscore>

giving a score between 4 and 16. A score of 12 or above is escalated to the Oversight
Board and requires a named mitigation with a decision date. Five of the seven open
risks currently sit at or above that threshold, which is two more than at the end of
the first quarter. Both additions, R4 and R7, arise from the same finding: the
characterisation of the retrieval saturation limit converted a suspected weakness into
a measured one, and a measured weakness that the Estuary Partnership is not yet aware
of carries a higher impact than a suspected one.

#figure(
  table(
    columns: (auto, 1fr, auto, auto, auto, auto),
    align: (left, left, center, center, center, left),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Ref*], [*Risk*], [*L*], [*I*], [*S*], [*Owner*],
    ),
    table.hline(stroke: 0.5pt),
    [R1], [Vessel unavailability recurs and the September cross-calibration campaign is
    also lost, moving the uncertainty budget merge into the next programme year.],
    [3], [4], [*12*], [Ferreira-Baptista],
    [R2], [Winter storm sequence parts upper marsh moorings before the retrofit has been
    exercised under load.], [4], [3], [*12*], [Ferreira-Baptista],
    [R3], [Biofouling recurs inside the extended nine week service interval and drift
    returns undetected.], [2], [3], [6], [Ferreira-Baptista],
    [R4], [Retrieval remains unusable above 90 mg per litre, restricting the satellite
    product to conditions that carry little of the annual sediment budget.],
    [3], [4], [*12*], [Kanemura],
    [R5], [Archive growth outruns the computing allocation before the tiered retention
    policy takes effect.], [3], [2], [6], [Vasilenko],
    [R6], [Key person dependency on the assimilation subsystem, currently maintained by
    one developer.], [3], [4], [*12*], [Adeleye],
    [R7], [Estuary Partnership applies the satellite product outside its validated
    range in a consent decision.], [3], [4], [*12*], [Oyelaran],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Open risk register at 30 June 2026. L is likelihood and I is impact, each
  on the scale low equals 2, medium equals 3, high equals 4. Scores of 12 and above are
  shown in bold and are escalated to the Oversight Board.],
) <tab:risks>

== Mitigations for escalated risks

R1 is mitigated by the contingency platform described in Section 4.2. The Partnership
survey launch can carry a reduced profiling package that delivers the sensor transfer
function at lower precision, sufficient to close the merge but with a wider uncertainty
band. The decision to hold or release the contingency falls to the reporting officer on
21 August. The residual risk after mitigation is a wider uncertainty budget rather than
a missed deliverable, and the programme accepts that outcome.

R2 is the risk the programme understands least well, because the retrofitted moorings
have not yet seen a significant storm. The mitigation is a revised clump weight
specification for the winter laying, increasing holding mass by 40 percent at the three
stations that parted in December 2025, together with a staged recovery protocol that
lifts the two most exposed upper marsh nodes when the forecast significant wave height
exceeds 2.5 metres. Staged recovery costs data return, and the programme has accepted
that trade explicitly: it is better to lose a fortnight of record than a node.

R4 is mitigated by the switched retrieval trial, milestone M3.2, due 30 September. If
the near infrared switch does not recover accuracy above 90 milligrams per litre, the
programme will not attempt a third algorithm within this award. It will instead
document the bound and rely on the moored network for the high concentration regime,
which is the outcome the observing system was designed to make possible
@solvang2024observatory.

R6 was raised this quarter following the assimilation acceptance. A single developer
holds working knowledge of the assimilation subsystem, and the code has no second
reader. A second developer joined the workstream on 15 June and a review gate now
applies to every change touching the analysis update in @eq:analysis. The risk will be
downgraded when the second developer has independently reproduced a full hindcast,
expected in the third quarter.

R7 is mitigated by the guidance note revision described in Section 3.5. The programme
regards this risk as the most consequential on the register despite its score, because
its failure mode is external and irreversible: a consent granted on a mis-specified
sediment figure is not corrected by a later erratum. The revised note makes the
validated range a condition of use rather than a caveat in an annex.

== Closed risks

One risk closed during the quarter. R0, that the upper marsh array would not reach an
acceptable data return before the winter deployment, is closed on the evidence in
@fig:datareturn. The array reached 89 percent in the quarter against a threshold of 85
percent and the mechanism is understood rather than merely observed, which is the
programme's standing test for closing a risk rather than downgrading it.
