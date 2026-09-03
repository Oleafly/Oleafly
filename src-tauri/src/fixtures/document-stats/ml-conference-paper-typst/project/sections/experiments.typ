#import "../lib.typ": chart, series, bars, legend

= Experiments <sec:experiments>

== Setup

The base model is a 7B-parameter open-weight decoder. The corpus is a 340k
example mixture of six public-style instruction sources reweighted to a uniform
task marginal: single-turn question answering, multi-turn dialogue, code
editing, summarisation, table reasoning, and constrained generation. Held-out
evaluation is a 1,200 prompt suite scored by pairwise win rate against the
full-data model, plus exact-match accuracy on two reasoning benchmarks that
never appear in the mixture.

Baselines are random subsampling, perplexity filtering (keep the examples the
base model finds hardest), embedding-diversity sampling by farthest-point
traversal, and reward-model top-$k$. All methods see the same budget, the same
optimiser, and the same three seeds. Numbers are means over seeds and the
spread across seeds is under 0.6 points of win rate everywhere except the
5 percent budget, where it reaches 1.9.

== Budget sweep

@tab:main reports the sweep. Alignment-budgeted selection is ahead at every
budget, and the interesting part is where the gap is largest. At 40 percent
every method is close to the full-data model and selection barely matters. At
5 percent the gap to the next best method is 6.4 points, because at that budget
the choice of what to keep is the entire experiment. The 12 percent row is the
operating point we would ship: it recovers 99.1 percent of the full-data win
rate at 12 percent of the tuning cost.

#figure(
  caption: [Win rate against the full-data model (higher is better) and
    exact-match accuracy on two held-out reasoning suites, as a function of the
    retained fraction $beta$. The shaded row is the recommended operating
    point. Full-data reference is 50.0 by construction, with 61.3 and 44.8
    exact match.],
  table(
    columns: (auto, auto, auto, auto, auto, auto, auto),
    align: (left, center, center, center, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      table.cell(rowspan: 2)[Selection rule],
      table.cell(colspan: 4)[win rate at budget $beta$],
      table.cell(rowspan: 2)[EM-A], table.cell(rowspan: 2)[EM-B],
      [5%], [12%], [20%], [40%],
    ),
    table.hline(stroke: 0.4pt),
    [Random subsample], [31.2], [40.7], [45.1], [48.6], [55.4], [40.1],
    [Perplexity filter], [28.9], [39.4], [44.0], [48.1], [54.0], [38.7],
    [Embedding diversity], [35.6], [43.9], [46.8], [49.0], [57.2], [41.6],
    [Reward-model top-$k$], [36.1], [44.8], [47.2], [49.2], [58.1], [42.0],
    table.cell(fill: luma(234))[Alignment-budgeted (ours)],
    table.cell(fill: luma(234))[*42.5*],
    table.cell(fill: luma(234))[*49.6*],
    table.cell(fill: luma(234))[*49.9*],
    table.cell(fill: luma(234))[*50.1*],
    table.cell(fill: luma(234))[*60.7*],
    table.cell(fill: luma(234))[*44.3*],
    table.hline(stroke: 0.9pt),
  ),
) <tab:main>

== Learning curves

@fig:curves plots held-out win rate against optimiser steps at the 12 percent
budget. Two things are visible. The alignment-selected run reaches the win rate
that random subsampling ends at after roughly a third of the steps, which is
the behaviour @eq:descent predicts: a better-aligned subset buys more
full-corpus progress per step. The perplexity-filtered run is the pathological
case discussed in @sec:analysis. It is unstable early, recovers, and then
plateaus below the others, because the examples a base model finds hardest are
disproportionately the ones whose responses are noisy.

