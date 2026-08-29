#import "../lib/style.typ": *

= Experimental Evaluation <sec:evaluation>

== Platform

Trials were run on a seven-axis collaborative arm with a repeatability of
0.03 mm, fitted with a parallel gripper of 85 mm stroke and 140 N maximum grip
force. Both fingers carry a TX-40 array. A structured-light depth camera is
mounted on the forearm and calibrated to the tool frame with a residual of
1.4 mm at the working distance. The host is an eight-core industrial computer;
the revision loop and the quality metric run on it, and the patch extractor and
slip predictor run on the finger processors.

Each trial follows a fixed script. The object is placed by a human operator at
a pose sampled uniformly from a 120 mm by 120 mm region with a random yaw. The
arm acquires one depth image, plans, approaches, closes, lifts 25 cm,
transports 40 cm along a path with a peak lateral acceleration of
1.6 m/s#super[2], returns, and releases. A trial is a success if the object is
released within 15 mm of the target and shows no permanent deformation greater
than 3 mm.

== Object set

The 24 objects are grouped into three classes, listed in @tab:objects. The
friction coefficients were measured against the finger elastomer on an inclined
plane, five repetitions per object.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, center, right, right, right),
    stroke: none,
    inset: (x: 7pt, y: 4.2pt),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Object*], [*Class*], [*Mass (g)*], [*$mu$*], [*Compliance (N/mm)*],
    ),
    table.hline(stroke: 0.5pt),
    [Machined aluminium block], [rigid], [412], [0.31], [--],
    [Cast iron bracket], [rigid], [1380], [0.44], [--],
    [Glass jar, filled], [rigid], [640], [0.28], [--],
    [Steel shaft, 20 mm], [rigid], [520], [0.24], [--],
    [Ceramic mug], [rigid], [310], [0.52], [--],
    [Polycarbonate housing], [rigid], [180], [0.41], [--],
    [Hardwood block], [rigid], [265], [0.58], [--],
    [Printed circuit assembly], [rigid], [95], [0.36], [--],
    table.hline(stroke: 0.3pt),
    [Spring-loaded clamp], [articulated], [140], [0.63], [7.2],
    [Hinged plastic case], [articulated], [225], [0.47], [3.9],
    [Folding ruler], [articulated], [88], [0.55], [11.4],
    [Carabiner with gate], [articulated], [62], [0.29], [24.0],
    [Adjustable wrench], [articulated], [480], [0.38], [18.6],
    [Binder clip, large], [articulated], [41], [0.71], [5.1],
    [Retractable knife], [articulated], [120], [0.44], [15.2],
    [Cable with strain relief], [articulated], [210], [0.66], [2.4],
    table.hline(stroke: 0.3pt),
    [Rice pouch, 620 g], [deformable], [620], [0.34], [1.1],
    [Foam block, open cell], [deformable], [55], [0.88], [0.4],
    [Silicone bulb], [deformable], [78], [0.91], [0.9],
    [Vacuum-packed grain], [deformable], [1400], [0.30], [2.8],
    [Bubble-wrapped part], [deformable], [340], [0.42], [0.7],
    [Fabric bundle, rolled], [deformable], [190], [0.74], [0.3],
    [Squeeze bottle, half full], [deformable], [285], [0.61], [1.6],
    [Paper sack, granular fill], [deformable], [860], [0.36], [1.9],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    The 24-object test set. Compliance is the secant stiffness measured between
    5 N and 15 N of grip force and is undefined for the rigid class. Friction
    is measured against the finger elastomer.
  ],
) <tab:objects>

== Baselines and protocol

Three systems were compared. *Vision-only* uses the same candidate generator,
selects the highest-scoring candidate under the classical point-contact metric
of @eq:qfc with $mu$ fixed at 0.5, and applies a constant grip force of 22 N.
*Reactive* uses the same planner but adds the grip force regulator of
@eq:regulator driven by the slip predictor, without any planner revision.
*Palisade* is the full system.

Each of the 24 objects was grasped 20 times by each of the three systems, for
1440 trials in total. Trial order was randomised across systems to avoid
confounding with wear on the elastomer pads, which were replaced after every
480 trials.

== Results <sec:results>

