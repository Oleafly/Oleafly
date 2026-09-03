= Conclusion <sec:conclusion>

Moving an LSM key-value store from a block-interface SSD to a zoned namespace
drive does what it promises at the device and undoes part of it at the host.
Across four workloads, three stores, and two drives, device amplification went
to one and host amplification rose by 18 to 41 percent, with the increase
concentrated in a relocation term that existing instrumentation attributes to
compaction and therefore cannot see. On the delete-heavy workload the net
effect was a regression.

The cause is an information loss at a layer boundary. The zone allocator
decides physical placement and does not receive the LSM level, which is the
best available proxy for how long a table will live. Restoring that
information with a per-level free list is a seven-line change, and it takes the
uniform workload from a 1.04 times improvement to a 1.61 times improvement
while raising the throughput knee from 186 to 274 kops per second.

The result generalises less than we would like, and we have tried to be
specific about where. Level pinning removes lifetime spread between levels and
not within them, so its benefit is predicted by the L0 lifetime dispersion,
which a one-hour instrumented run can measure. Workloads with a dispersion
above 10 keep a substantial relocation term, and a genuinely lifetime-aware
allocator is the open problem we leave. The accounting shim in @lst:shim is the
part of this work we would most like other implementations to adopt, because
the effect we report was invisible under the two-counter accounting that the
field currently uses.
