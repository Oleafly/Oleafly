#import "../lib/report.typ": *

= Outputs and dissemination

== Publications

Three peer reviewed outputs advanced during the quarter, bringing the cumulative total
to seven against a year two target of six. @tab:outputs lists the position at 30 June.
The programme counts an output only once it is accepted, so the two submitted
manuscripts do not yet contribute to the cumulative figure.

#figure(
  table(
    columns: (auto, 1fr, auto, auto),
    align: (left, left, left, center),
    table.hline(stroke: 0.7pt),
    table.header([*Ref*], [*Output*], [*Venue*], [*Status*]),
    table.hline(stroke: 0.5pt),
    [O-14],
    [Copper shutter assemblies for optical backscatter sensors in high productivity
    marsh channels],
    [Marine Instrumentation and Methods],
    [#status-mark("complete", "Accepted")],
    [O-15],
    [Single source of record archives for multi workstream observing programmes],
    [Environmental Data Science and Practice],
    [#status-mark("complete", "Published")],
    [O-16],
    [Saturation limits of red to green reflectance ratios at high suspended load],
    [Remote Sensing of Coastal Waters],
    [#status-mark("active", "Under review")],
    [O-17],
    [Observation operator design for turbidity assimilation in shallow estuaries],
    [Modelling of Coastal Systems],
    [#status-mark("active", "In preparation")],
    [O-18],
    [Dataset: TMOP moored and shipborne observations, version 2],
    [TMOP archive, accession TMOP-2026Q2],
    [#status-mark("complete", "Released")],
    [O-19],
    [Guidance note: use of observatory data in dredge consent conditions],
    [Estuary Partnership],
    [#status-mark("active", "Draft")],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Programme outputs advanced in the second quarter of 2026. Only accepted or
  published items count towards the cumulative output target, so O-16, O-17 and O-19 are
  excluded from the figure of seven reported in Table 1.],
) <tab:outputs>

The accepted paper O-14 documents the retrofit reported in Section 3.1 and includes the
paired fouling growth curves from the recovered and replacement sensor heads
@ferreira2025biofouling. It is the first instrumentation output of the programme and is
expected to be the most reused, because the fouling problem it addresses is general to
shallow marsh deployments rather than specific to the Hollowmere.

O-16 reports the saturation characterisation in Section 3.3 @ossei2025bandratio. The
manuscript deliberately reports a negative operational result, that the band ratio
cannot be relied on above 90 milligrams per litre, and the programme regards publishing
that bound as more valuable than deferring publication until a working high
concentration algorithm exists.

== Data release

Version two of the archive was released on 19 May 2026 under accession prefix
TMOP-2026Q2, comprising 11 datasets and 1.42 terabytes. Each dataset carries a
persistent identifier that resolves to a versioned landing page, and every figure in
this report can be regenerated from the accessions cited in its caption. Uptake in the
six weeks to the end of the quarter was 31 distinct institutional downloaders and 486
dataset retrievals.

== Engagement

The Estuary Partnership workshop of 11 June is reported in Section 3.5. In addition,
two conference abstracts were accepted for the autumn coastal sediment meeting, and the
programme hosted a one day visit from the regulator's technical team on 24 June focused
on the archive provenance model. The regulator has since asked whether the provenance
flagging described in Section 3.4 could be adopted as a condition on other monitoring
programmes, which the programme regards as the strongest external validation of the
data infrastructure work to date.
