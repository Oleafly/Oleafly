= Introduction <sec:intro>

A microgrid that has disconnected from the transmission system holds its
frequency with whatever is left behind, and on modern feeders what is left
behind is mostly power electronics. Synchronous machines carry stored kinetic
energy that opposes a load step before any controller acts. A grid-forming
inverter carries none. It has a capacitor, a switching stage, and a control law,
and the frequency response of the island is therefore whatever that control law
says it is.

Droop control remains the default because it is decentralised and because its
steady-state power sharing is exact @chandorkar1993droop. Its weakness is
dynamic rather than static. The gain $m_i$ that sets the frequency deviation per
unit of dispatched power is chosen once, at design time, from an assumed network
impedance. Distribution feeders do not oblige. Reconfiguration switches, tap
changes, and the loss of a single line move the effective reactance between two
units by a factor of four in the testbed we describe in @sec:evaluation, and
they do so within a cycle. A droop gain that gives a damping ratio of $0.3$ on
the nominal network gives $0.06$ on the reconfigured one, which is enough for
the frequency to ring visibly after every load change.

The standard response is to add a virtual inertia term, so that the inverter
emulates the swing equation of a machine it does not have
@dhople2015synchronverter. This helps the nadir and it does nothing for the
damping problem, because the emulated inertia enters the characteristic
polynomial in the same place as the real inertia it imitates: it slows the
response without moving the poles off the imaginary axis. Secondary control can
retune the gains, but it needs a communication channel, and a communication
channel is the component an islanded microgrid is least able to guarantee
@simpsonporco2015secondary.

We take a different route. Every grid-forming unit already runs a phase-locked
loop, and the error signal inside that loop is a measurement of exactly the
quantity the droop gain should be responding to: the mismatch between the phase
the unit is imposing and the phase the rest of the island has settled on. We
show that the mean square of this phase error, filtered over a few cycles, is a
sufficient statistic for the local sensitivity $partial P_i slash partial
delta_i$, and we build a gain adaptation on it that needs no communication and
no model of the network beyond a bound on its impedance.

== Contributions

This paper makes four claims.

+ A small-signal model of an islanded network of $N$ grid-forming inverters in
  which the droop gains appear as free parameters and the network impedance
  appears as a structured uncertainty (@sec:model).
+ A decentralised adaptation law for the active-power droop gain driven by the
  filtered phase-locked-loop error, together with a projection that keeps the
  gains inside a certified interval (@sec:controller).
+ A stability result: for any impedance in the stated uncertainty set, the
  adapted closed loop keeps its dominant eigenvalue pair inside a damping cone
  of half-angle $arccos zeta^star$, provided the adaptation rate stays below an
  explicit bound (@prop:cone).
+ A hardware-in-the-loop evaluation on a nine-bus island with eight
  grid-forming units, including the unbalanced-fault regime in which the
  adaptation must be disabled (@sec:evaluation).
