= Introduction <sec:intro>

Instruction tuning works, and nobody agrees on why a particular corpus works
better than another one. The published recipes are lists of filters: drop
examples below a length threshold, deduplicate by $n$-gram overlap, score every
response with a reward model and keep the top decile, resample until the task
mixture looks balanced. Each filter is defensible on its own and none of them
answers the question that matters, which is whether the retained subset moves
the model in the direction the full corpus would have moved it.

That question has an operational form. Fine-tuning from a pretrained
initialisation $theta_0$ is a descent process on the full-corpus loss, and to
first order the only thing a training step consumes is the corpus gradient
$g_(cal(D)) (theta_0)$. A subset $S$ is useful exactly to the extent that
$g_S (theta_0)$ points the same way. Selection therefore has a natural
objective: maximise alignment subject to a budget. This paper takes that
objective literally and shows that it is both computable at corpus scale and
strong enough to support a guarantee.

The obvious objection is that alignment is a first-order criterion applied to a
process that runs for thousands of steps, and that the gradient at $theta_0$
stops describing the trajectory almost immediately. We agree, and it turns out
to matter less than it should. In @sec:experiments we recompute the selection
at four points during training and find that the retained set changes by under
9 percent after the first recomputation, which suggests the alignment structure
of an instruction corpus is a property of the corpus rather than of the
optimisation state.

The less obvious objection is that a subset can maximise alignment by
duplicating the single most representative cluster in the corpus. It can, and
in our first implementation it did: unconstrained selection at a 5 percent
budget returned a set that was 71 percent single-turn question answering. The
diversity constraint in @eq:selection is what stops this, and @sec:experiments
reports the ablation that removes it.

*Contributions.*
We state a selection objective for instruction tuning in terms of gradient
alignment under a diversity constraint (@sec:method); we give a rank-16
last-layer sketch that makes the objective computable in a single forward and
partial backward pass per example (@sec:method); we prove a descent guarantee
that turns the alignment budget into a statement about the full-corpus loss
(@prop:descent); and we evaluate against four selection baselines at six
budgets on a 340k example mixture, including the distribution-shift case where
the method fails (@sec:experiments).
