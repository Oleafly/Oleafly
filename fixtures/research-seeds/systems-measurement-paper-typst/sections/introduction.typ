= Introduction <sec:intro>

A conventional SSD lies to the host. It presents a block interface that
accepts overwrites at any offset, and it maintains that illusion with an
internal flash translation layer that copies live data out of blocks it wants
to erase. The copying is invisible, it consumes write endurance the host never
asked to spend, and it produces the latency spikes that every storage engineer
has learned to describe as garbage collection.

Zoned namespace SSDs @bjorling2021zns drop the illusion. The device exposes
zones that must be written sequentially and reset in their entirety, and it
performs no internal relocation. Whatever amplification remains is produced by
the host, where it can be measured and, in principle, removed.

Log-structured merge-trees look like the natural host for that interface. An
LSM store already writes sequentially, already treats data as immutable once
written, and already has a compaction process whose entire purpose is to
reclaim space by rewriting. The expected result of putting an LSM store on a
ZNS drive is that device amplification goes to one, host amplification stays
where it was, and total bytes written falls by whatever the device was
spending.

That is not what we measured. Device amplification does go to one, exactly as
advertised. Host amplification goes up, by 18 to 41 percent depending on the
workload, and on one of our four workloads the increase is large enough to
erase the entire benefit. The cause is a layering accident rather than
anything fundamental: the zone allocator sits below the compaction scheduler
and receives SSTable writes without knowing which level of the tree produced
them. Tables from L0, which live for minutes, land in the same zone as tables
from L5, which live for days. Resetting that zone requires relocating the L5
tables, and the relocation is a host write that no accounting in any of the
three stores we measured attributes to its cause.

This paper does three things.

*We attribute every byte.* @sec:methodology describes a shim on the zone-append
path that tags each write with its originating level and cause, so that the
amplification breakdown in @tab:breakdown is measured rather than inferred.

*We measure the regression across a realistic matrix.* Four workloads, three
key-value stores, and two commercial ZNS drives, with the block-interface
configuration of the same stores on the same hardware as the baseline
(@sec:measurements).

*We show the fix is small and we say when it is not enough.* Pinning zones to
levels is a change of seven lines in the allocator of the store we modified,
and it turns a 1.04 times regression into a 1.61 times improvement. It does
not help workloads whose key distribution makes L0 tables long-lived, and
@sec:analysis gives the measurable property that distinguishes the two cases.
