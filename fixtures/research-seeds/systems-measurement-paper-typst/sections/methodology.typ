= Measurement methodology <sec:methodology>

== Attributing bytes to causes

Published amplification numbers are usually computed from two counters: bytes
in from the client, bytes out from the block device. That ratio is correct and
it explains nothing, because it cannot say which of the terms in @eq:whost
grew. We replaced it with per-append attribution.

The store's zone-append call site was wrapped in a shim that carries an origin
tag through the submission path. The tag is set at the three points where a
write is created, namely log append, memtable flush, and compaction output,
and the compaction case carries the source and destination levels. Every
append therefore increments exactly one counter, and the counters sum to the
device's own written-bytes register to within 0.04 percent across every run we
report. @lst:shim is the accounting core.

#figure(
  kind: raw,
  supplement: [Listing],
  block(
    width: 100%,
    fill: luma(249),
    stroke: (left: 1.6pt + luma(160)),
    inset: (x: 6pt, y: 6pt),
    {
      set align(left)
      set par(justify: false, leading: 0.5em)
      set text(size: 7pt)
      raw(lang: "rust", "pub enum Origin {\n    Log,\n    Flush,\n    Compact { from: u8, to: u8 },\n    Relocate { level: u8 },\n}\n\nimpl ZoneWriter {\n    pub fn append(\n        &self,\n        z: ZoneId,\n        buf: &[u8],\n        o: Origin,\n    ) -> Result<Lba, ZoneError> {\n        let n = buf.len() as u64;\n        let lba = self.dev.zone_append(z, buf)?;\n        self.acct.record(z, n, o);\n        if self.zone_is_full(z) {\n            self.planner.seal(z, self.acct.mix(z));\n        }\n        Ok(lba)\n    }\n}\n\nimpl Accounting {\n    fn record(\n        &self, z: ZoneId, n: u64, o: Origin,\n    ) {\n        self.total.add(n);\n        match o {\n            Origin::Log => self.log.add(n),\n            Origin::Flush => self.flush.add(n),\n            Origin::Compact { from, to } => {\n                self.compact[to as usize].add(n);\n                self.edge(from, to).add(n);\n            }\n            Origin::Relocate { level } => {\n                let i = level as usize;\n                self.relocate[i].add(n)\n            }\n        }\n        self.residents(z).push(o);\n    }\n}")
    },
  ),
  caption: [The zone-append accounting shim. `Origin::Relocate` is the case
    that existing instrumentation folds into compaction; separating it is what
    makes the last column of @tab:breakdown measurable. The overhead is one
    relaxed atomic per append, which is 0.3 percent of append latency at the
    95th percentile.],
) <lst:shim>

The shim adds one relaxed fetch-and-add per append plus a per-zone resident
list that is read only when a zone is sealed. We measured its cost by running
the full matrix with the shim compiled out: throughput differs by 0.4 percent
and p99 latency by 0.3 percent, both within run-to-run variation.

== Hardware and stores

Two commercial ZNS drives were used: drive X, a 4 TB TLC part with 1,024 zones
of 2 GiB, and drive Y, a 8 TB QLC part with 2,048 zones of 4 GiB. Both were
attached to a single-socket host with 32 cores and 128 GiB of memory running a
6.8 series kernel. For the block-interface baseline the same physical drives
were reformatted to a conventional namespace, so the flash, the controller,
and the firmware are held constant and only the interface changes.

Three key-value stores were measured: two production LSM engines with existing
zoned support, and one research engine we modified to obtain the level-pinned
allocator of @sec:analysis. All three were configured with a 64 MiB memtable, a
256 MiB L1 target, a level multiplier of 10, and leveled compaction. Block
cache was fixed at 8 GiB to keep read amplification out of the comparison.

== Workloads

Four workloads were run to steady state, defined as the point at which the
level sizes stop growing and the compaction debt is stationary over a 30 minute
window. Reaching steady state took between 4 and 19 hours depending on the
workload, and every number reported below is measured after it.

The workloads are a uniform 50-50 read-write mix, a Zipfian 95-5 read-heavy
mix, an append-mostly time-series pattern with monotonically increasing keys,
and a delete-heavy pattern in which 20 percent of operations are tombstone
insertions. The last two were chosen because they are the cases where lifetime
mixing is expected to matter most and least respectively.
