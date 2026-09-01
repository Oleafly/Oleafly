= System Model <sec:model>

== Network and unit conventions

Consider an island of $N$ grid-forming units connected by a network whose
branches are predominantly inductive, so that each branch $(i,j)$ is described
by a reactance $X_(i j)$ and a small resistance that we absorb into a damping
term. Unit $i$ imposes a voltage of magnitude $V_i$ at phase $delta_i$. Under
the standard quasi-stationary assumption the active power injected by unit $i$
is

$ P_i = sum_(j in cal(N)_i) (V_i V_j) / X_(i j) sin(delta_i - delta_j), $ <eq:powerflow>

where $cal(N)_i$ is the set of units electrically adjacent to $i$. The
conventional droop law sets the imposed frequency from the measured power,

$ dot(delta)_i = omega_i = omega^star - m_i hat(P)_i, quad
  tau_f dot(hat(P))_i = P_i - hat(P)_i, $ <eq:droop>

with $tau_f$ the power-measurement filter constant, $omega^star$ the nominal
frequency, and $m_i > 0$ the active-power droop gain that this paper adapts.

== Small-signal form

Linearising @eq:powerflow about an equilibrium $delta^0$ gives the Laplacian of
the network weighted by the synchronising coefficients

$ b_(i j) = (V_i^0 V_j^0) / X_(i j) cos(delta_i^0 - delta_j^0), $ <eq:synchcoef>

which we collect into $bold(L)(bold(X)) in RR^(N times N)$. Writing $bold(x) =
(Delta delta^top, Delta hat(P)^top)^top$ and $bold(M) = "diag"(m_1, ..., m_N)$,
the island obeys

$ dot(bold(x)) = underbrace(mat(
    bold(0), -bold(M);
    bold(L)(bold(X)) slash tau_f, -bold(I) slash tau_f
  ), bold(A)(bold(M), bold(X))) bold(x). $ <eq:statespace>

Two facts about @eq:statespace drive everything that follows. First, the
uniform-gain case $bold(M) = m bold(I)$ decouples: the eigenvalues of
$bold(A)$ are the roots of $s^2 + s slash tau_f + m lambda_k slash tau_f$ for
each eigenvalue $lambda_k$ of $bold(L)$, so the damping ratio of mode $k$ is

$ zeta_k = 1 / (2 sqrt(m tau_f lambda_k)). $ <eq:zeta>

Damping therefore falls as the square root of the product $m lambda_k$. Second,
$lambda_k$ scales inversely with the branch reactances, so a reconfiguration
that halves $X$ doubles $lambda_k$ and costs a factor $sqrt(2)$ of damping at
fixed gain. A gain chosen for the weakest network is badly detuned for the
strongest, and the reverse.

== Uncertainty set

We do not assume the operator knows $bold(X)$. We assume only a certified
interval on the algebraic connectivity of the weighted Laplacian,

$ lambda_2 (bold(L)(bold(X))) in [lambda^-, lambda^+], quad
  lambda_N (bold(L)(bold(X))) <= lambda^+_"max", $ <eq:uncertainty>

which an operator can obtain from the switching table without solving a power
flow for every configuration. The testbed of @sec:evaluation has $lambda^+ slash
lambda^- = 4.1$.
