= Conclusion <sec:conclusion>

Instruction-tuning corpora are pruned by heuristics because the field lacked a
selection objective that was both stateable and computable. Gradient alignment
under a diversity constraint is one. It is stateable because @eq:selection is a
single optimisation problem rather than a pipeline of filters, computable
because the last-layer sketch reduces selection to 41 GPU-minutes on a 340k
corpus, and consequential because @prop:descent turns the alignment budget into
a bound on the full-corpus loss decrease per step.

The empirical picture is that the objective matters most where the budget is
tightest. At a 40 percent budget every selection rule we tried lands within a
point of the full-data model, and the choice of rule is not worth the
engineering. At 5 percent it is worth 6.4 points of win rate. The operating
point we recommend, 12 percent, sits where the curve is still steep and the
cost saving is already large.

The limitation is the one we constructed and confirmed. Alignment with the
training gradient is a proxy for usefulness only when the evaluation
distribution is inside the training mixture. When it is not, the criterion
selects against the examples that would have helped, and a diversity-driven
rule is the better default. Making the objective aware of a small held-out
probe set without collapsing into targeted influence estimation is the obvious
next step, and it is what we are working on.
