= Introduction <sec:intro>

Austenitic steels of the 20Cr-25Ni-Nb family are used in advanced gas-cooled
reactor cladding and in superheater tubing because they hold their creep
strength at temperatures where ferritic grades have long since lost theirs. The
strengthening is conventionally attributed to niobium, and conventionally
explained by precipitation: niobium ties up carbon and nitrogen as fine MX
carbonitrides, those particles pin dislocations, and the alloy creeps slowly
@sourmail2001precipitation. The explanation is not wrong, but it is incomplete
in a way that matters for lifetime prediction.

The incompleteness is this. Precipitation strengthening is consumed by
service. MX particles coarsen, their number density falls, the mean spacing
grows, and the Orowan contribution decays as the inverse of that spacing. If
precipitation were the whole story, creep rate at fixed stress would rise
monotonically through the life of a component, and the rate of that rise would
be set by the coarsening kinetics. Measured creep curves on aged material do
not behave that way. They show a strength contribution that survives long
after the particle population has coarsened past the point where it could
account for the observed threshold @kim2015nbsegregation.

The candidate for the surviving contribution is grain-boundary segregation.
Niobium that remains in solid solution after precipitation partitions to grain
boundaries, and a solute-rich boundary resists sliding: the sliding rate under
a given shear stress falls because boundary diffusion is slowed and because the
solute exerts a drag on boundary dislocations @lejcek2010segregation. Unlike
precipitation, segregation is not consumed. It approaches an equilibrium
enrichment set by temperature and bulk composition, and once there it stays.

Separating the two contributions requires measuring both on the same material
in the same condition, which is the reason this study exists. Most published
work measures one or the other: creep data with inferred microstructure, or
atom-probe reconstructions on material that was aged without load. We took
gauge-length sections from interrupted constant-load creep tests at 923 K and
reconstructed boundary composition from those same sections, so the segregation
state and the creep state are matched specimen by specimen.

@sec:experimental describes the two heats, the creep frames, and the atom-probe
protocol. @sec:results gives the creep data, the fitted threshold stress, and
the boundary enrichment as a function of exposure. @sec:discussion argues that
the threshold tracks enrichment rather than particle spacing, gives the
conditions under which the argument fails, and states what the result implies
for extrapolation to service exposures of $10^5$ h.
