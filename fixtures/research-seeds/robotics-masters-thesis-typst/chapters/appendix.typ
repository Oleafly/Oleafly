#import "../lib/style.typ": *

= Derivations and Hardware Reference <sec:appendix>

== Closed-form eigenvalues of the patch second moment

The second moment $M$ of @sec:patch is a symmetric two by two matrix

$ M = mat(m_(x x), m_(x y); m_(x y), m_(y y)), $ <eq:moment>

whose eigenvalues follow from the characteristic polynomial without an
iterative solver. Writing $t = m_(x x) + m_(y y)$ for the trace and
$d = m_(x x) m_(y y) - m_(x y)^2$ for the determinant,

$ lambda_(1,2) = t / 2 plus.minus sqrt(t^2 / 4 - d). $ <eq:eigen>

The discriminant is non-negative for any symmetric real matrix, so the square
root is always defined. The principal axis direction is

$ phi = 1 / 2 arctan((2 m_(x y)) / (m_(x x) - m_(y y))), $ <eq:axis>

with the usual quadrant correction when $m_(x x) = m_(y y)$. This is the entire
floating point content of the patch extractor.

== Lower bound on the closure friction estimate

We sketch the argument behind the proposition in @sec:sensing. Let the patch
carry a pressure distribution $p(x)$ with total force $F = integral_Omega p$,
and let the elastomer be linearly elastic in shear with modulus $G$. Under an
imposed tangential displacement $u$, the local shear traction before any slip
is $tau(x) = G u$, uniform over the patch. Local slip begins where
$tau(x) > mu p(x)$, which for a unimodal $p$ occurs first at the boundary,
where $p$ is smallest.

At the instant the stuck fraction first falls below unity, the total shear is

$ S^* = integral_Omega min(G u^*, mu p(x)) dif x < mu integral_Omega p(x) dif x = mu F^*, $ <eq:bound>

with strict inequality whenever $p$ is not constant over $Omega$. Dividing,
$S^* \/ F^* < mu$, so the raw ratio underestimates $mu$. The correction factor
$eta$ in @eq:mu partially compensates, and it is fitted to be conservative: on
the eight reference surfaces the corrected estimate exceeded the reference
value in zero of forty measurements.

== Calibration coefficients

@tab:coeffs lists the fitted coefficients for the two arrays used throughout
the evaluation. The per-taxel gains $gamma_(i j)$ are not reproduced here;
they are stored on the array and have a standard deviation of 0.043 about
unity.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: (left, right, right, left),
    stroke: none,
    inset: (x: 8pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header([*Coefficient*], [*Left finger*], [*Right finger*], [*Unit*]),
    table.hline(stroke: 0.5pt),
    [$alpha$], [0.03412], [0.03388], [N per count],
    [$beta$], [-1.94e-6], [-2.07e-6], [N per count squared],
    [$kappa$], [11.6], [12.4], [counts per K],
    [$T_"ref"$], [24.0], [24.0], [celsius],
    [$eta$], [0.87], [0.87], [dimensionless],
    [$d_"thr"$], [0.42], [0.42], [N per mm squared],
    [Residual, root mean square], [0.87], [0.94], [percent full scale],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    Fitted calibration coefficients for the two TX-40 arrays. The negative
    quadratic coefficient reflects the stiffening of the dielectric spacer at
    high compression.
  ],
) <tab:coeffs>

== Controller gains

The regulator of @eq:regulator was tuned on the machined aluminium block and
held fixed for every trial. @tab:gains lists the values.

#figure(
  table(
    columns: (auto, auto, auto),
    align: (left, right, left),
    stroke: none,
    inset: (x: 9pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header([*Gain*], [*Value*], [*Unit*]),
    table.hline(stroke: 0.5pt),
    [$K_p$], [240], [N per second],
    [$K_i$], [95], [N per second squared],
    [$K_f$], [1.35], [dimensionless],
    [$sigma^*$], [0.85], [dimensionless],
    [Integrator clamp], [$plus.minus 6.0$], [N],
    [Slide force fraction], [0.60], [dimensionless],
    [Force restoration time], [120], [ms],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Regulator and regrasp gains, held constant across all trials.],
) <tab:gains>

== Bill of materials for one finger

A single TX-40 finger comprises the elastomer pad, the dielectric spacer, a
four-layer flexible printed circuit carrying the electrode grid, an aluminium
backing, and the readout assembly. The readout carries a capacitance-to-digital
converter with 24 differential channels, a microcontroller with a
floating-point unit, and a transceiver for the finger bus. Total mass of the
assembled finger is 78 g, of which 31 g is the aluminium backing, which is
retained for thermal stability rather than for stiffness.
