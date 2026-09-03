#import "../lib/style.typ": *

= Tactile Sensing and Contact State Estimation <sec:sensing>

== Sensor construction

Each finger carries a TX-40 array: a 40 by 30 grid of capacitive taxels on a
1.2 mm pitch, covering an active area of 48 mm by 36 mm. The stack is shown in
@fig:sensor. A polyurethane elastomer pad of Shore A 30 hardness and 3.0 mm
thickness forms the contact surface. Beneath it sits a compliant dielectric
spacer of 0.6 mm, then the sensing electrode layer, then a ground plane bonded
to an aluminium backing that also carries the readout application-specific
integrated circuit.

Each taxel measures three quantities. The normal capacitance responds to
compression of the dielectric spacer. Two differential capacitances between
interdigitated electrode fingers respond to lateral displacement of the
elastomer relative to the substrate, which is the shear channel. The array is
scanned in 24 row groups at 4.32 kHz, giving a full-field rate of 180 Hz.

#figure(
  box(width: 12.6cm, height: 6.35cm, {
    place(dx: 0.4cm, dy: 0.90cm, rect(width: 6.2cm, height: 0.85cm, fill: luma(78%), stroke: 0.6pt))
    place(dx: 0.4cm, dy: 1.75cm, rect(width: 6.2cm, height: 0.32cm, fill: luma(92%), stroke: 0.6pt))
    place(dx: 0.4cm, dy: 2.07cm, rect(width: 6.2cm, height: 0.26cm, fill: rgb("#cfd9e6"), stroke: 0.6pt))
    place(dx: 0.4cm, dy: 2.33cm, rect(width: 6.2cm, height: 0.20cm, fill: luma(55%), stroke: 0.6pt))
    place(dx: 0.4cm, dy: 2.53cm, rect(width: 6.2cm, height: 0.75cm, fill: luma(70%), stroke: 0.6pt))

    for i in range(9) {
      place(
        dx: 0.75cm + i * 0.66cm,
        dy: 2.10cm,
        rect(width: 0.34cm, height: 0.20cm, fill: accent, stroke: none),
      )
    }

    place(dx: 1.6cm, dy: 0.66cm, curve(
      stroke: (paint: accent2, thickness: 1.1pt),
      curve.move((0cm, 0.30cm)),
      curve.line((0.6cm, 0.26cm)),
      curve.line((1.3cm, 0.10cm)),
      curve.line((2.1cm, 0.10cm)),
      curve.line((2.8cm, 0.26cm)),
      curve.line((3.4cm, 0.30cm)),
    ))
    varrow(2.9cm, 0.36cm, 0.28cm, color: accent2)
    varrow(3.7cm, 0.36cm, 0.28cm, color: accent2)
    lbl(2.0cm, 0.02cm, text(fill: accent2, size: 7pt)[applied load], w: 2.6cm)

    seg(6.6cm, 1.32cm, 6.85cm, 1.32cm, color: luma(40%))
    seg(6.6cm, 1.91cm, 6.85cm, 1.91cm, color: luma(40%))
    seg(6.6cm, 2.20cm, 6.85cm, 2.20cm, color: luma(40%))
    seg(6.6cm, 2.43cm, 6.85cm, 2.43cm, color: luma(40%))
    seg(6.6cm, 2.90cm, 6.85cm, 2.90cm, color: luma(40%))

    lbl(6.95cm, 1.18cm, [elastomer pad, 3.0 mm], w: 5.2cm, al: left)
    lbl(6.95cm, 1.77cm, [dielectric spacer, 0.6 mm], w: 5.2cm, al: left)
    lbl(6.95cm, 2.06cm, [electrode layer, 1.2 mm pitch], w: 5.2cm, al: left)
    lbl(6.95cm, 2.29cm, [ground plane], w: 5.2cm, al: left)
    lbl(6.95cm, 2.76cm, [aluminium backing and readout], w: 5.2cm, al: left)

    place(dx: 0.4cm, dy: 3.95cm, rect(width: 5.6cm, height: 1.90cm, stroke: 0.6pt + luma(45%)))
    for r in range(6) {
      for c in range(9) {
        let v = calc.max(0.0, 1.0 - calc.sqrt(
          calc.pow((c - 4) / 3.6, 2) + calc.pow((r - 2.5) / 2.2, 2),
        ))
        place(
          dx: 0.52cm + c * 0.60cm,
          dy: 4.03cm + r * 0.29cm,
          rect(width: 0.50cm, height: 0.24cm, fill: luma(100% - v * 62%), stroke: 0.25pt + luma(70%)),
        )
      }
    }
    lbl(0.4cm, 5.95cm, text(size: 7pt)[measured normal field during a 12 N grasp], w: 5.6cm)

    lbl(6.30cm, 4.02cm, [Pressure decays from the patch centre. The], w: 6.0cm, al: left)
    lbl(6.30cm, 4.36cm, [outer ring reaches its friction limit first,], w: 6.0cm, al: left)
    lbl(6.30cm, 4.70cm, [which is the signal the slip predictor of], w: 6.0cm, al: left)
    lbl(6.30cm, 5.04cm, [Section 5.1 consumes.], w: 6.0cm, al: left)
  }),
  caption: [
    Cross-section of the TX-40 finger stack and a measured normal field. The
    elastomer pad spreads a concentrated load over roughly nine taxels, which
    is what makes an area contact model recoverable at this pitch.
  ],
) <fig:sensor>

@tab:sensor lists the sensor specification as characterised on a calibration
rig with a six-axis reference load cell.

