#import "../lib.typ": arrow, elbow, node, proposition

= Phase-Locked Gain Adaptation <sec:controller>

== The measurement we already have

Every grid-forming unit runs a phase-locked loop on its terminal voltage in
order to synchronise its modulation, and the loop carries an internal error

$ tilde(phi)_i (t) = phi_i^"pll" (t) - phi_i^"cmd" (t), $ <eq:phierr>

the difference between the phase the network has settled on at the terminal and
the phase the unit commanded. In steady state $tilde(phi)_i$ is zero. During a
transient it is not, and its magnitude is set by how stiffly the network resists
the unit's attempt to move: the same synchronising coefficient $b_(i j)$ that
appears in @eq:synchcoef. Filtering the square of @eq:phierr over a window of
$T_w$ cycles gives

$ s_i (t) = 1 / T_w integral_(t - T_w)^t tilde(phi)_i^2 (tau) dif tau, $ <eq:sensor>

a scalar that each unit computes from its own registers. @eq:sensor is what the
adaptation consumes. Nothing crosses between units.

== Adaptation law

Let $m_i^0$ be the design gain and let $[m^-, m^+]$ be a certified interval. The
adaptation is a leaky integrator with a projection,

$ dot(m)_i = "proj"_([m^-, m^+]) ( gamma [ (m_i^0 - m_i) + sigma (s_i - s^star) ] ), $ <eq:adapt>

where $sigma > 0$ converts phase-error energy into gain, $s^star$ is the
residual set by measurement noise, and $gamma$ is the adaptation rate. The sign
is the one the physics asks for: a large $s_i$ means the unit is fighting a
stiff network, the corresponding $lambda_k$ is large, and @eq:zeta says the gain
must rise for the damping ratio to be restored. @fig:loop shows the resulting
signal path.

#figure(
  box(width: 100%, height: 128pt, {
    let y1 = 26pt
    let y2 = 92pt
    node((36pt, y1), 58pt, 22pt, text(size: 7pt)[droop law\ @eq:droop])
    node((116pt, y1), 54pt, 22pt, text(size: 7pt)[inverter\ bridge])
    node((192pt, y1), 54pt, 22pt, text(size: 7pt)[network\ @eq:powerflow])
    node((192pt, y2), 54pt, 22pt, text(size: 7pt)[phase-locked\ loop])
    node((116pt, y2), 54pt, 22pt, text(size: 7pt)[window\ @eq:sensor])
    node((36pt, y2), 58pt, 22pt, text(size: 7pt, fill: rgb("#8a2b13"))[adaptation\ @eq:adapt])

    arrow((65pt, y1), (89pt, y1))
    arrow((143pt, y1), (165pt, y1))
    arrow((192pt, y1 + 11pt), (192pt, y2 - 11pt))
    arrow((165pt, y2), (143pt, y2))
    arrow((89pt, y2), (65pt, y2))
    elbow(((36pt, y2 - 11pt), (36pt, y1 + 11pt)), stroke: 0.7pt + rgb("#8a2b13"))
    elbow(((250pt, y1), (250pt, 13pt), (36pt, 13pt), (36pt, y1 - 11pt)))
    place(line(start: (219pt, y1), end: (250pt, y1), stroke: 0.6pt))

    place(dx: 68pt, dy: y1 - 15pt, text(size: 6.5pt)[$omega_i$])
    place(dx: 146pt, dy: y1 - 15pt, text(size: 6.5pt)[$v_i$])
    place(dx: 196pt, dy: 52pt, text(size: 6.5pt)[$v_i^"term"$])
    place(dx: 148pt, dy: y2 - 15pt, text(size: 6.5pt)[$tilde(phi)_i$])
    place(dx: 70pt, dy: y2 - 15pt, text(size: 6.5pt)[$s_i$])
    place(dx: 40pt, dy: 52pt, text(size: 6.5pt, fill: rgb("#8a2b13"))[$m_i$])
    place(dx: 120pt, dy: -1pt, text(size: 6.5pt)[$hat(P)_i$])
  }),
  caption: [Signal path at one unit. The dark return path is the gain
    adaptation of @eq:adapt; it is local to the unit and carries no
    inter-unit communication.],
) <fig:loop>

== Certified damping

The projection in @eq:adapt is what turns an appealing heuristic into a
statement. Because $m_i$ never leaves $[m^-, m^+]$, the closed-loop matrix
$bold(A)(bold(M), bold(X))$ of @eq:statespace never leaves a compact set, and it
is enough to check the corners of that set against the uncertainty of
@eq:uncertainty.

#proposition[
  Let $zeta^star in (0, 1)$ be a target damping ratio and suppose the gain
  interval satisfies

  $ m^+ <= 1 / (4 (zeta^star)^2 tau_f lambda^+_"max"), quad
    m^- >= 1 / (4 tau_f lambda^-). $ <eq:interval>

  Then for every impedance consistent with @eq:uncertainty and every $bold(M)$
  with entries in $[m^-, m^+]$, all eigenvalues of $bold(A)(bold(M), bold(X))$
  other than the uncontrollable mode at the origin satisfy $|arg(-lambda)| <=
  arccos zeta^star$. If in addition the adaptation rate obeys $gamma < 1 slash
  (2 tau_f)$, the time-varying closed loop is exponentially stable.
] <prop:cone>

The first part is a direct consequence of @eq:zeta applied at the extreme
eigenvalue $lambda^+_"max"$. The second part follows from a slow-variation
argument: when $gamma < 1 slash (2 tau_f)$ the gain moves at least twice as
slowly as the fastest closed-loop mode, so the frozen-time eigenvalue condition
transfers to the time-varying system by the standard result for slowly varying
linear systems. What @eq:interval buys in practice is a design procedure with
no free parameters left: the operator states $zeta^star$ and the switching-table
bounds, and the interval follows.