@tab:main reports the aggregate outcome. Palisade succeeds in 91.4 percent of
trials against 74.2 percent for vision-only and 82.0 percent for reactive
control.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, right, right, right, right),
    stroke: none,
    inset: (x: 9pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header(
      [*System*], [*Rigid*], [*Articulated*], [*Deformable*], [*Overall*],
    ),
    table.hline(stroke: 0.5pt),
    [Vision-only], [0.894], [0.750], [0.583], [0.742],
    [Reactive], [0.931], [0.819], [0.712], [0.820],
    [Palisade], [*0.956*], [*0.897*], [*0.889*], [*0.914*],
    table.hline(stroke: 0.5pt),
    [Palisade, no revision], [0.938], [0.831], [0.735], [0.834],
    [Palisade, no friction estimate], [0.919], [0.844], [0.767], [0.843],
    [Palisade, no deformation penalty], [0.950], [0.888], [0.804], [0.881],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    Success rate by object class over 480 trials per system. The lower block is
    the ablation: each row disables one component of the full system. The
    revision loop is the single most valuable component on the deformable
    class.
  ],
) <tab:main>

The ablation is the informative part. Disabling the revision loop, which
reduces Palisade to a system that estimates friction and patch geometry but
never moves the fingers, costs 15.4 points on the deformable class and recovers
almost exactly the reactive baseline. Disabling the friction estimate and
falling back to $mu = 0.5$ costs 12.2 points on the same class. Disabling the
deformation penalty costs only 8.5 points, but the failures it introduces are
crush events rather than drops, which for many applications are worse.

@fig:byclass shows the per-class breakdown as grouped bars, which makes the
divergence between the systems on the deformable class visible at a glance.

