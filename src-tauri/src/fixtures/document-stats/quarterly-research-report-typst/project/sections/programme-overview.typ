#import "../lib/report.typ": *

= Programme overview

== Aims

The Tidal Margin Observatory Programme was established to close a specific gap in the
management of macrotidal estuaries: the absence of continuous, quality controlled
measurements of suspended sediment transport across the intertidal margin at the
timescale on which the margin actually evolves. Regulatory sediment budgets for the
Hollowmere estuary have historically been assembled from quarterly boat surveys, which
resolve the seasonal signal but alias the storm and spring tide events that move most
of the material @delacroix2022sedimentbudget. The programme's central hypothesis is
that a permanently moored network, assimilated into a calibrated transport model, will
reduce the uncertainty on the annual sediment budget by at least a factor of two
relative to the survey based method @renwick2023estuarine.

The instantaneous depth integrated suspended sediment flux at a station is

$ F(t) = integral_(-h)^(eta(t)) u(z, t) c(z, t) dif z $ <eq:flux>

where $u$ is the along channel velocity, $c$ the suspended sediment concentration,
$h$ the depth below datum and $eta$ the free surface elevation. Decomposing the
velocity and concentration into a tidal mean and a fluctuating part and averaging over
an integer number of tidal cycles gives

$ chevron.l F chevron.r = chevron.l U chevron.r chevron.l C chevron.r + chevron.l U' C' chevron.r $ <eq:decomp>

in which the first term is the advective flux carried by the residual current and the
second is the tidal pumping term. The two terms are frequently of comparable magnitude
and opposite sign in the Hollowmere, which is precisely why the budget is sensitive to
sampling: a survey programme that resolves only $chevron.l U chevron.r$ and
$chevron.l C chevron.r$ recovers the first term and discards the second
@lindqvist2022turbidity. Resolving $chevron.l U' C' chevron.r$ requires concurrent
velocity and concentration at a cadence short relative to the tidal period, which is
the design driver for the whole observing network.

== Workstream structure

The programme is delivered through five workstreams, listed in @tab:workstreams. The
structure has been stable since the award and no change is proposed. Staff effort is
expressed in full time equivalents averaged over the quarter.

#figure(
  table(
    columns: (auto, 1fr, auto, auto),
    align: (left, left, left, right),
    table.hline(stroke: 0.7pt),
    table.header([*Ref*], [*Workstream and principal deliverable*], [*Lead*], [*FTE*]),
    table.hline(stroke: 0.5pt),
    [WS1],
    [Observing network operations. Deployment, servicing and recovery of the moored
    arrays; vessel campaigns; level zero data capture.],
    [Ferreira-Baptista], [4.2],
    [WS2],
    [Sediment flux modelling. Maintenance and validation of the HOLT-2 transport model
    and its assimilation subsystem.],
    [Adeleye], [2.8],
    [WS3],
    [Remote sensing retrieval. Calibration and validation of the satellite suspended
    sediment product against in situ matchups.],
    [Kanemura], [2.3],
    [WS4],
    [Data infrastructure. Ingest, quality control, archive, persistent identifiers and
    the public access portal.],
    [Vasilenko], [3.0],
    [WS5],
    [Management translation. Engagement with the Estuary Partnership and conversion of
    programme output into regulatory guidance.],
    [Oyelaran], [0.8],
    table.hline(stroke: 0.5pt),
    [], [*Total programme effort*], [], [*13.1*],
    table.hline(stroke: 0.7pt),
  ),
  caption: [Workstream register at 30 June 2026 with average staff effort over the
  quarter in full time equivalents. Effort excludes the programme office, which is
  charged to the indirect budget line.],
) <tab:workstreams>

== Observing system architecture

@fig:architecture shows how observations move from the water to the products the
Estuary Partnership consumes. The architecture has one property that is worth stating
explicitly for the Oversight Board: the archive, and not the model, is the single
point through which every product is derived. No workstream is permitted to publish a
figure from a private copy of the data. This was a deliberate and initially unpopular
constraint, and it is the reason the programme is able to reproduce any published
result from an accession number alone @vasilenko2026archive.

