#import "../lib.typ": chart, series, legend

= Measurements <sec:measurements>

== Amplification moves, it does not vanish

@tab:breakdown gives the decomposition of @eq:whost for the uniform workload on
drive X. Reading across the block-interface row, host amplification is 4.71 and
the device adds a further factor of 1.38 for a total of 6.50. Moving to the
zoned interface removes the device term completely, which is the advertised
result and the reason the comparison is worth making at all. The host term,
however, rises from 4.71 to 6.24, and 1.44 of that increase is in a category
that does not exist on the block interface: relocation, the copying of live
tables out of a zone the store wants to reset.

#figure(
  caption: [Write amplification decomposed by cause, uniform 50-50 workload,
    drive X, at steady state. All columns are bytes written per byte of client
    data. Relocation is zero by construction on the block interface, where the
    device performs the equivalent work invisibly.],
  table(
    columns: (auto, auto, auto, auto, auto, auto),
    align: (left, center, center, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [Configuration], [log], [flush], [compact], [reloc.], [total],
    ),
    table.hline(stroke: 0.4pt),
    [Block, host], [1.00], [1.06], [2.65], [0.00], [4.71],
    [Block, device], [--], [--], [--], [--], [1.38],
    [Block, total], [--], [--], [--], [--], [6.50],
    table.hline(stroke: 0.3pt),
    [Zoned, default], [1.00], [1.06], [2.74], [1.44], [6.24],
    table.cell(fill: luma(234))[Zoned, pinned],
    table.cell(fill: luma(234))[1.00],
    table.cell(fill: luma(234))[1.06],
    table.cell(fill: luma(234))[*1.91*],
    table.cell(fill: luma(234))[*0.07*],
    table.cell(fill: luma(234))[*4.04*],
    table.hline(stroke: 0.9pt),
  ),
) <tab:breakdown>

The compaction term also moves, and it moves for a reason worth stating. Under
the default allocator, compaction output for a level is scattered across
whichever zones happen to be open, so a subsequent compaction that reads a
level reads it from many zones and writes it back to many more. Pinning zones
to levels makes each level's tables physically contiguous, which lets the
scheduler compact whole zones and cuts the compaction term from 2.74 to 1.91.
That is a larger effect than the relocation saving and we did not anticipate
it.

@tab:matrix summarises the full matrix as totals. The regression case is the
delete-heavy workload on drive Y, where the zoned default configuration writes
4 percent more bytes than the block interface, so a deployment that migrated
for endurance reasons would have lost.

#figure(
  caption: [Total write amplification across the matrix. B is the block
    interface, Z the zoned interface with the store's default allocator, and P
    the level-pinned allocator. Lower is better; the ratio column is B over P.],
  table(
    columns: (auto, auto, auto, auto, auto, auto, auto),
    align: (left, center, center, center, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      table.cell(rowspan: 2)[Workload],
      table.cell(colspan: 3)[drive X], table.cell(colspan: 3)[drive Y],
      [B], [Z], [P], [B], [Z], [P],
    ),
    table.hline(stroke: 0.4pt),
    [Uniform 50-50], [6.50], [6.24], [4.04], [7.11], [6.68], [4.41],
    [Zipfian 95-5], [5.02], [4.60], [3.28], [5.44], [5.13], [3.55],
    [Append-mostly], [3.91], [2.98], [2.43], [4.20], [3.31], [2.66],
    [Delete-heavy], [8.03], [8.35], [5.20], [8.71], [9.06], [5.62],
    table.hline(stroke: 0.9pt),
  ),
) <tab:matrix>

== Latency under load

Amplification is a currency the operator spends on endurance. Latency is what
the application sees, and the two do not move together. @fig:latency plots the
99th percentile put latency against offered throughput on drive X under the
uniform workload.

#figure(
  chart(
    width: 238pt,
    height: 148pt,
    pad-left: 32pt,
    pad-bottom: 26pt,
    xrange: (0, 320),
    yrange: (0, 26),
    xticks: ((0, [0]), (80, [80]), (160, [160]), (240, [240]), (320, [320])),
    yticks: ((0, [0]), (5, [5]), (10, [10]), (15, [15]), (20, [20]), (25, [25])),
    xlabel: [offered load (kops/s)],
    ylabel: [p99 put latency (ms)],
    body: (px, py) => {
      series(px, py, (
        (10, 1.4), (50, 1.7), (90, 2.1), (130, 2.8), (160, 3.9), (185, 5.8),
        (200, 8.6), (210, 13.1), (216, 19.4), (219, 25.2),
      ), stroke: (paint: luma(110), thickness: 1pt, dash: "dashed"))
      series(px, py, (
        (10, 1.1), (50, 1.3), (90, 1.6), (140, 2.0), (185, 2.6), (215, 3.6),
        (238, 5.4), (252, 8.3), (262, 13.0), (268, 19.6), (271, 25.4),
      ), stroke: (paint: rgb("#2f5fa8"), thickness: 1pt, dash: "dash-dotted"))
      series(px, py, (
        (10, 1.0), (60, 1.2), (120, 1.4), (180, 1.8), (230, 2.3), (266, 3.1),
        (292, 4.6), (306, 7.4), (314, 12.6), (318, 19.8), (320, 24.8),
      ), stroke: (paint: rgb("#8a2b13"), thickness: 1.3pt))
      place(
        dx: px(24),
        dy: py(24.6),
        box(fill: white, inset: (x: 3pt, y: 2pt), legend((
          (rgb("#8a2b13"), "solid", [zoned, level-pinned]),
          (rgb("#2f5fa8"), "dash-dotted", [zoned, default]),
          (luma(110), "dashed", [block interface]),
        ))),
      )
      place(dx: px(96), dy: py(12.1), box(fill: white, inset: (x: 2pt, y: 1pt), text(size: 6.6pt, fill: luma(90))[knee at 186 kops/s]))
      place(line(start: (px(186), py(6.1)), end: (px(172), py(10.8)), stroke: 0.4pt + luma(150)))
    },
  ),
  caption: [Tail latency against offered load, uniform workload, drive X. The
    block interface degrades first because the device's own relocation
    competes with client writes at a point the host cannot observe or schedule.],
) <fig:latency>

The block interface reaches its knee at 186 kops per second, the zoned default
at 231, and the level-pinned allocator at 274. The ordering is the same as the
amplification ordering, but the spacing is not: level pinning buys 35 percent
of the amplification benefit and 47 percent of the throughput benefit, because
the writes it eliminates are precisely the ones that were arriving in bursts
when a zone had to be reclaimed.