#figure(
  table(
    columns: (auto, auto, auto),
    align: (left, right, left),
    stroke: none,
    inset: (x: 8pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header([*Property*], [*Value*], [*Unit*]),
    table.hline(stroke: 0.5pt),
    [Taxel count per finger], [1200], [taxels],
    [Taxel pitch], [1.20], [mm],
    [Active area], [48 by 36], [mm],
    [Full-field update rate], [180], [Hz],
    [Normal force range], [0.05 to 40.0], [N],
    [Normal force resolution], [0.012], [N],
    [Shear force range], [0.0 to 12.0], [N],
    [Shear resolution], [0.031], [N],
    [Root mean square noise, normal], [0.008], [N],
    [Thermal drift, 20 to 40 celsius], [0.9], [percent per K],
    [Hysteresis at 20 N cycling], [2.4], [percent full scale],
    [End-to-end latency, contact to host], [7.8], [ms],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    TX-40 specification measured on the calibration rig. Latency includes the
    scan period, the on-sensor filter, and transport over the finger bus.
  ],
) <tab:sensor>

== Calibration

The raw capacitance $c_(i j)$ of taxel $(i, j)$ is converted to a normal
pressure through a per-taxel affine model with a quadratic correction for the
elastomer stiffening at high load:

$ p_(i j) = alpha_(i j) (c_(i j) - c_(i j)^0) + beta_(i j) (c_(i j) - c_(i j)^0)^2, $ <eq:calib>

where $c_(i j)^0$ is the unloaded reference recorded at the start of every
trial. Fitting $alpha_(i j)$ and $beta_(i j)$ for 2400 taxels individually
would require an impractical calibration campaign. Instead we fit a single pair
of coefficients per array and a multiplicative per-taxel gain $gamma_(i j)$
recovered from a single uniform pressure exposure in a fluid bladder, so that
$alpha_(i j) = gamma_(i j) alpha$ and $beta_(i j) = gamma_(i j) beta$. The
residual after this two-stage fit has a root mean square of 0.9 percent of full
scale, against 4.7 percent for a shared-gain model.

Thermal drift is compensated by a first-order model on the array temperature
$T$ reported by an on-board sensor,

$ c_(i j)^0(T) = c_(i j)^0(T_"ref") + kappa (T - T_"ref"), $ <eq:drift>

with $kappa$ fitted once per array. Uncompensated drift over a thirty-minute
session shifts the apparent contact area by up to eleven percent, which is
enough to move a marginal grasp across the decision boundary of the planner.

== Contact patch extraction <sec:patch>

Let $P = {p_(i j)}$ be the calibrated pressure field. We define the contact set
as the connected component of taxels above a pressure threshold $p_min$ that
contains the maximum of the field. The threshold is set to five times the root
mean square noise, which is 0.06 N per taxel.

#definition("contact patch")[
  The contact patch $Omega$ is the largest four-connected set of taxels
  $(i, j)$ with $p_(i j) >= p_min$, together with its area-weighted centroid
  $macron(x)$ and second moment $M$ defined by
  $ macron(x) = 1 / F sum_((i,j) in Omega) p_(i j) x_(i j), quad
    M = 1 / F sum_((i,j) in Omega) p_(i j) (x_(i j) - macron(x)) (x_(i j) - macron(x))^top, $
  where $F = sum_(Omega) p_(i j)$ is the total normal force.
]

The eigenvalues $lambda_1 >= lambda_2$ of $M$ give the principal extents of the
patch, and their ratio is a scale-free measure of elongation. A patch with
$lambda_2$ below the square of the taxel pitch is effectively a line contact,
which resists no torque about the line and is the geometry the planner must
avoid.

The boundary descriptor is the ordered list of taxels in $Omega$ that have at
least one four-neighbour outside $Omega$. We store it as a run-length encoding
along rows, which keeps the representation under 200 bytes and lets the
divergence computation of @sec:slip walk the boundary without a second pass
over the field.

#remark[
  The whole extraction, from raw capacitance to patch descriptor, runs in
  integer arithmetic on the readout processor. The only floating point
  operations are the two eigenvalue computations, which are closed form for a
  two by two symmetric matrix. Measured worst-case execution time over a
  million frames is 3.1 ms, comfortably inside the 5.6 ms frame period.
]

== Friction estimation during closure

The planner needs the friction coefficient $mu$ available inside the patch. A
dedicated probing motion would measure it directly but would cost time and
would risk displacing the object. We instead exploit the fact that closure is
never perfectly symmetric. As the fingers converge, small pose errors induce a
tangential load that the contact resists elastically until part of the patch
breaks away.

Let $F$ be the total normal force and $S$ the total shear magnitude, both
integrated over the patch. During the elastic phase $S$ grows with the imposed
displacement while the stuck fraction stays at unity. When the stuck fraction
first drops below 0.95 we record the pair $(F^*, S^*)$ and estimate

$ hat(mu) = S^* / F^* dot 1 / eta, $ <eq:mu>

where $eta = 0.87$ is a geometric correction that accounts for the pressure
distribution inside the patch not being uniform, calibrated once against
inclined-plane measurements on eight reference surfaces. Over those eight
surfaces the estimate has a mean absolute error of 0.061 in $mu$, against a
spread of 0.24 to 0.91 in the reference values.

#proposition("conservatism of the closure estimate")[
  If the pressure distribution inside $Omega$ is unimodal and the elastomer is
  linearly elastic in shear, then $hat(mu)$ as defined in @eq:mu is a lower
  bound on the Coulomb coefficient of the surface pair, since partial slip at
  the patch boundary begins strictly before the whole patch reaches its
  friction limit.
]

The bound is the property we want. A planner that underestimates friction
selects a grasp with more redundancy than necessary. A planner that
overestimates it selects one that fails on lift-off, and the failure is not
recoverable once the object is airborne.
