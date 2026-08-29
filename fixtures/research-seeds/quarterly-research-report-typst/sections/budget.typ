#import "../lib/report.typ": *

= Budget and resources

== Position against the annual allocation

@tab:budget reconciles the annual allocation for programme year two against expenditure
and commitment at 30 June 2026. All figures are in thousands of euros and exclude value
added tax, which is recovered separately. Expenditure is cash spent and reconciled
against the institute ledger; commitment is contractually bound but not yet invoiced;
the uncommitted balance is the residue available for reallocation.

#figure(
  table(
    columns: (1fr, auto, auto, auto, auto),
    align: (left, right, right, right, right),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Budget line*], [*Allocation*], [*Spent*], [*Committed*], [*Uncommitted*],
      [], [kEUR], [kEUR], [kEUR], [kEUR],
    ),
    table.hline(stroke: 0.5pt),
    [Staff, research (WS1 to WS3)], [1 284.0], [612.4], [640.8], [30.8],
    [Staff, data and software (WS4)], [396.0], [191.7], [198.0], [6.3],
    [Instrumentation and moorings], [512.5], [348.9], [121.0], [42.6],
    [Vessel time and field logistics], [268.0], [143.2], [88.5], [36.3],
    [Computing and data archive], [174.0], [79.6], [61.2], [33.2],
    [Satellite tasking and licences], [96.0], [48.0], [44.0], [4.0],
    [Travel, engagement and publication], [82.5], [31.8], [22.4], [28.3],
    [Institutional indirect charge], [487.0], [243.5], [243.5], [0.0],
    table.hline(stroke: 0.6pt),
    [*Total*], [*3 300.0*], [*1 699.1*], [*1 419.4*], [*181.5*],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Annual allocation against expenditure and commitment at 30 June 2026 in
  thousands of euros. Each row satisfies allocation equals spent plus committed plus
  uncommitted, and the uncommitted column is the programme's remaining freedom of
  action for the year.],
) <tab:budget>

Expenditure of 1 699.1 against an allocation of 3 300.0 is 51.5 percent of the annual
envelope at the halfway point of the year. The award conditions profile expenditure
rather than assuming a straight line, and the profiled position at the end of the
second quarter is 48.5 percent, or 1 600.5. Variance against plan is reported as

$ V = (A - P) / P times 100 = (1699.1 - 1600.5) / 1600.5 times 100 = +6.2 % $ <eq:variance>

where $A$ is actual and $P$ profiled expenditure to date. A second indicator, the
commitment coverage ratio, measures how much of the annual allocation is already
either spent or contractually bound,

$ K = (A + C) / B = (1699.1 + 1419.4) / 3300.0 = 0.945 $ <eq:coverage>

with $C$ commitment and $B$ the allocation. A coverage of 94.5 percent at the halfway
point is high but is expected in a programme whose staff costs, 50.9 percent of the
allocation, are committed for the full year at the point of appointment.

== Explanation of the variance

The positive variance has a single dominant cause. The mooring hardware purchase for
the winter deployment, budgeted at 118.0 in the third quarter, was brought forward into
May after the supplier gave notice of a price revision effective 1 July. The purchase
was made at the pre-revision price and the programme avoided an estimated 14.2 in cost
increase. Removing this timing effect, expenditure to date would be 1 581.1 against a
profile of 1 600.5, a variance of negative 1.2 percent.

The Oversight Board is asked to note that this is a timing variance and not a forecast
overspend. The annual outturn forecast is unchanged at 3 291.0, or 9.0 under
allocation. The programme does not propose to reallocate the uncommitted balance at
this point in the year.

== Expenditure by workstream

@tab:wsspend decomposes the quarter's expenditure by workstream against the quarterly
profile. WS1 carries the whole of the programme level variance and more, offset by
modest underspends elsewhere.

#figure(
  table(
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, right),
    table.hline(stroke: 0.7pt),
    table.header(
      [*Workstream*], [*Profiled*], [*Actual*], [*Variance*],
      [], [kEUR], [kEUR], [%],
    ),
    table.hline(stroke: 0.5pt),
    [WS1 Observing network operations], [268.0], [311.4], [$+$16.2],
    [WS2 Sediment flux modelling], [142.0], [128.6], [$-$9.4],
    [WS3 Remote sensing retrieval], [118.5], [121.9], [$+$2.9],
    [WS4 Data infrastructure], [156.0], [149.1], [$-$4.4],
    [WS5 Management translation], [41.0], [34.5], [$-$15.9],
    [Programme office and indirect], [158.5], [157.2], [$-$0.8],
    table.hline(stroke: 0.6pt),
    [*Quarter total*], [*884.0*], [*902.7*], [*$+$2.1*],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Second quarter expenditure by workstream against the quarterly profile.
  Cumulative expenditure for the year is 1 699.1, being 796.4 in the first quarter and
  902.7 in the second. The WS1 overspend is the brought forward hardware purchase and
  the retrofit workboat charter.],
) <tab:wsspend>

The WS5 underspend of 15.9 percent is the deferred engagement event described in
Section 3.5 and will reverse in the third quarter. The WS2 underspend reflects a
research fellow starting three weeks later than planned; the post is filled and the
underspend will not recur.

== Staff effort

@fig:effort compares planned against actual staff effort in full time equivalent months
for the quarter. Total effort was 39.3 against a plan of 40.5 full time equivalent
months, so the programme delivered slightly less effort than planned while spending
slightly more money, which is the expected signature of a quarter in which
non staff procurement was brought forward.

#figure(
  {
    bar-chart(
      width: 12.6cm,
      height: 5.6cm,
      y-min: 0.0,
      y-max: 15.0,
      y-ticks: ((0, "0"), (5, "5"), (10, "10"), (15, "15")),
      groups: (
        (label: "WS1", values: (11.0, 12.6)),
        (label: "WS2", values: (9.0, 8.4)),
        (label: "WS3", values: (7.5, 6.9)),
        (label: "WS4", values: (10.0, 9.0)),
        (label: "WS5", values: (3.0, 2.4)),
      ),
      series: (([Planned], ink.slate), ([Actual], ink.navy)),
    )
    v(0.15cm)
    align(center, chart-legend((
      ([Planned effort], ink.slate),
      ([Actual effort], ink.navy),
    )))
  },
  caption: [Planned against actual staff effort by workstream for the second quarter of
  2026, in full time equivalent months. WS1 is the only workstream above plan, absorbing
  the retrofit campaign. The WS5 shortfall is the deferred engagement event.],
) <fig:effort>

The only structural concern in the effort profile is WS3, which has run below plan for
three consecutive quarters. The cause is not recruitment but the fact that the
retrieval work has repeatedly been able to reuse WS4 tooling rather than build its own.
The programme judges this to be an efficiency rather than a shortfall, and proposes to
rebase the WS3 effort profile downward at the annual review instead of attempting to
consume the allocation.
