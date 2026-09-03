= Related Work <sec:related>

Droop control descends from the parallel-inverter work of the early nineties
@chandorkar1993droop, and its steady-state properties are settled: proportional
power sharing holds whenever the gains are inversely proportional to the
ratings and the network is inductive. The dynamic properties are not settled,
and the disagreements in the literature are mostly disagreements about which
part of the network model to keep. The hierarchical framing that organises
primary, secondary, and tertiary layers @guerrero2011hierarchical is the
vocabulary we adopt, and the contribution of this paper sits entirely inside
the primary layer.

Virtual synchronous machines and synchronverters emulate the swing equation
inside the inverter @dhople2015synchronverter. They are the most widely
deployed answer to the inertia question and they are effective on the nadir.
Our position is that the nadir and the damping are separate problems and that
emulated inertia addresses only the first, which the trajectories in
@fig:nadir show directly.

Distributed secondary control restores frequency and can retune primary gains,
at the cost of a communication layer @simpsonporco2015secondary. Consensus
schemes tolerate delay well, but the failure mode that matters in an island is
the loss of the channel itself rather than its latency, and a controller that
degrades to an untuned primary loop when the radio drops is not obviously safer
than one that never used a radio. The adaptation in @eq:adapt is deliberately
communication-free for that reason.

Adaptive and gain-scheduled droop has been proposed before, usually scheduled
on measured output power or on an online impedance estimate
@vasquez2013adaptive. Impedance estimation requires injecting a probing signal,
which an operator will not permit continuously on a live island. The
contribution here is the observation that the phase-locked loop is already
performing the relevant measurement as a by-product of synchronisation, so the
probing signal is the disturbance itself.

Finally, the certified-interval construction in @eq:interval is in the spirit
of robust gain-scheduling results for linear parameter-varying systems
@apkarian1998lpv, specialised to the case where the scheduling variable is a
local energy rather than a global parameter.
