= Conclusion <sec:conclusion>

The droop gain of a grid-forming inverter should not be a constant, because the
quantity it is trading against, the synchronising stiffness of the network, is
not a constant. We showed that each unit already measures a sufficient
statistic for that stiffness inside its phase-locked loop, and that adapting
the gain on this statistic under a projection keeps the dominant eigenvalue
pair inside a stated damping cone for every impedance in the operator's
switching table. On a nine-bus hardware-in-the-loop island the adaptation held
the damping ratio above 0.24 across a four-to-one impedance range where a fixed
gain fell to 0.06, and it recovered 0.73 Hz of frequency nadir against that
same baseline.

Two limitations bound the claim. The stability result is a frozen-time argument
made rigorous by a slow-adaptation condition, so it says nothing about
adaptation rates near $1 slash tau_f$, and we did not test them. The second is
the unbalanced-fault regime of @sec:evaluation, where the sensor stops being
informative and the adaptation must be frozen by an external detector. A
sequence-decomposed phase error would remove that dependence, and it is where
we intend to take the work next.
