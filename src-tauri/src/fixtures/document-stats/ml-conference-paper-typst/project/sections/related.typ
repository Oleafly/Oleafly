= Related Work <sec:related>

*Data selection for fine-tuning.* The instruction-tuning literature converged
early on the claim that quality dominates quantity @zhou2023lima, and most of
the follow-up work operationalises quality with a learned scorer: a reward
model, a stronger model acting as a judge, or a classifier trained on human
preference labels @chen2024alpagasus. These methods are effective and they are
opaque, in the sense that the scorer's notion of quality is whatever its
training data encoded. Our objective is stated in terms of the optimisation the
practitioner is about to run, which makes it auditable and makes the failure
case in @sec:experiments predictable rather than surprising.

*Coresets and gradient matching.* Selecting a subset whose gradient approximates
the full gradient is the classical coreset construction, and the submodular
formulation with greedy guarantees is standard @mirzasoleiman2020craig. Two
things are different here. The classical setting selects for every step of
training and pays that cost repeatedly; we select once at initialisation and
show empirically that the selection is stable. And the classical setting
matches gradients in the full parameter space, which is infeasible at 7B
parameters; the last-layer sketch of @sec:method is what makes the objective
computable, and the Spearman correlation we report is the evidence that it is
not lossy in the way that matters.

*Influence functions.* Influence-based selection asks which training examples
change a specific held-out prediction @koh2017influence. That is a sharper
question than ours and a more expensive one, since it needs an inverse-Hessian
vector product per query point. It is also targeted: influence is defined
relative to a chosen evaluation set. Our criterion is untargeted by design,
which is its advantage when the evaluation is unknown and its weakness in
exactly the distribution-shift setting we report.

*Sketching.* The rank-16 sketch is a straight application of
Johnson-Lindenstrauss @achlioptas2003database. We note only that the
ranking-preservation property we actually need is weaker than the norm
preservation the bound provides, which is why $r = 16$ suffices where the bound
would ask for hundreds.

*Compute-optimal training.* Work on scaling laws frames the data question as
how many tokens to train on rather than which ones @hoffmann2022chinchilla. The
two questions interact: a pruned corpus changes the effective token budget, and
our 12 percent operating point is a statement about the second question that
assumes the first has already been answered.
