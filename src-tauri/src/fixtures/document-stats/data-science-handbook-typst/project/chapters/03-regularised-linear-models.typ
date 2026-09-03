#import "../lib/style.typ": *

= Regularised Linear Models

The linear model is not a starting point that better methods replace. It is the
only model family in common use whose regularisation is fully transparent: the
penalty is written down, its effect on each coefficient can be computed in
closed form or in one coordinate sweep, and the resulting fit can be audited
term by term. That transparency is why regulated work still runs on it, and it
is why we teach it as a lens on regularisation in general rather than as a
baseline to be beaten.

== Where the penalty acts

Let $X in RR^(n times p)$ have standardised columns and let $y in RR^n$ be
centred. Ordinary least squares minimises $norm(y - X beta)_2^2$, and its
solution is unstable exactly when $X^top X$ is ill conditioned. Ridge regression
adds a quadratic penalty @hoerl1970ridge:

$ hat(beta)^"ridge" (lambda) = op("arg min", limits: #true)_beta norm(y - X beta)_2^2 + lambda norm(beta)_2^2 = (X^top X + lambda I)^(-1) X^top y. $ <eq:ridge>

@eq:ridge is the cleanest illustration of what a penalty buys. Writing the
singular value decomposition $X = U D V^top$ with $D = op("diag")(d_1, dots, d_p)$,
the fitted values become

$ hat(y)^"ridge" = sum_(j=1)^p u_j (d_j^2 / (d_j^2 + lambda)) u_j^top y. $ <eq:ridge-svd>

Each principal direction is shrunk by a factor $d_j^2 slash (d_j^2 + lambda)$
that is near one for well-determined directions and near zero for the directions
where the design carries almost no information. Ridge does not shrink
coefficients uniformly. It shrinks the directions the data cannot resolve, which
is the correct thing to do and which no amount of feature selection accomplishes
by itself.

#definition("Effective degrees of freedom")[
  For a linear smoother $hat(y) = S_lambda y$, the effective degrees of freedom
  is $op("df")(lambda) = op("tr")(S_lambda)$. For ridge this is
  $ op("df")(lambda) = sum_(j=1)^p d_j^2 / (d_j^2 + lambda), $
  which decreases smoothly from $p$ at $lambda = 0$ to $0$ as $lambda -> infinity$.
]

The lasso replaces the quadratic penalty with an $ell_1$ penalty
@tibshirani1996lasso:

$ hat(beta)^"lasso" (lambda) = op("arg min", limits: #true)_beta 1/(2n) norm(y - X beta)_2^2 + lambda norm(beta)_1. $ <eq:lasso>

The change of exponent changes the geometry of the constraint region from a ball
to a polytope, and the corners of a polytope lie on coordinate axes. That is the
whole of the sparsity story: the optimum of a smooth objective over a polytope
lands on a vertex with positive probability, and a vertex has zeroes in it.

#theorem("Coordinate-wise solution of the lasso")[
  With standardised columns, the coordinate descent update for @eq:lasso is
  $ beta_j <- S(1/n sum_(i=1)^n x_(i j) r_i^((-j)), lambda), quad
    S(z, gamma) = op("sign")(z) (|z| - gamma)_+, $ <eq:soft>
  where $r^((-j))$ is the partial residual excluding term $j$. The map is a
  contraction on each coordinate, so cyclic descent converges to the global
  optimum from any starting point.
]

@eq:soft is the soft-thresholding operator, and it is worth internalising
because it explains the lasso's most cited defect. A coefficient whose partial
correlation with the residual falls below $lambda$ is set exactly to zero, and
the remaining coefficients are biased toward zero by exactly $lambda$. The lasso
selects and shrinks with a single parameter, and it cannot tune the two
separately.

== The elastic net and correlated predictors

When two predictors are nearly collinear, the lasso picks one of them essentially
at random and zeroes the other. Which one it picks is unstable under resampling,
which makes the selected set useless as a scientific claim. The elastic net adds
back a quadratic term @zou2005elasticnet:

$ hat(beta)^"net" (lambda, alpha) = op("arg min", limits: #true)_beta 1/(2n) norm(y - X beta)_2^2 + lambda (alpha norm(beta)_1 + (1 - alpha)/2 norm(beta)_2^2). $ <eq:enet>

The quadratic term restores strict convexity, so correlated predictors are
selected or dropped as a group and the solution is unique. @tab:penalties
summarises when each penalty is the right choice.

#figure(
  book-table(
    columns: (auto, 1fr, auto, auto),
    align: (left, left, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Penalty*], [*Use when*], [*Sparse*], [*Grouping*],
    ),
    table.hline(stroke: 0.5pt),
    [Ridge], [$p$ large, all predictors plausibly relevant], [No], [Yes],
    [Lasso], [true model believed sparse, predictors weakly correlated], [Yes], [No],
    [Elastic net $alpha = 0.5$], [sparse truth with correlated blocks], [Yes], [Yes],
    [Adaptive lasso], [selection consistency required], [Yes], [Partial],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Penalty selection. Grouping refers to whether correlated predictors
  enter or leave the model together. The adaptive variant reweights the penalty
  by an initial consistent estimate, which removes the lasso's asymptotic
  selection bias at the cost of a second fit.],
) <tab:penalties>

@fig:path shows the coefficient paths for a six-predictor problem from our
credit-utilisation study as $lambda$ decreases. The two correlated predictors,
`balance_mean` and `balance_p90`, enter together and stay together, which is the
elastic net behaviour that @eq:enet was designed to produce.