#figure(
  box(width: 13.6cm, height: 7.9cm, {
    node-box(dx: 0cm, dy: 0cm, width: 4cm, height: 1.05cm)[
      Moored sensor nodes\
      20 stations, WS1
    ]
    node-box(dx: 4.8cm, dy: 0cm, width: 4cm, height: 1.05cm)[
      Vessel profiling\
      campaigns, WS1
    ]
    node-box(dx: 9.6cm, dy: 0cm, width: 4cm, height: 1.05cm)[
      Satellite tasking\
      and download, WS3
    ]
    arrow-v(dx: 2cm, dy: 1.05cm, len: 0.75cm)
    arrow-v(dx: 6.8cm, dy: 1.05cm, len: 0.75cm)
    arrow-v(dx: 11.6cm, dy: 1.05cm, len: 0.75cm)
    node-box(dx: 0cm, dy: 1.8cm, width: 13.6cm, height: 0.85cm, fill: rgb("#f2f4f7"))[
      Level zero ingest, telemetry reconciliation and automated quality control (WS4)
    ]
    arrow-v(dx: 6.8cm, dy: 2.65cm, len: 0.75cm)
    place(dx: 6.95cm, dy: 2.78cm, text(size: 6.8pt, fill: ink.slate)[flagged series])
    node-box(dx: 0cm, dy: 3.4cm, width: 13.6cm, height: 0.85cm, fill: rgb("#e7edf4"))[
      TMOP data archive: versioned, identifier minted, single source of record (WS4)
    ]
    arrow-v(dx: 3.2cm, dy: 4.25cm, len: 0.75cm)
    arrow-v(dx: 10.4cm, dy: 4.25cm, len: 0.75cm)
    node-box(dx: 0cm, dy: 5cm, width: 6.4cm, height: 1cm)[
      Sediment flux model HOLT-2\
      with sequential assimilation (WS2)
    ]
    node-box(dx: 7.2cm, dy: 5cm, width: 6.4cm, height: 1cm)[
      Retrieval calibration and\
      matchup validation (WS3)
    ]
    arrow-h(dx: 6.4cm, dy: 5.5cm, len: 0.8cm, colour: ink.rust, dash: "dashed")
    arrow-v(dx: 3.2cm, dy: 6cm, len: 0.75cm)
    arrow-v(dx: 10.4cm, dy: 6cm, len: 0.75cm)
    node-box(dx: 0cm, dy: 6.75cm, width: 13.6cm, height: 0.85cm, fill: rgb("#f2f4f7"))[
      Sediment budget products, regulatory guidance and public portal (WS5)
    ]
  }),
  caption: [Observing system architecture. Solid arrows carry observations and derived
  fields; the dashed arrow carries assimilated concentration fields from the model to
  the retrieval calibration, which is the only path by which model output re-enters a
  measurement product. Every product is derived from the archive rather than from a
  workstream's private copy.],
) <fig:architecture>

== Governance and reporting

The programme reports quarterly to the Oversight Board and annually to the funder. The
Board met on 14 May 2026 and 2 July 2026. Data governance is delegated to the Institute
Data Governance Committee, which reviewed and approved the archive release conditions
on 21 May 2026. Two standing derogations remain in force: vessel campaign data are
embargoed for 90 days after the campaign closes to allow calibration, and mooring
positions in the upper marsh are published at reduced precision at the request of the
landowner. Both derogations are recorded in the archive metadata and neither affects
the reproducibility of a published result.

The programme uses a fixed definition of milestone completion. A milestone is complete
only when its evidence artefact, which is in every case an archive accession or a
submitted manuscript, exists and has been verified by the reporting officer. Partial
completion is not recognised. This is stricter than the funder requires and it is the
reason the milestone count in @tab:glance moves in steps rather than smoothly.
