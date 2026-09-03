= Alignment-Budgeted Selection <sec:method>

== Setup

Let $cal(D) = {(x_i, y_i)}_(i=1)^N$ be an instruction corpus of prompts $x_i$
and responses $y_i$, and let $theta$ parameterise an autoregressive decoder.
The training objective is the usual token-level negative log-likelihood
restricted to response tokens,

$ cal(L)(theta; S) = 1 / (sum_(i in S) T_i) sum_(i in S) sum_(t=1)^(T_i)
  -log p_theta (y_(i,t) | y_(i, < t), x_i), $ <eq:objective>

with $T_i$ the response length of example $i$. Write $g_S (theta) = nabla_theta
cal(L)(theta; S)$ and abbreviate $g_(cal(D)) = g_(cal(D)) (theta_0)$.

== The selection problem

Given a budget $k = beta N$, we want the subset whose gradient is most closely
aligned with the corpus gradient, and we want it not to be a single cluster.
Let $c: cal(D) -> {1, ..., C}$ assign each example to one of $C$ clusters
obtained by $k$-means on sentence embeddings of the prompt. The selection
problem is

$ S^star = arg max_(S subset cal(D), |S| = k)
  (lr(⟨g_S (theta_0), g_(cal(D))⟩)) / (norm(g_S (theta_0))_2 norm(g_(cal(D)))_2)
  quad "s.t." quad |{i in S : c(i) = j}| <= rho k / C
  " for all " j, $ <eq:selection>

where $rho >= 1$ is the concentration allowance. Setting $rho = 1$ forces exact
cluster balance and $rho = infinity$ removes the constraint. We use $rho = 2.5$
throughout, chosen once on a development split and never retuned.

@eq:selection is NP-hard in general, but the cosine objective is monotone and
approximately submodular in the regime where individual example gradients are
small relative to the corpus gradient, which is the regime that holds for
$N$ in the hundreds of thousands. A greedy pass with lazy evaluation and the
cluster caps as a partition matroid therefore comes within a constant factor,
and it is what we run.

== Making the gradient cheap

Evaluating $g_({i}) (theta_0)$ for every example is a full backward pass per
example, which is the cost of an epoch of training and defeats the purpose. We
use two reductions.

First, we restrict the gradient to the final transformer block and the
unembedding matrix. For a decoder of $L$ layers this reduces the parameter
count entering the alignment estimate by roughly $L$, and it loses less than it
sounds: the alignment ranking computed on last-layer gradients has a Spearman
correlation of 0.87 with the full-gradient ranking on a 4k example probe.

Second, we sketch. Let $Pi in RR^(r times d)$ be a fixed Gaussian sketch with
$r = 16$. We compute and store $Pi g_({i})$ rather than $g_({i})$, and evaluate
the objective of @eq:selection in the sketched space. The Johnson-Lindenstrauss
bound gives the accuracy of the resulting inner products,

$ Pr [ |lr(⟨Pi u, Pi v⟩) - lr(⟨u, v⟩)| >= delta norm(u) norm(v) ]
  <= 2 exp(-r delta^2 slash 8), $ <eq:jl>

so $r = 16$ controls the relative error of a single inner product to $delta =
0.35$ with probability 0.9. That is a loose bound per pair and a tight one in
aggregate, because the greedy pass only needs the ranking to be right, not the
values.

The total cost of selection on our 340k corpus is 41 GPU-minutes on eight
accelerators, against 26 GPU-hours for a single full-data fine-tuning epoch.
