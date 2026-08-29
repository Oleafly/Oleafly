#import "../lib.typ": arrow, elbow, node

= Background: the two write paths <sec:architecture>

An LSM key-value store writes in three places and only one of them is under
the application's control. A client put appends a record to the write-ahead
log and inserts it into the memtable. When the memtable fills it is frozen and
flushed as an L0 SSTable. From there compaction rewrites data downward through
the levels, and each rewrite is a fresh set of bytes on the device. Host write
amplification is the ratio of bytes the store writes to bytes the client
supplied,

$ W_"host" = (B_"wal" + B_"flush" + sum_(l=0)^(L) B_"compact"^((l))) / B_"client", $ <eq:whost>

and on a block-interface SSD the device multiplies that again by relocating
live pages out of blocks it wants to erase, giving a total
$W_"total" = W_"host" dot W_"dev"$.

#place(top + center, scope: "parent", float: true, [
#figure(
  box(width: 504pt, height: 192pt, {
    set par(justify: false, leading: 0.5em)
    node((44pt, 70pt), 62pt, 34pt, text(size: 7.6pt)[workload\ clients])
    node((132pt, 40pt), 74pt, 26pt, text(size: 7.6pt)[memtable])
    node((132pt, 100pt), 74pt, 26pt, text(size: 7.6pt)[write-ahead log])
    node((236pt, 26pt), 76pt, 22pt, text(size: 7.6pt)[L0 SSTables], fill: luma(240))
    node((236pt, 58pt), 76pt, 22pt, text(size: 7.6pt)[L1 to L3], fill: luma(240))
    node((236pt, 90pt), 76pt, 22pt, text(size: 7.6pt)[L4 to L6], fill: luma(240))
    node((236pt, 136pt), 96pt, 26pt, text(size: 7.6pt)[compaction scheduler])
    node((348pt, 70pt), 84pt, 34pt, text(size: 7.6pt)[zone allocator\ (level agnostic)])
    node(
      (348pt, 136pt),
      84pt,
      26pt,
      text(size: 7.6pt, fill: rgb("#8a2b13"))[append accounting shim],
      stroke: (paint: rgb("#8a2b13"), thickness: 0.6pt, dash: "dashed"),
    )

    place(rect(width: 86pt, height: 142pt, fill: luma(248), stroke: 0.7pt), dx: 414pt, dy: 18pt)
    place(dx: 414pt, dy: 22pt, box(width: 86pt, align(center, text(size: 7.6pt, weight: "bold")[ZNS SSD])))
    let fills = (1.0, 0.78, 0.45, 0.2, 0.0)
    for (k, frac) in fills.enumerate() {
      let y = 40pt + 22pt * k
      if frac > 0.0 {
        place(rect(width: 70pt * frac, height: 16pt, fill: luma(178), stroke: none), dx: 422pt, dy: y)
      }
      place(rect(width: 70pt, height: 16pt, fill: none, stroke: 0.5pt), dx: 422pt, dy: y)
      place(dx: 424pt, dy: y + 4pt, text(size: 6.4pt)[zone #k])
    }
    place(dx: 414pt, dy: 164pt, box(width: 92pt, align(center, text(size: 7pt)[sequential append,\ reset by whole zone])))

    arrow((75pt, 64pt), (95pt, 46pt))
    arrow((75pt, 78pt), (95pt, 98pt))
    arrow((169pt, 36pt), (198pt, 28pt))
    place(dx: 168pt, dy: 20pt, text(size: 6.6pt)[flush])

    place(line(start: (274pt, 26pt), end: (292pt, 26pt), stroke: 0.6pt))
    place(line(start: (274pt, 58pt), end: (292pt, 58pt), stroke: 0.6pt))
    place(line(start: (274pt, 90pt), end: (292pt, 90pt), stroke: 0.6pt))
    place(line(start: (292pt, 26pt), end: (292pt, 90pt), stroke: 0.6pt))
    arrow((292pt, 58pt), (306pt, 64pt))
    elbow(((169pt, 100pt), (190pt, 100pt), (190pt, 118pt), (298pt, 118pt), (298pt, 80pt), (306pt, 80pt)))

    arrow((236pt, 123pt), (236pt, 103pt), stroke: 0.6pt + luma(110))
    place(dx: 240pt, dy: 106pt, text(size: 6.6pt, fill: luma(90))[rewrite])

    arrow((390pt, 70pt), (414pt, 70pt))
    place(dx: 386pt, dy: 54pt, text(size: 6.6pt)[zone append])
    elbow(
      ((402pt, 76pt), (402pt, 136pt), (392pt, 136pt)),
      stroke: (paint: rgb("#8a2b13"), thickness: 0.6pt, dash: "dashed"),
      size: 3.6pt,
    )

    place(dx: 0pt, dy: 176pt, text(size: 7pt, fill: luma(90))[Solid arrows carry data. The dashed path is the instrumentation added in Section 3 and is not on the critical path.])
  }),
  caption: [Write paths in an LSM store on a zoned namespace device. Every
    byte that reaches the drive passes through the zone allocator, which
    receives SSTables without the level that produced them. The accounting
    shim tags each append so that @eq:whost can be decomposed by cause.],
) <fig:arch>
])

Two properties of @fig:arch drive the rest of the paper. First, the allocator
is the only component that decides which physical zone a table lands in, and it
is the only component that does not know the table's level. Second, a zone can
only be reclaimed as a whole, so the reclaim cost of a zone is set by its
longest-lived resident. Mixing an L0 table, whose expected lifetime in our
workloads is 84 seconds, with an L5 table, whose expected lifetime is 31 hours,
means the zone cannot be reset until the L5 table is either obsolete or
relocated. Relocation is a host write, and it is the write that the accounting
in every store we examined attributes to compaction rather than to allocation.
