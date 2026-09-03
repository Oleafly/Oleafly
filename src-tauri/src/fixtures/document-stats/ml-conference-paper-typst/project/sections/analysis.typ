#import "../lib.typ": proposition

= What the Alignment Budget Buys <sec:analysis>

The selection rule is only worth stating if the quantity it maximises has a
consequence. It does, and the consequence is a per-step guarantee on the full
corpus loss rather than on the loss of the selected subset.

Assume $cal(L)(dot; cal(D))$ is $L$-smooth in $theta$, which for a transformer
with layer normalisation and a bounded input distribution holds on any bounded
region of parameter space with a constant that we measure rather than bound.
Write $alpha(S) = lr(⟨g_S, g_(cal(D))⟩) slash (norm(g_S)
norm(g_(cal(D))))$ for the alignment achieved by the subset.

#proposition[
  Let $theta_(+) = theta - eta g_S (theta)$ be one gradient step taken on the
  selected subset. If $alpha(S) >= 1 - epsilon$ and $cal(L)(dot; cal(D))$ is
  $L$-smooth, then

  $ cal(L)(theta_(+); cal(D)) <= cal(L)(theta; cal(D))
    - eta (1 - epsilon) norm(g_S) norm(g_(cal(D)))
    + (eta^2 L) / 2 norm(g_S)^2 . $ <eq:descent>

  In particular the step strictly decreases the full-corpus loss whenever

  $ 0 < eta < (2 (1 - epsilon) norm(g_(cal(D)))) / (L norm(g_S)), $ <eq:steprange>

  and the largest guaranteed decrease, attained at half that step size, is
  $(1 - epsilon)^2 norm(g_(cal(D)))^2 slash (2 L)$.
] <prop:descent>

The proof is the smoothness inequality applied to the step direction $g_S$
rather than $g_(cal(D))$, with the inner product replaced by its lower bound
$(1 - epsilon) norm(g_S) norm(g_(cal(D)))$ from the alignment assumption. The
statement is deliberately weak in one respect and informative in another. It is
weak because it governs a single step from a given $theta$, and the subset was
chosen at $theta_0$. It is informative because the guaranteed decrease
$(1 - epsilon)^2 norm(g_(cal(D)))^2 slash (2 L)$ does not involve $norm(g_S)$ at
all: a subset that is small and well aligned is worth as much per step as a
large one, which is precisely the claim that pruning is not merely tolerable
but neutral.

Two consequences are worth stating explicitly. First, @eq:steprange says that
the admissible learning rate shrinks as alignment degrades, so a badly pruned
corpus is not just slower, it is unstable at the learning rate tuned for the
full data. This matches what we see in @fig:curves, where the perplexity-filter
baseline at a 5 percent budget diverges at the full-data learning rate and only
trains after it is halved. Second, the bound is vacuous when $epsilon >= 1$,
which happens when the subset gradient is orthogonal to the corpus gradient. We
observed this exactly once, in the distribution-shift setting of
@sec:experiments, and the empirical behaviour matched: training on the selected
subset made held-out performance worse than not training at all.