#figure(
  chart(9.6cm, 4.6cm, {
    let w = 9.6cm
    let h = 4.6cm
    let paths = (
      (series-a, "balance_mean", ((0, 0.00), (1, 0.00), (2, 0.14), (3, 0.31), (4, 0.44), (5, 0.52), (6, 0.56))),
      (series-b, "balance_p90", ((0, 0.00), (1, 0.00), (2, 0.12), (3, 0.28), (4, 0.40), (5, 0.47), (6, 0.51))),
      (series-c, "utilisation", ((0, 0.00), (1, 0.21), (2, 0.42), (3, 0.58), (4, 0.68), (5, 0.74), (6, 0.77))),
      (series-d, "tenure_months", ((0, 0.00), (1, 0.00), (2, 0.00), (3, -0.09), (4, -0.21), (5, -0.30), (6, -0.35))),
      (luma(45%), "inquiries_6m", ((0, 0.00), (1, 0.00), (2, 0.05), (3, 0.11), (4, 0.15), (5, 0.17), (6, 0.18))),
      (luma(68%), "zip_density", ((0, 0.00), (1, 0.00), (2, 0.00), (3, 0.00), (4, 0.02), (5, 0.05), (6, 0.09))),
    )
    gridlines-y(w, h, 4)
    place(dx: 0pt, dy: py(0, -0.5, 1.0, h), line(length: w, stroke: 0.5pt + luma(60%)))
    for entry in paths {
      place(polyline(
        entry.at(2).map(point => (px(point.at(0), 0, 6, w), py(point.at(1), -0.5, 1.0, h))),
        stroke: 1.2pt + entry.at(0),
      ))
    }
    axes(w, h)
    for value in (-0.5, 0.0, 0.5, 1.0) { ytick(py(value, -0.5, 1.0, h), [#value]) }
    for (i, value) in ("2.0", "1.0", "0.5", "0.2", "0.1", "0.05", "0.02").enumerate() {
      xtick(px(i, 0, 6, w), h, [#value])
    }
    xlabel(w, h, [Penalty strength $lambda$, decreasing])
    ylabel(h, [Standardised coefficient])
    place(dx: 0.35cm, dy: 0.15cm, box(width: 4.4cm, align(left, {
      swatch(series-c, [utilisation])
      linebreak()
      swatch(series-a, [balance_mean])
      linebreak()
      swatch(series-b, [balance_p90])
      linebreak()
      swatch(series-d, [tenure_months])
    })))
    place(dx: 0.35cm, dy: 3.35cm, box(width: 2.9cm, align(left, {
      swatch(luma(45%), [inquiries_6m])
      linebreak()
      swatch(luma(68%), [zip_density])
    })))
  }),
  caption: [Elastic net coefficient paths at $alpha = 0.5$ for the
  credit-utilisation model. The two balance features enter at the same $lambda$
  and move together, the behaviour that distinguishes the elastic net from the
  lasso on correlated blocks.],
) <fig:path>

== Choosing the penalty by prediction error

The penalty is not chosen by looking at the paths. It is chosen by estimating
out-of-sample error, and the standard tool is $K$-fold cross-validation
@stone1974cross. The bias-variance decomposition explains what the minimum is
trading off. For squared error at a fixed input $x_0$,

$ bb(E)[(y_0 - hat(f)(x_0))^2] = sigma^2 + (bb(E)[hat(f)(x_0)] - f(x_0))^2 + op("Var")(hat(f)(x_0)). $ <eq:bv>

The three terms in @eq:bv respond differently to $lambda$. The irreducible term
is flat, the squared bias increases monotonically, and the variance decreases
monotonically. @fig:bv draws all three for the same model, and the minimum of
their sum falls where the variance curve is still falling steeply, which is why
the optimum sits at a visibly biased fit.

#figure(
  chart(9.6cm, 4.4cm, {
    let w = 9.6cm
    let h = 4.4cm
    let grid-x = (0, 1, 2, 3, 4, 5, 6, 7, 8)
    let bias2 = (0.005, 0.010, 0.021, 0.038, 0.064, 0.101, 0.152, 0.221, 0.312)
    let variance = (0.290, 0.216, 0.160, 0.118, 0.086, 0.063, 0.046, 0.034, 0.026)
    let noise = 0.060
    let total = bias2.zip(variance).map(pair => pair.at(0) + pair.at(1) + noise)
    gridlines-y(w, h, 4)
    place(polyline(
      grid-x.map(i => (px(i, 0, 8, w), py(noise, 0, 0.44, h))),
      stroke: (paint: luma(55%), thickness: 0.8pt, dash: "dotted"),
    ))
    place(polyline(
      grid-x.map(i => (px(i, 0, 8, w), py(bias2.at(i), 0, 0.44, h))),
      stroke: 1.2pt + series-b,
    ))
    place(polyline(
      grid-x.map(i => (px(i, 0, 8, w), py(variance.at(i), 0, 0.44, h))),
      stroke: 1.2pt + series-a,
    ))
    place(polyline(
      grid-x.map(i => (px(i, 0, 8, w), py(total.at(i), 0, 0.44, h))),
      stroke: 1.6pt + series-c,
    ))
    let best = 3
    place(
      dx: px(best, 0, 8, w),
      dy: py(total.at(best), 0, 0.44, h),
      line(angle: 90deg, length: h - py(total.at(best), 0, 0.44, h), stroke: (paint: luma(40%), thickness: 0.6pt, dash: "dashed")),
    )
    marker(px(best, 0, 8, w), py(total.at(best), 0, 0.44, h), series-c, radius: 2.4pt)
    place(dx: px(best, 0, 8, w) + 0.14cm, dy: py(total.at(best), 0, 0.44, h) + 0.22cm,
      box(width: 2.4cm, align(left, text(size: 7.5pt, fill: luma(30%))[$lambda^* = 0.13$])))
    axes(w, h)
    for value in (0.0, 0.11, 0.22, 0.33, 0.44) { ytick(py(value, 0, 0.44, h), [#value]) }
    for (i, value) in ("3.0", "1.5", "0.8", "0.4", "0.2", "0.1", "0.05", "0.02", "0.01").enumerate() {
      if calc.rem(i, 2) == 0 { xtick(px(i, 0, 8, w), h, [#value]) }
    }
    xlabel(w, h, [Penalty strength $lambda$, decreasing])
    ylabel(h, [Expected squared error])
    place(dx: 3.1cm, dy: 0.2cm, box(width: 3.2cm, align(left, {
      swatch(series-c, [Total error])
      linebreak()
      swatch(series-a, [Variance])
      linebreak()
      swatch(series-b, [Squared bias])
      linebreak()
      swatch(luma(55%), [Irreducible $sigma^2$])
    })))
  }),
  caption: [Bias-variance decomposition from @eq:bv for the credit-utilisation
  model, averaged over 200 resamples. The minimum at $lambda^* = 0.13$ carries a
  squared bias of 0.038, roughly a third of the variance it removes.],
) <fig:bv>

#remark[
  The one-standard-error rule selects the largest $lambda$ whose cross-validated
  error is within one standard error of the minimum. On @fig:bv that moves the
  choice one grid point left, to $lambda = 0.4$, and roughly halves the number of
  active coefficients. We use it whenever the model will be read by a human,
  and not otherwise.
]

== Fitting the whole path at once

Solving @eq:lasso separately at each $lambda$ wastes most of the work. Pathwise
coordinate descent starts at $lambda_max = max_j |x_j^top y| slash n$, where the
solution is exactly zero, and walks down a log-spaced grid using each solution as
the warm start for the next @friedman2010glmnet. The active set changes by a
handful of coordinates per step, so all but the first fit converge in a few
sweeps.

```python
import numpy as np


def soft_threshold(z, gamma):
    return np.sign(z) * np.maximum(np.abs(z) - gamma, 0.0)


def lasso_path(X, y, n_lambda=60, eps=1e-3, tol=1e-7, max_sweeps=500):
    n, p = X.shape
    lam_max = np.max(np.abs(X.T @ y)) / n
    lambdas = lam_max * np.logspace(0, np.log10(eps), n_lambda)
    col_norms = (X ** 2).sum(axis=0) / n

    beta = np.zeros(p)
    coefficients = np.empty((n_lambda, p))
    for k, lam in enumerate(lambdas):
        for _ in range(max_sweeps):
            largest = 0.0
            for j in range(p):
                if col_norms[j] == 0.0:
                    continue
                residual = y - X @ beta + X[:, j] * beta[j]
                update = soft_threshold(X[:, j] @ residual / n, lam) / col_norms[j]
                largest = max(largest, abs(update - beta[j]))
                beta[j] = update
            if largest < tol:
                break
        coefficients[k] = beta
    return lambdas, coefficients
```

The warm start is the reason this is fast, and it is also a correctness hazard.
Because `beta` carries over between grid points, a bug that leaves a coordinate
stale is invisible at the top of the path and compounds toward the bottom. We
test path solvers by refitting the three smallest $lambda$ values from a cold
start and asserting agreement to within the tolerance, which catches the entire
class of warm-start defects in one assertion.

== What the coefficients do and do not mean

A fitted coefficient in a penalised model is a shrunken partial association. It
is not a causal effect, and under a non-trivial penalty it is not even an
unbiased estimate of the partial association. Three cautions follow, and they
account for most of the misreadings we see in review.

First, coefficient magnitudes are comparable across predictors only because the
columns were standardised, so any report of coefficients must state the scaling
or the comparison is meaningless. Second, a zero in a lasso fit is a statement
about the data at that $lambda$, not about the predictor: the same variable
routinely reappears at the next grid point. Third, standard errors from the
unpenalised fit do not apply, and the bootstrap does not fix this, because the
lasso estimator is not smooth at zero and the bootstrap is inconsistent there.
When intervals are required for a penalised fit, we use the conformal
construction of Chapter 6 rather than any procedure that pretends the penalty
was not applied.
