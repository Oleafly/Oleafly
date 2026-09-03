#import "../lib/report.typ": *

= Executive summary

The Tidal Margin Observatory Programme completed the second quarter of its second
programme year with the observing network restored to design capacity for the first
time since the storm sequence of December 2025. The quarter was dominated by three
pieces of work: the antifouling retrofit of the upper marsh array, the transition of
the sediment flux model to a sequential assimilation scheme, and the first public
release of the programme data archive under persistent identifiers. All three closed
within the quarter, and together they move the programme from an instrument
commissioning posture into routine production of assimilated sediment flux estimates.

Programme data return for the quarter was 93.4 percent against a reporting threshold
of 90 percent, the highest figure recorded since the observatory was commissioned.
The improvement is almost entirely attributable to the upper marsh array, where
data return rose from 74 percent in the first quarter to 89 percent in the second
following replacement of the optical backscatter windows with copper shutter
assemblies. @fig:datareturn shows the quarterly trajectory of each array. The
mid-channel array continues to be the most reliable element of the network and has
not fallen below 92 percent in six quarters.

Scientific output kept pace with the engineering work. The recalibrated band ratio
retrieval for suspended sediment concentration was evaluated against 214 in situ
matchups collected between April and June and achieved a root mean square error of
9.8 milligrams per litre with a bias of negative 1.4 milligrams per litre, comfortably
inside the 12 milligram per litre acceptance threshold agreed with the funder. The
assimilating configuration of the flux model reduced hindcast error at the two
validation moorings from 18.4 to 11.7 milligrams per litre, which is the single
largest quality improvement recorded in the programme to date. Section 3 sets out
the technical basis for both results.

Two areas require the attention of the Oversight Board. The cross-calibration
campaign scheduled for June, milestone M2.4, slipped into the third quarter because
the research vessel was withdrawn for unplanned hull survey. The campaign has been
rebooked for 8 to 19 September and the slip does not affect any downstream
deliverable, but it does compress the interval before the winter deployment window.
Separately, expenditure at the end of the quarter stood at 51.5 percent of the annual
allocation against a profiled 48.5 percent, a variance of positive 6.2 percent. The
variance is understood and is driven by the decision to bring forward the mooring
hardware purchase from the third quarter in order to secure pricing before the
supplier's announced revision. It is not a forecast overspend, and the programme
remains within its annual envelope. Section 5 gives the reconciliation.

== Position at the end of the quarter

@tab:glance summarises the programme against the indicator set agreed in the award
conditions. Six of the eight indicators are at or better than target, one is in a
watch condition, and one is behind.

#figure(
  table(
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, center),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Indicator*], [*Q2 2026*], [*Target*], [*Status*],
    ),
    table.hline(stroke: 0.5pt),
    [Programme data return], [93.4%], [$>=$ 90%], [#status-mark("complete", "On target")],
    [Moorings on station at quarter end], [18 of 20], [20], [#status-mark("active", "In progress")],
    [Retrieval error, suspended sediment], [9.8 mg/L], [$<=$ 12 mg/L], [#status-mark("complete", "On target")],
    [Model hindcast error at validation moorings], [11.7 mg/L], [$<=$ 15 mg/L], [#status-mark("complete", "On target")],
    [Archive volume under persistent identifier], [1.42 TB], [1.20 TB], [#status-mark("complete", "On target")],
    [Milestones complete, cumulative], [9 of 12], [10 of 12], [#status-mark("slipped", "Behind")],
    [Expenditure against profile], [106.2%], [95 to 105%], [#status-mark("hold", "Watch")],
    [Peer reviewed outputs, cumulative], [7], [6], [#status-mark("complete", "On target")],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Programme indicators at 30 June 2026 against the targets set in the
  award conditions of NCRC-2024-ES-118. Expenditure against profile is the ratio of
  actual to profiled spend and is bounded rather than minimised.],
) <tab:glance>

Data return is defined for an array as the proportion of scheduled observations that
reach the archive having passed the level one quality control gate. For an array of
$N$ instruments observed over a period in which instrument $i$ was scheduled to
deliver $s_i$ samples and delivered $d_i$ accepted samples,

$ U = (sum_(i=1)^N d_i) / (sum_(i=1)^N s_i) $ <eq:datareturn>

so that an instrument that is absent from the water for part of the quarter still
counts against the denominator for the whole quarter. This is a deliberately
unforgiving definition: it charges the programme for servicing time as well as for
failures, and it is the reason the headline figure sits below the per instrument
reliability quoted by the manufacturers.

#figure(
  {
    line-chart(
      width: 13.2cm,
      height: 6.0cm,
      y-min: 60.0,
      y-max: 100.0,
      y-ticks: ((60, "60"), (70, "70"), (80, "80"), (90, "90"), (100, "100")),
      x-labels: ("Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026"),
      series: (
        (colour: ink.navy, values: (88.0, 91.0, 84.0, 79.0, 86.0, 93.0)),
        (colour: ink.moss, values: (94.0, 96.0, 95.0, 92.0, 95.0, 97.0)),
        (colour: ink.rust, values: (72.0, 76.0, 81.0, 68.0, 74.0, 89.0), dash: "dashed"),
      ),
    )
    v(0.15cm)
    align(center, chart-legend((
      ([Estuary mouth array (8 nodes)], ink.navy),
      ([Mid-channel array (7 nodes)], ink.moss),
      ([Upper marsh array (5 nodes)], ink.rust),
    )))
  },
  caption: [Quarterly data return by array, expressed as a percentage of scheduled
  observations reaching the archive. The fourth quarter of 2025 records the storm
  sequence that parted three upper marsh moorings. The recovery in the second quarter
  of 2026 follows the copper shutter retrofit described in Section 3.1.],
) <fig:datareturn>

== Principal conclusions

The programme draws four conclusions from the quarter. First, biofouling rather than
mooring loss is the dominant control on data return in the upper marsh, and the
retrofit has demonstrated that the problem is tractable with existing hardware; the
remaining gap to the mid-channel array is now dominated by servicing time rather than
by instrument failure. Second, sequential assimilation of moored turbidity into the
flux model yields a larger error reduction than any further refinement of the
model's sediment settling parameterisation, which supports reallocating WS2 effort
away from parameter tuning and towards observation operator development. Third, the
retrieval algorithm has reached the accuracy required for operational use in the
lower estuary but remains unreliable above 90 milligrams per litre, where the band
ratio saturates; this bounds the conditions under which the satellite product may be
substituted for in situ measurement. Fourth, the archive release has already changed
the programme's external profile, with 31 distinct institutional downloaders in the
six weeks since publication, and the data governance overhead of maintaining it is
lower than was budgeted.

None of these conclusions requires a change to the programme's approved workplan. The
recommendation to the Oversight Board is to note the milestone slip, approve the
revised September campaign dates, and endorse the WS2 effort reallocation described
in Section 3.2.
