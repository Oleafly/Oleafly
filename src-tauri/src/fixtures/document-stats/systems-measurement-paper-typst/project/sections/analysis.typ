= Analysis <sec:analysis>

== The seven-line change

The level-pinned allocator differs from the default in one decision. When a
compaction output stream requests a zone, the allocator consults the
destination level and returns a zone from a per-level free list rather than
from the global one. Zones are returned to the global list on reset. The
change is seven lines in the store we modified and it needs no new state
beyond one free list per level, which is at most seven lists.

The reason it works is a lifetime argument. Let $tau_l$ be the expected
lifetime of a table at level $l$ and let a zone hold tables from a set $cal(S)$
of levels. The zone cannot be reset until every resident is obsolete, so its
occupancy time is $max_(l in cal(S)) tau_l$ while the useful storage it
provided is the sum over residents. The relocation cost per zone is therefore
governed by the spread of the lifetime distribution inside it,

$ C_"reloc" prop sum_(l in cal(S)) (max_(k in cal(S)) tau_k - tau_l), $ <eq:spread>

which is zero exactly when $cal(S)$ is a singleton. Pinning makes it a
singleton by construction.

== When pinning does not help

@eq:spread also predicts the failure case. Pinning removes the spread across
levels; it does nothing about spread within a level. On workloads where L0
tables have widely varying lifetimes, because some keys are overwritten within
seconds and others survive for hours, an L0-only zone still has a wide internal
spread and still pays relocation.

We can measure this before deploying. Define the lifetime dispersion of a level
as the ratio of the 90th to the 10th percentile table lifetime at that level,
measured over one hour of steady-state operation. Across our four workloads the
dispersion at L0 is 2.1 for uniform, 2.4 for Zipfian, 1.3 for append-mostly,
and 11.7 for delete-heavy. The benefit of pinning tracks the inverse of that
number: the append-mostly workload, with the tightest dispersion, gets the
smallest absolute improvement because it had the least to fix, while
delete-heavy gets the largest absolute improvement and still ends with the
worst residual relocation term of any workload, 0.31 against 0.07 for uniform.

A deployment can therefore be classified with a one-hour instrumented run. If
L0 dispersion is below about 3, pinning removes essentially all relocation. If
it is above 10, pinning is worth roughly half of what it is worth elsewhere and
a lifetime-aware allocator, which we have not built, is the remaining
opportunity.

== Threats to validity

Three limits should be stated plainly. Our two drives come from the same
generation and both expose zones in the 2 to 4 GiB range; a device with much
smaller zones would reduce the cost of mixing simply because fewer tables share
a zone, and we cannot say where the effect disappears. Our steady-state
definition excludes the first several hours of a fresh deployment, which is
precisely the period during which a migration would be evaluated in practice.
And the level-pinned allocator was implemented in one of the three stores, so
the 1.61 times figure is a property of that store and not of the technique in
general; the amplification decomposition in @tab:breakdown is what we would ask
another implementation to reproduce.