#figure(
  chart(
    width: 400pt,
    height: 175pt,
    pad-left: 40pt,
    pad-bottom: 30pt,
    xrange: (0, 6000),
    yrange: (10, 55),
    xticks: ((0, [0]), (1000, [1k]), (2000, [2k]), (3000, [3k]), (4000, [4k]), (5000, [5k]), (6000, [6k])),
    yticks: ((10, [10]), (20, [20]), (30, [30]), (40, [40]), (50, [50])),
    xlabel: [optimiser steps at the 12 percent budget],
    ylabel: [held-out win rate (%)],
    body: (px, py) => {
      series(px, py, (
        (0, 11.0), (400, 20.1), (800, 26.4), (1200, 30.8), (1800, 34.2),
        (2400, 36.6), (3000, 38.1), (3800, 39.4), (4600, 40.2), (5300, 40.6),
        (6000, 40.7),
      ), stroke: (paint: luma(120), thickness: 1pt, dash: "dashed"))
      series(px, py, (
        (0, 11.0), (400, 14.2), (800, 12.6), (1200, 21.9), (1800, 30.1),
        (2400, 34.0), (3000, 36.2), (3800, 37.8), (4600, 38.9), (5300, 39.2),
        (6000, 39.4),
      ), stroke: (paint: rgb("#b07a1e"), thickness: 1pt, dash: "dotted"))
      series(px, py, (
        (0, 11.0), (400, 22.3), (800, 29.8), (1200, 34.6), (1800, 38.9),
        (2400, 41.2), (3000, 42.6), (3800, 43.8), (4600, 44.4), (5300, 44.7),
        (6000, 44.8),
      ), stroke: (paint: rgb("#2f5fa8"), thickness: 1pt, dash: "dash-dotted"))
      series(px, py, (
        (0, 11.0), (400, 27.9), (800, 36.4), (1200, 41.5), (1800, 45.3),
        (2400, 47.1), (3000, 48.2), (3800, 49.0), (4600, 49.4), (5300, 49.6),
        (6000, 49.6),
      ), stroke: (paint: rgb("#8a2b13"), thickness: 1.4pt))
      place(
        dx: px(3050),
        dy: py(28),
        box(fill: white, inset: (x: 4pt, y: 3pt), legend((
          (rgb("#8a2b13"), "solid", [alignment-budgeted (ours)]),
          (rgb("#2f5fa8"), "dash-dotted", [reward-model top-$k$]),
          (luma(120), "dashed", [random subsample]),
          (rgb("#b07a1e"), "dotted", [perplexity filter]),
        ), size: 8pt)),
      )
      place(
        line(
          start: (px(0), py(40.7)),
          end: (px(6000), py(40.7)),
          stroke: (paint: luma(160), thickness: 0.5pt, dash: "loosely-dotted"),
        ),
      )
      place(dx: px(1180), dy: py(52.4), box(fill: white, inset: (x: 3pt, y: 1pt), text(size: 7.5pt, fill: luma(90))[same win rate, 2.4 times fewer steps]))
      place(line(start: (px(950), py(40.7)), end: (px(1150), py(50.9)), stroke: 0.4pt + luma(150)))
    },
  ),
  caption: [Held-out win rate against optimiser steps at $beta = 0.12$. The
    dotted horizontal line is the final win rate of random subsampling. The
    perplexity filter is unstable for the first 800 steps at the full-data
    learning rate, which is the failure mode @eq:steprange describes.],
) <fig:curves>

== Ablations

@fig:ablation removes one component at a time at the 12 percent budget.
Dropping the diversity constraint costs 5.1 points and produces the cluster
collapse described in @sec:intro. Replacing the rank-16 sketch with rank-4
costs 2.3 points, and moving to rank-64 buys 0.2, so the sketch is not the
bottleneck. Using full-network gradients instead of last-layer gradients buys
0.4 points for 11 times the selection cost, which is the trade we decline.
Recomputing the selection every 1,500 steps instead of once buys 0.5 points.

#figure(
  chart(
    width: 400pt,
    height: 150pt,
    pad-left: 40pt,
    pad-bottom: 44pt,
    xrange: (0, 6),
    yrange: (42, 51),
    xticks: (),
    yticks: ((42, [42]), (44, [44]), (46, [46]), (48, [48]), (50, [50])),
    ylabel: [win rate (%)],
    body: (px, py) => {
      bars(px, py, 42, ((0.7, 49.6),), width: 30pt, fill: rgb("#8a2b13").lighten(25%))
      bars(px, py, 42, ((1.75, 44.5), (2.8, 47.3), (3.85, 49.8), (4.9, 50.1)), width: 30pt, fill: luma(205))
      let names = (
        (0.7, [full\ method]),
        (1.75, [no diversity\ constraint]),
        (2.8, [rank-4\ sketch]),
        (3.85, [full-network\ gradients]),
        (4.9, [periodic\ reselection]),
      )
      for (v, label) in names {
        place(dx: px(v) - 34pt, dy: py(42) + 4pt, box(width: 68pt, align(center, text(size: 7.5pt, label))))
      }
      let vals = ((0.7, 49.6), (1.75, 44.5), (2.8, 47.3), (3.85, 49.8), (4.9, 50.1))
      for (v, h) in vals {
        place(dx: px(v) - 17pt, dy: py(h) - 11pt, box(width: 34pt, align(center, text(size: 7.5pt)[#h])))
      }
    },
  ),
  caption: [Ablations at $beta = 0.12$, all with three seeds. The diversity
    constraint is the component that matters; sketch rank and gradient scope
    are not.],
) <fig:ablation>

== Where it fails

We constructed one setting the method should not survive and it did not. When
the held-out task is absent from the training mixture, alignment with the
training gradient selects for the wrong thing: it retains the examples most
representative of the mixture, which are precisely the examples least
informative about the unseen task. Removing all table-reasoning data from the
mixture and evaluating on table reasoning, alignment-budgeted selection at
12 percent scores 3.1 points below random subsampling, while embedding-diversity
sampling scores 1.8 points above it. This is the regime where $alpha(S)$ ceases
to be a proxy for what the practitioner wants, and it should be checked before
the method is used.
