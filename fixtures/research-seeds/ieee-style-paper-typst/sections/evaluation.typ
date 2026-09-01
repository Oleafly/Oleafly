#import "../lib.typ": chart, series, legend

= Hardware-in-the-Loop Evaluation <sec:evaluation>

== Testbed

The island is a nine-bus radial feeder emulated on a real-time digital
simulator at a 20 microsecond time step, with eight grid-forming units running
the control law on physical 200 MHz microcontrollers exchanging analogue
signals with the simulator. Unit ratings are between 40 and 180 kVA and the
aggregate load is 620 kW. The power-measurement filter is $tau_f = 0.08$ s in
every configuration. Two network configurations are used: the nominal radial
one, and a reconfigured one in which two tie switches close and the effective
reactance between the two largest units falls by a factor of 4.1, which is the
$lambda^+ slash lambda^-$ ratio quoted in @sec:model.

Three baselines are compared against the adaptation of @eq:adapt. Fixed droop
uses the gain that gives $zeta = 0.30$ on the nominal network. Virtual inertia
adds an emulated inertia constant of $H = 3.5$ s on top of that gain
@dhople2015synchronverter. Robust droop detunes the fixed gain until it is
stable on both configurations, which is the design a cautious operator would
actually ship.

== Frequency response to a load step

@fig:nadir shows the island frequency after a 0.42 per-unit load step applied
on the reconfigured network, the case each controller finds hardest. Fixed
droop reaches a nadir of 48.71 Hz and then rings for more than two seconds at
roughly 1.1 Hz, which is the underdamped mode that @eq:zeta predicts once the
tie switches raise $lambda_k$. Virtual inertia does what it is advertised to do
and lifts the nadir to 49.15 Hz, but the ringing survives untouched, because
emulated inertia moves the poles down the real axis without moving them off the
imaginary one. The adapted controller reaches 49.44 Hz and is within 0.05 Hz of
its final value after 1.2 s.

#figure(
  chart(
    width: 246pt,
    height: 136pt,
    pad-left: 33pt,
    xrange: (0, 3),
    yrange: (48.4, 50.15),
    xticks: ((0, [0]), (0.5, [0.5]), (1, [1.0]), (1.5, [1.5]), (2, [2.0]), (2.5, [2.5]), (3, [3.0])),
    yticks: ((48.5, [48.5]), (49.0, [49.0]), (49.5, [49.5]), (50.0, [50.0])),
    xlabel: [time after load step (s)],
    ylabel: [island frequency (Hz)],
    body: (px, py) => {
      series(px, py, (
        (0, 50.0), (0.1, 49.86), (0.2, 49.55), (0.3, 49.15), (0.45, 48.71),
        (0.6, 48.94), (0.75, 49.52), (0.9, 49.93), (1.05, 49.86), (1.2, 49.58),
        (1.35, 49.42), (1.55, 49.55), (1.75, 49.82), (1.95, 49.79), (2.2, 49.58),
        (2.45, 49.62), (2.7, 49.72), (3.0, 49.66),
      ), stroke: (paint: luma(110), thickness: 0.9pt, dash: "dashed"))
      series(px, py, (
        (0, 50.0), (0.15, 49.93), (0.3, 49.72), (0.45, 49.42), (0.6, 49.15),
        (0.8, 49.28), (1.0, 49.72), (1.2, 49.94), (1.4, 49.83), (1.6, 49.55),
        (1.8, 49.49), (2.05, 49.63), (2.3, 49.78), (2.6, 49.69), (3.0, 49.65),
      ), stroke: (paint: rgb("#2f5fa8"), thickness: 0.9pt, dash: "dash-dotted"))
      series(px, py, (
        (0, 50.0), (0.12, 49.88), (0.25, 49.66), (0.38, 49.50), (0.5, 49.44),
        (0.65, 49.51), (0.8, 49.66), (0.95, 49.74), (1.1, 49.71), (1.3, 49.66),
        (1.5, 49.645), (1.8, 49.66), (2.2, 49.658), (2.6, 49.66), (3.0, 49.66),
      ), stroke: (paint: rgb("#8a2b13"), thickness: 1.2pt))
      place(dx: px(0.45) - 1.8pt, dy: py(48.71) - 1.8pt, circle(radius: 1.8pt, fill: luma(110), stroke: none))
      place(dx: px(0.5) - 1.8pt, dy: py(49.44) - 1.8pt, circle(radius: 1.8pt, fill: rgb("#8a2b13"), stroke: none))
      place(dx: px(1.28), dy: py(50.13), box(fill: white, inset: (x: 3pt, y: 2pt), legend((
        (luma(110), "dashed", [fixed droop]),
        (rgb("#2f5fa8"), "dash-dotted", [virtual inertia, $H = 3.5$ s]),
        (rgb("#8a2b13"), "solid", [phase-locked adaptation]),
      ))))
    },
  ),
  caption: [Island frequency after a 0.42 per-unit load step on the
    reconfigured network. Markers show the nadir of the worst and the best
    controller. Virtual inertia lifts the nadir without damping the mode.],
) <fig:nadir>

== Damping across the impedance range

@tab:damping sweeps the network between the two configurations and reports the
dominant damping ratio identified from a 0.1 per-unit pseudo-random binary
excitation. Fixed droop is at its design point only on the nominal network.
Robust droop trades away half of its nominal performance to survive the
reconfigured one and still does not clear $zeta^star = 0.24$. The adapted
controller holds the target at every point in the sweep, which is the statement
@prop:cone makes.

#figure(
  caption: [Dominant damping ratio $zeta$, frequency nadir, and settling time
    across the impedance sweep. Lower reactance means a stiffer network. The
    target is $zeta^star = 0.24$.],
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, center, center, center, center),
    table.hline(stroke: 0.8pt),
    table.header(
      table.cell(rowspan: 2)[Controller],
      table.cell(colspan: 3)[$zeta$ at reactance scale], table.cell(rowspan: 2)[nadir\ (Hz)],
      [$1.0$], [$0.5$], [$0.24$],
    ),
    table.hline(stroke: 0.4pt),
    [Fixed droop], [0.30], [0.21], [0.06], [48.71],
    [Virtual inertia], [0.31], [0.22], [0.08], [49.15],
    [Robust droop], [0.17], [0.16], [0.15], [48.98],
    table.cell(fill: luma(233))[Phase-locked adaptation],
    table.cell(fill: luma(233))[*0.29*],
    table.cell(fill: luma(233))[*0.27*],
    table.cell(fill: luma(233))[*0.24*],
    table.cell(fill: luma(233))[*49.44*],
    table.hline(stroke: 0.8pt),
  ),
) <tab:damping>

== When to switch the adaptation off

The adaptation assumes that $tilde(phi)_i$ carries information about power
imbalance. Under a sustained unbalanced fault it does not. The negative
sequence drives a second-harmonic component through the phase-locked loop, the
window in @eq:sensor integrates that component rather than the transient, and
$s_i$ saturates at a value unrelated to the network stiffness. In our
single-line-to-ground tests the gains walked to $m^+$ within 240 ms and stayed
there until the fault cleared, which cost 0.3 Hz of additional nadir on the
post-fault recovery. We therefore freeze the adaptation whenever the measured
negative-sequence magnitude exceeds 4 percent of the positive sequence, a
condition every unit can already evaluate. We report this rather than tuning it
away because it is the condition under which a deployment would be unsafe.
