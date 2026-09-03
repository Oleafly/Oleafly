= Related work <sec:related>

*Zoned storage.* The zoned namespace command set and its motivation are
described by its designers @bjorling2021zns, and the early evaluations
established the headline result we take as our starting point: device
amplification goes to one. Those evaluations measured total bytes written and
did not decompose the host term, which is where the effect we report lives.

*Amplification in LSM stores.* The theory of leveled compaction gives host
amplification as roughly the level multiplier times the number of levels
@oneil1996lsm, and a long line of work reduces it by changing the compaction
policy: tiering, partial merges, and key-range partitioning
@dayan2017monkey. That work is orthogonal to ours. It reduces the compaction
term in @eq:whost; we are concerned with a relocation term that those analyses
assume is zero because on a block device it is hidden inside the drive. Key
and value separation @lu2016wisckey attacks the same term from a different
direction and would compose with level pinning, since it changes what is
written rather than where it lands.

*Host-managed flash.* Open-channel SSDs and the software-defined flash line of
work moved the translation layer into the host a decade before zoned namespaces
standardised a narrower version of the same idea @ouyang2014sdf. The lesson
that transferred is that host management is only a win when the host has
information the device lacked. Our result is a case where the host had the
information, in the form of the level a table belongs to, and threw it away one
layer above the place it was needed.

*Lifetime-aware data placement.* Grouping data by expected lifetime to reduce
garbage collection is an old idea in flash management and has been revisited
for multi-stream SSDs @kang2014multistream. Our level pinning is the crudest
possible instance of it, using the LSM level as a lifetime proxy, and the
dispersion analysis in @sec:analysis is an argument about when that proxy is
good enough.
