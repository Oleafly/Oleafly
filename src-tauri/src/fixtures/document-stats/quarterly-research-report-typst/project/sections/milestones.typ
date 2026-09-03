#import "../lib/report.typ": *

= Milestones and schedule

== Milestone position

Twelve milestones fall within programme year two. At 30 June 2026 nine were complete
against a profiled ten, one had slipped, and two were in progress and on track.
@tab:milestones gives the register. The schedule performance indicator used in the
award conditions @ncrc2024conditions is the ratio of milestones complete to milestones
profiled complete at the reporting date,

$ "SPI" = M_c / M_p = 9 / 10 = 0.90 $ <eq:spi>

which sits inside the 0.85 to 1.10 tolerance band and therefore does not trigger a
formal recovery plan. The programme has nevertheless prepared one, on the grounds that
the tolerance band is calibrated for a twelve month view and the slipped milestone sits
immediately before a seasonally constrained deployment window.

#figure(
  table(
    columns: (auto, 1fr, auto, auto, auto),
    align: (left, left, center, center, left),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Ref*], [*Milestone*], [*WS*], [*Due*], [*Status*],
    ),
    table.hline(stroke: 0.5pt),
    [M1.1], [Observing network commissioned to 20 stations], [1], [31 Dec 25],
    [#status-mark("complete", "Complete")],
    [M1.2], [Winter deployment recovered and serviced], [1], [31 Mar 26],
    [#status-mark("complete", "Complete")],
    [M2.1], [Upper marsh antifouling retrofit delivered], [1], [30 Apr 26],
    [#status-mark("complete", "Complete")],
    [M2.2], [Spring matchup campaign, 200 samples minimum], [1], [31 May 26],
    [#status-mark("complete", "Complete")],
    [M2.3], [Assimilating model configuration accepted], [2], [30 Jun 26],
    [#status-mark("complete", "Complete")],
    [M2.4], [Moored to shipborne optical cross-calibration], [1], [30 Jun 26],
    [#status-mark("slipped", "Slipped")],
    [M3.1], [Retrieval recalibrated on year two matchups], [3], [30 Jun 26],
    [#status-mark("complete", "Complete")],
    [M3.2], [Switched high concentration retrieval trialled], [3], [30 Sep 26],
    [#status-mark("active", "In progress")],
    [M4.1], [Archive version one published], [4], [31 Jan 26],
    [#status-mark("complete", "Complete")],
    [M4.2], [Archive version two under persistent identifiers], [4], [31 May 26],
    [#status-mark("complete", "Complete")],
    [M4.3], [Public access portal released], [4], [31 Oct 26],
    [#status-mark("active", "In progress")],
    [M5.1], [Dredge consent guidance note drafted], [5], [30 Jun 26],
    [#status-mark("complete", "Complete")],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Milestone register for programme year two at 30 June 2026. Milestone M2.4
  has been rebooked for 8 to 19 September 2026 with the agreement of the vessel
  operator. A milestone is recorded complete only when its evidence artefact exists and
  has been verified, so the register admits no partial states.],
) <tab:milestones>

== The slipped milestone

Milestone M2.4, the cross-calibration of the moored optical sensors against the
shipborne profiling package, was due on 30 June and did not take place. The research
vessel was withdrawn on 2 June for unplanned hull survey following a routine
classification inspection, and no substitute platform with the required winch capacity
was available inside the window. The programme was notified on 3 June and the campaign
was formally replanned on 9 June.

The consequence is bounded. Cross-calibration establishes the transfer function between
the two optical sensor families; it does not gate the assimilation work, which uses
moored data only, nor the retrieval work, which uses gravimetric samples rather than
shipborne optics. What it does gate is the uncertainty budget for the annual sediment
budget, because without the transfer function the shipborne profiles from the 2025
campaigns cannot be merged with the moored record on a common scale. That merge is
required by 31 December 2026 and the September campaign leaves an adequate margin.

The residual concern is seasonal. The rebooked campaign runs from 8 to 19 September,
which is nine weeks before the winter deployment is due to be laid. If September is
lost as well, there is no further opportunity before the winter window closes and the
merge would move into the following programme year. The recovery plan therefore
identifies a contingency platform, the Partnership survey launch, which can carry a
reduced profiling package capable of delivering the transfer function at lower
precision. The reporting officer will decide by 21 August whether to hold the
contingency.

== Schedule to the end of the programme year

@fig:timeline shows the workstream schedule across 2026 with the milestone positions
marked. The WS3 bar carries a dashed overlay showing the approved plan against which
the current schedule is measured; the one month extension reflects the switched
retrieval trial added after the saturation limit was characterised.

#figure(
  gantt(
    width: 13.4cm,
    months: (
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ),
    rows: (
      (label: [WS1 Network operations], start: 0, end: 12, colour: ink.navy),
      (label: [WS2 Flux modelling], start: 1, end: 11, colour: ink.moss),
      (label: [WS3 Retrieval], start: 2, end: 10, colour: ink.rust, planned: (2, 9)),
      (label: [WS4 Data infrastructure], start: 0, end: 12, colour: ink.slate),
      (label: [WS5 Translation], start: 4, end: 12, colour: ink.plum),
    ),
    markers: (
      (pos: 4, row: 0, label: "M2.1"),
      (pos: 8.6, row: 0, label: "M2.4"),
      (pos: 6, row: 1, label: "M2.3"),
      (pos: 9, row: 2, label: "M3.2"),
      (pos: 5, row: 3, label: "M4.2"),
      (pos: 10, row: 3, label: "M4.3"),
      (pos: 6, row: 4, label: "M5.1"),
    ),
  ),
  caption: [Workstream schedule for 2026. Solid bars are the current schedule, the
  dashed overlay on WS3 is the approved plan, and diamonds mark milestone dates. The
  M2.4 diamond is drawn at its revised September position rather than at its original
  June date.],
) <fig:timeline>

The critical path for the remainder of the year runs through M2.4 and then through the
uncertainty budget merge, not through any modelling or retrieval activity. This is a
change from the position reported in the first quarter, when the critical path ran
through the assimilation acceptance, and it is a direct consequence of that milestone
completing early.
