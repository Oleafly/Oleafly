#set page(paper: "a4")
#set heading(numbering: "1.")

= Convergence of projected gradient descent

We study the decay of $ epsilon(t) = alpha e^(-lambda t) + beta $ under
projected updates with step size $ eta in (0, 1\/L] $.

== Assumptions

The objective is $mu$-strongly convex and has $L$-Lipschitz gradients, so
the iterates satisfy

$ "err"_(n+1) <= (1 - eta mu) "err"_n $

== Conclusion

Every claim here is standard; the fixture exists so the *Typst* reader
has headings, prose emphasis, and math to carry across.

#bibliography("refs.bib")