#figure(
  plotbox(8.4cm, 4.4cm, {
    let w = 8.4cm
    let h = 4.4cm
    gridlines(w, h, (0.174, 0.348, 0.522, 0.696, 0.870))
    axes(
      w, h,
      xticks: ((0.167, [rigid]), (0.5, [articulated]), (0.833, [deformable])),
      yticks: ((0.0, [0]), (0.174, [20]), (0.348, [40]), (0.522, [60]), (0.696, [80]), (0.870, [100])),
      xlabel: [object class],
      ylabel: [success rate (percent)],
    )
    let groups = ((0.894, 0.931, 0.956), (0.750, 0.819, 0.897), (0.583, 0.712, 0.889))
    let colors = (luma(72%), accent3, accent)
    for (gi, g) in groups.enumerate() {
      for (bi, v) in g.enumerate() {
        let bw = w * 0.075
        let y = v * 0.87
        let x0 = w * (0.333 * gi + 0.055) + bi * bw
        place(dx: x0, dy: (1.0 - y) * h, rect(width: bw, height: y * h, fill: colors.at(bi), stroke: 0.4pt + luma(25%)))
        place(dx: x0 - 0.25cm + bw / 2, dy: (1.0 - y) * h - 0.36cm, box(width: 0.5cm, align(center, text(size: 6pt)[#calc.round(v * 100)])))
      }
    }
    place(dx: 0.40 * w, dy: 0.01 * h, legendbox((
      ([vision-only], luma(72%)),
      ([reactive], accent3),
      ([Palisade], accent),
    )))
  }),
  caption: [
    Success rate by object class. The three systems are nearly
    indistinguishable on rigid objects, where the point-contact assumption is
    adequate, and separate sharply on deformable objects, where it is not.
  ],
) <fig:byclass>

== Sensitivity to the revision threshold

The decision rule of @sec:planning keeps the active candidate when
$Q_a >= theta Q_b$. We swept $theta$ from 0.5 to 1.0 over 120 trials per
setting on a fixed subset of eight objects, two from each class plus two extra
deformable ones. @fig:theta shows the result. Low thresholds make the planner
conservative and it almost never revises; high thresholds make it revise
constantly and the added contact disturbance costs more than the improved
geometry gains.

#figure(
  plotbox(8.2cm, 4.2cm, {
    let w = 8.2cm
    let h = 4.2cm
    gridlines(w, h, (0.25, 0.5, 0.75, 1.0))
    axes(
      w, h,
      xticks: ((0.0, [0.5]), (0.25, [0.6]), (0.5, [0.7]), (0.75, [0.8]), (1.0, [0.9])),
      yticks: ((0.0, [0.70]), (0.25, [0.78]), (0.5, [0.85]), (0.75, [0.92]), (1.0, [1.00])),
      xlabel: [revision threshold $theta$],
      ylabel: [success rate],
    )
    let succ = ((0.0, 0.28, 0.045), (0.25, 0.44, 0.042), (0.5, 0.66, 0.038),
                (0.75, 0.88, 0.034), (1.0, 0.61, 0.050))
    let line-pts = succ.map(p => (p.at(0), p.at(1)))
    series(w, h, line-pts, color: accent, thickness: 1.2pt)
    errbars(w, h, succ, color: accent)
    dots(w, h, line-pts, color: accent)

    let revisions = ((0.0, 0.05), (0.25, 0.14), (0.5, 0.30), (0.75, 0.52), (1.0, 0.86))
    series(w, h, revisions, color: accent2, thickness: 1.0pt, dash: "dashed")
    squares(w, h, revisions, color: accent2)

    place(dx: 0.03 * w, dy: 0.70 * h, legendbox((
      ([success rate], accent),
      ([revisions per trial, scaled], accent2),
    )))
  }),
  caption: [
    Success rate and revision frequency against the revision threshold
    $theta$, with standard error over 120 trials per setting. The optimum at
    $theta = 0.8$ revises roughly once per two trials.
  ],
) <fig:theta>

== Timing

@tab:timing gives the measured latency of each stage. The budget that matters
is the revision cycle, which must complete inside 16.7 ms to sustain 60 Hz.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: (left, right, right, left),
    stroke: none,
    inset: (x: 8pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header([*Stage*], [*Mean (ms)*], [*99th pct (ms)*], [*Processor*]),
    table.hline(stroke: 0.5pt),
    [Taxel scan and calibration], [5.6], [5.6], [finger],
    [Patch extraction], [2.4], [3.1], [finger],
    [Divergence and stuck fraction], [1.1], [1.6], [finger],
    [Transport to host], [0.7], [1.4], [bus],
    [Candidate transport and split], [3.2], [4.9], [host],
    [Incremental hull, 24 candidates], [5.8], [9.8], [host],
    [Decision rule], [0.1], [0.2], [host],
    table.hline(stroke: 0.5pt),
    [Revision cycle total], [*9.8*], [*15.4*], [],
    [Vision stage, once per grasp], [312], [478], [host],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    Latency breakdown. The finger stages overlap with the host stages, so the
    revision cycle total counts only the host path plus transport.
  ],
) <tab:timing>

== Failure analysis <sec:failures>

Palisade failed in 41 of 480 trials. @tab:failures classifies them.

#figure(
  table(
    columns: (auto, auto, auto),
    align: (left, right, left),
    stroke: none,
    inset: (x: 8pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header([*Failure mode*], [*Count*], [*Dominant class*]),
    table.hline(stroke: 0.5pt),
    [Friction changed faster than estimate], [14], [deformable],
    [Patch narrower than four taxels], [11], [articulated],
    [Approach blocked after reset], [7], [rigid],
    [Crush during force restoration], [3], [deformable],
    [Object rotated out of gripper], [4], [articulated],
    [Perception, no candidate found], [2], [rigid],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Classification of the 41 Palisade failures.],
) <tab:failures>

The first mode is the most interesting and the least tractable. The silicone
bulb and the squeeze bottle both accumulate a thin film of moisture from
handling over the course of a session, and their friction falls by as much as
0.2 within twenty trials. The closure estimate of @eq:mu is recomputed on every
grasp, so it tracks the change, but it is measured at the beginning of closure
and the film redistributes under load. In eight of the fourteen cases the
estimator reported a value that was correct at the moment of measurement and
wrong by lift-off.

The second mode is a limitation of the representation rather than of the
estimator. A carabiner gate or a folding ruler edge presents a contact that is
genuinely one-dimensional, and no amount of patch conditioning helps when the
patch has no second dimension. The planner correctly recognises these as line
contacts and prefers alternatives, but on four of the articulated objects there
is no alternative within the gripper stroke.

The remaining modes are mundane. The reset action retracts along the approach
axis, and in seven trials that axis was blocked by an object placed after the
depth image was acquired, which is an artefact of our single-image protocol
rather than of the planner.
