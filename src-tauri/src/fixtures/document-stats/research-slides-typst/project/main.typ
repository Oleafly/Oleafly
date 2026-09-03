#let ink = rgb("#1b2733")
#let accent = rgb("#1f4e79")
#let accent-soft = rgb("#e4edf6")
#let warm = rgb("#b3521f")
#let moss = rgb("#41684a")
#let muted = rgb("#6d7a88")

#let deck-title = "Halyard: Latency-Aware Replica Placement"

#set document(
  title: "Halyard: Latency-Aware Replica Placement for Geo-Distributed Vector Search",
  author: ("Ingrid Solvberg", "Rafael Amorim-Costa", "Yun-Seo Baek"),
)

#set page(
  width: 254mm,
  height: 142.9mm,
  margin: (x: 18mm, top: 14mm, bottom: 12mm),
  fill: white,
  footer: context {
    set text(size: 9pt, fill: muted)
    grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      deck-title,
      [SDDI 2026 #h(4mm) #counter(page).display()],
    )
  },
)

#set text(font: "New Computer Modern", size: 16pt, fill: ink, lang: "en")
#set par(justify: false, leading: 0.6em, spacing: 0.9em)

#let rule = line(length: 100%, stroke: 0.9pt + accent-soft)

#let slide(title, body) = {
  pagebreak(weak: true)
  block(spacing: 0pt, text(size: 24pt, weight: "bold", fill: accent, title))
  v(1mm)
  block(spacing: 0pt, rule)
  v(4mm)
  body
}

#let section-slide(number, title, subtitle) = page(
  fill: accent,
  margin: (x: 26mm, y: 24mm),
  footer: none,
)[
  #set text(fill: white)
  #v(22mm)
  #text(size: 14pt, fill: accent-soft, tracking: 2pt)[PART #number]
  #v(3mm)
  #text(size: 36pt, weight: "bold", title)
  #v(3mm)
  #text(size: 17pt, fill: accent-soft, subtitle)
]

#let bullets(size: 16pt, gap: 2.4mm, ..items) = {
  set text(size: size)
  for item in items.pos() {
    grid(
      columns: (6mm, 1fr),
      align: (left + top, left + top),
      text(fill: accent)[#sym.bullet],
      item,
    )
    v(gap)
  }
}

#let stat(value, label, tint: accent) = box(
  width: 100%,
  inset: (x: 5mm, y: 4mm),
  radius: 3pt,
  fill: accent-soft,
)[
  #set align(center)
  #text(size: 26pt, weight: "bold", fill: tint, value)
  #v(-2mm)
  #text(size: 12pt, fill: muted, label)
]

#let node(dx, dy, w, h, label, tint: white, edge: ink) = place(
  dx: dx,
  dy: dy,
  box(width: w, height: h, fill: tint, stroke: 0.9pt + edge, radius: 2.5pt, inset: 2.5mm)[
    #set align(center + horizon)
    #set text(size: 12pt)
    #label
  ],
)

#let arrow-right(x, y, len, tint: ink) = {
  place(dx: x, dy: y, line(start: (0pt, 0pt), end: (len, 0pt), stroke: 1pt + tint))
  place(dx: x + len - 3.4pt, dy: y - 2.4pt, polygon(fill: tint, (0pt, 0pt), (3.4pt, 2.4pt), (0pt, 4.8pt)))
}

#let arrow-down(x, y, len, tint: ink) = {
  place(dx: x, dy: y, line(start: (0pt, 0pt), end: (0pt, len), stroke: 1pt + tint))
  place(dx: x - 2.4pt, dy: y + len - 3.4pt, polygon(fill: tint, (0pt, 0pt), (4.8pt, 0pt), (2.4pt, 3.4pt)))
}

#let arrow-up(x, y, len, tint: ink) = {
  place(dx: x, dy: y - len, line(start: (0pt, 0pt), end: (0pt, len), stroke: 1pt + tint))
  place(dx: x - 2.4pt, dy: y - len, polygon(fill: tint, (0pt, 3.4pt), (4.8pt, 3.4pt), (2.4pt, 0pt)))
}

#let caption-at(x, y, body, size: 10pt, tint: muted) = place(
  dx: x,
  dy: y,
  text(size: size, fill: tint, body),
)

#let head-cells(..cells) = cells.pos().map(cell => text(weight: "bold", fill: accent, cell))

#let data-table(columns, align-spec, header, ..rows) = {
  set text(size: 14pt)
  table(
    columns: columns,
    align: align-spec,
    stroke: none,
    inset: (x: 3.5mm, y: 1.9mm),
    fill: (_, y) => if calc.odd(y) { accent-soft.lighten(45%) } else { white },
    table.hline(stroke: 1pt + accent),
    ..head-cells(..header),
    table.hline(stroke: 0.6pt + accent),
    ..rows.pos(),
    table.hline(stroke: 1pt + accent),
  )
}

#page(footer: none, margin: (x: 24mm, top: 22mm, bottom: 14mm))[
  #text(size: 31pt, weight: "bold", fill: accent)[
    Halyard: Latency-Aware Replica Placement \
    for Geo-Distributed Vector Search
  ]
  #v(6mm)
  #line(length: 60mm, stroke: 2pt + warm)
  #v(6mm)
  #text(size: 19pt)[Ingrid Solvberg #h(6mm) Rafael Amorim-Costa #h(6mm) Yun-Seo Baek]
  #v(2mm)
  #text(size: 14pt, fill: muted)[
    Nordfjord Institute for Distributed Systems, Trondheim \
    Department of Computer Science, Wentworth Polytechnic
  ]
  #v(9mm)
  #text(size: 13pt, fill: muted)[
    19th Symposium on Distributed Data Infrastructure #h(4mm) SDDI 2026 #h(4mm) Session 4: Serving Systems
  ]
]

#slide[Agenda][
  #grid(
    columns: (1fr, 1fr),
    column-gutter: 12mm,
    bullets(
      [*The placement bottleneck.* Why a 1.4 billion vector index cannot sit in every region, and why uniform sharding wastes the budget it has.],
      [*The Halyard planner.* Probe telemetry, a capacitated median formulation, and a rounding step that stays feasible.],
    ),
    bullets(
      [*Evaluation.* Nine regions, three production traces, four baselines, a p99 budget of 120 milliseconds.],
      [*Where it breaks.* Churn-heavy deployments and adversarial query skew, plus the guard that detects both.],
    ),
  )
  #v(3mm)
  #align(center, text(size: 13pt, fill: muted)[
    Artifact and trace replayer are described in the paper appendix @solvberg2025halyard.
  ])
]

#section-slide("I", "The Placement Bottleneck", "What a wide-area retrieval deployment actually spends its latency on")

#slide[Retrieval moved to the regions, the index did not][
  #grid(
    columns: (1fr, 1fr, 1fr),
    column-gutter: 7mm,
    stat("1.4 B", "vectors in the production index"),
    stat("9", "serving regions behind one router", tint: warm),
    stat("120 ms", "p99 budget, end to end", tint: moss),
  )
  #v(6mm)
  #bullets(
    [One replica of the index occupies 2.1 terabytes across 176 shards, so no region holds all of it. Regions are provisioned with 40 to 200 gigabytes of local index storage.],
    [A query that misses locally fetches candidate lists across the wide area. Inter-region round trips here range from 11 to 214 milliseconds.],
    [At a 120 millisecond budget, one remote fetch is survivable and two are not @lindqvist2023tailbudget.],
  )
]

#slide[Where the milliseconds go][
  #grid(
    columns: (1.05fr, 1fr),
    column-gutter: 9mm,
    align: (left + top, left + top),
    [
      #data-table(
        (auto, auto, auto),
        (left, right, right),
        ("Stage", "Median", "p99"),
        [Router admission], [0.4 ms], [1.9 ms],
        [Local graph traversal], [6.1 ms], [14.2 ms],
        [Remote candidate fetch], [38.7 ms], [186.4 ms],
        [Rerank and merge], [3.3 ms], [9.8 ms],
        [Response assembly], [0.8 ms], [2.1 ms],
      )
      #v(2mm)
      #text(size: 12pt, fill: muted)[
        41 million queries, mixed commerce trace, uniform placement.
      ]
    ],
    bullets(
      size: 15pt,
      [Remote fetch is 79 percent of the p99 and 4 percent of the arithmetic.],
      [Traversal is already tuned. Further index work moves the median by under 2 milliseconds.],
      [The remaining lever is *which shard sits in which region*, a placement decision rather than a kernel decision.],
      [Probe distributions are skewed and origin dependent: the top 12 percent of shards absorb 61 percent of probes, and the head set differs per region @baek2024probeskew.],
    ),
  )
]

#slide[The problem, stated][
  #set text(size: 15pt)
  Let $R$ be the regions, $S$ the shards, and $x_(s,r) in {0, 1}$ indicate that shard $s$ is replicated in region $r$. With arrival rate $lambda_r$, probe distribution $pi_(s bar r)$, and measured pairwise latency $delta(r, r')$, the expected fetch cost is

  $ C(x) = sum_(r in R) lambda_r sum_(s in S) pi_(s bar r) min_({r' : x_(s,r') = 1}) delta(r, r') . $

  We minimise $C(x)$ subject to a per-region capacity and a durability floor,

  $ sum_(s in S) b_s x_(s,r) <= B_r quad forall r in R , quad quad sum_(r in R) x_(s,r) >= kappa quad forall s in S , $

  where $b_s$ is the on-disk size of shard $s$ and $kappa = 2$ in production. The probe head set is stable for hours, with a rank-correlation half life of 9.4 hours on the commerce trace, which is what makes planning worthwhile.

  #v(3mm)
  #align(center)[
    #box(inset: (x: 5mm, y: 3.5mm), radius: 3pt, fill: accent-soft)[
      #text(size: 16pt)[Feasibility is NP-hard by reduction from capacitated $k$-median @ostrowski2023kmedian.]
    ]
  ]
]

#section-slide("II", "The Halyard Planner", "Telemetry, relaxation, rounding, and a controller that will not thrash")

#slide[System architecture][
  #align(center)[
    #box(width: 214mm, height: 72mm)[
      #node(14mm, 3mm, 42mm, 15mm)[Query router \ #text(size: 9.5pt, fill: muted)[shard fan out]]
      #node(65mm, 3mm, 42mm, 15mm, tint: accent-soft)[Probe sketch \ #text(size: 9.5pt, fill: muted)[per-region counts]]
      #node(116mm, 3mm, 42mm, 15mm, tint: accent-soft)[Placement planner \ #text(size: 9.5pt, fill: muted)[LP and rounding]]
      #node(167mm, 3mm, 42mm, 15mm)[Replica controller \ #text(size: 9.5pt, fill: muted)[rate limited moves]]

      #arrow-right(56mm, 10.5mm, 9mm)
      #arrow-right(107mm, 10.5mm, 9mm)
      #arrow-right(158mm, 10.5mm, 9mm)

      #place(dx: 14mm, dy: 36mm, box(
        width: 195mm,
        height: 30mm,
        stroke: (paint: accent, thickness: 0.9pt, dash: "dashed"),
        radius: 3pt,
      ))
      #caption-at(19mm, 38mm, [Regional replica set], size: 11pt, tint: accent)

      #node(19mm, 46mm, 33mm, 14mm, tint: moss.lighten(85%), edge: moss)[#text(size: 11pt)[Trondheim \ 62 shards]]
      #node(57mm, 46mm, 33mm, 14mm, tint: moss.lighten(85%), edge: moss)[#text(size: 11pt)[Lisbon \ 48 shards]]
      #node(95mm, 46mm, 33mm, 14mm, tint: moss.lighten(85%), edge: moss)[#text(size: 11pt)[Nagoya \ 71 shards]]
      #node(133mm, 46mm, 33mm, 14mm, tint: moss.lighten(85%), edge: moss)[#text(size: 11pt)[Recife \ 39 shards]]
      #node(171mm, 46mm, 33mm, 14mm, tint: moss.lighten(85%), edge: moss)[#text(size: 11pt)[Nairobi \ 44 shards]]

      #arrow-down(188mm, 18mm, 18mm, tint: warm)
      #caption-at(192mm, 23mm, [placement delta], tint: warm)

      #arrow-up(86mm, 36mm, 18mm, tint: moss)
      #caption-at(90mm, 23mm, [probe telemetry], tint: moss)
    ]
  ]
  #align(center, text(size: 12pt, fill: muted)[
    The planner never sits on the query path. It reads counters and writes a placement delta.
  ])
]

#slide[Estimating the probe distribution][
  #grid(
    columns: (1.15fr, 1fr),
    column-gutter: 9mm,
    align: (left + top, left + top),
    [
      #set text(size: 15pt)
      Every router keeps one counter per shard per origin region and folds it into an exponentially weighted estimate at the close of epoch $t$,

      $ hat(pi)^((t))_(s bar r) = (1 - alpha) hat(pi)^((t-1))_(s bar r) + alpha (n^((t))_(s,r)) / (n^((t))_r) . $

      With a five minute epoch and $alpha = 0.15$ the estimator tracks a genuine shift inside four epochs while rejecting single-epoch spikes. The counter array is 176 shards by 9 regions of 8 byte counters, so 12.7 kilobytes per router. Telemetry volume is not a design constraint here.
    ],
    [
      #box(inset: (x: 4.5mm, y: 3.5mm), radius: 3pt, fill: accent-soft)[
        #text(size: 16pt, weight: "bold", fill: accent)[Drift guard]
        #v(2mm)
        #text(size: 14pt)[
          When the symmetric Kullback-Leibler divergence between $hat(pi)^((t))$ and $hat(pi)^((t-8))$ passes 0.35 nats, the planner runs off schedule and the controller move budget doubles for one hour @ferrante2026drift.
        ]
      ]
      #v(3mm)
      #text(size: 14pt, fill: muted)[
        Across 60 days of production traffic the guard fired 14 times: eleven regional failovers and three catalogue reindexes.
      ]
    ],
  )
]

#slide[From relaxation to a feasible placement][
  #grid(
    columns: (1fr, 1fr),
    column-gutter: 9mm,
    align: (left + top, left + top),
    bullets(
      size: 15pt,
      [Relax $x_(s,r) in [0,1]$ and replace the inner minimum with an assignment variable $y_(s,r,r')$. The result is a linear program with $|S| dot |R|^2$ columns, which is 14256 at production scale and solves in 3.1 seconds.],
      [Round by dependent rounding over each shard's column. That preserves $sum_r x_(s,r)$ exactly, so the durability floor is never violated.],
    ),
    bullets(
      size: 15pt,
      [Capacity survives in expectation but not surely, so a repair pass evicts the lowest marginal value shard from any region that overflows.],
      [Evicted shards are quarantined for six hours before they may return, which removes the oscillation an early prototype showed @nakamatsu2024churn.],
    ),
  )
  #v(2mm)
  #align(center)[
    #box(width: 92%, inset: (x: 5mm, y: 4mm), radius: 3pt, stroke: 0.9pt + accent)[
      #text(size: 15pt)[
        *Proposition 1.* The rounded placement $hat(x)$ satisfies $EE[C(hat(x))] <= (1 + epsilon) C^*_"LP"$ with $epsilon <= 2 max_s b_s slash min_r B_r$, and the repair pass adds at most the evicted shards' marginal contribution.
      ]
    ]
  ]
]

#slide[The controller will not thrash][
  #grid(
    columns: (1.15fr, 1fr),
    column-gutter: 9mm,
    align: (left + top, left + top),
    bullets(
      size: 15pt,
      [A placement delta is a set of shard copies and evictions. Moving a 12 gigabyte shard across the wide area costs real bandwidth, so the controller applies at most 4 percent of the replica set per hour.],
      [Moves are ordered by predicted cost reduction per byte transferred, so the first hour of a large delta recovers most of its benefit.],
      [The interesting constraint is bandwidth, not solve time.],
    ),
    data-table(
      (auto, auto),
      (left, right),
      ("Controller parameter", "Value"),
      [Planning epoch], [5 min],
      [Replan interval], [1 h],
      [Move budget], [4 percent per hour],
      [Eviction quarantine], [6 h],
      [Durability floor $kappa$], [2],
      [Drift threshold], [0.35 nats],
    ),
  )
]

#section-slide("III", "Evaluation", "Nine regions, three production traces, four baselines")

#slide[Experimental setup][
  #grid(
    columns: (1fr, 1fr),
    column-gutter: 9mm,
    align: (left + top, left + top),
    [
      #data-table(
        (auto, auto, auto),
        (left, right, right),
        ("Trace", "Queries", "Shard entropy"),
        [Commerce], [41.2 M], [4.11 bits],
        [Documentation], [8.7 M], [5.83 bits],
        [Support chat], [19.4 M], [3.27 bits],
      )
      #v(3mm)
      #text(size: 14pt)[
        Replay runs against nine regions on leased capacity, each holding 40 to 200 gigabytes of index storage. Latency between regions is measured, not modelled.
      ]
    ],
    bullets(
      size: 15pt,
      gap: 2mm,
      [*Uniform.* Each region holds a random capacity-filling subset. The deployed baseline.],
      [*Popularity.* Global shard popularity, blind to query origin @delacroix2025edgeanns.],
      [*Greedy median.* Iterative facility placement with no capacity repair.],
      [*Halyard.* The planner described here.],
    ),
  )
]

#slide[p99 latency against storage budget][
  #let plot-w = 142mm
  #let plot-h = 60mm
  #let x-lo = 40.0
  #let x-hi = 200.0
  #let y-lo = 60.0
  #let y-hi = 320.0
  #let px(v) = plot-w * ((v - x-lo) / (x-hi - x-lo))
  #let py(v) = plot-h * (1.0 - (v - y-lo) / (y-hi - y-lo))
  #let series(points, tint) = {
    let mapped = points.map(p => (px(p.at(0)), py(p.at(1))))
    for i in range(mapped.len() - 1) {
      place(line(start: mapped.at(i), end: mapped.at(i + 1), stroke: 1.6pt + tint))
    }
    for p in mapped {
      place(dx: p.at(0) - 2pt, dy: p.at(1) - 2pt, circle(radius: 2pt, fill: tint, stroke: none))
    }
  }

  #grid(
    columns: (auto, 1fr),
    column-gutter: 6mm,
    align: (left + top, left + top),
    box(width: plot-w + 24mm, height: plot-h + 18mm)[
      #place(dx: 20mm, dy: 2mm, box(width: plot-w, height: plot-h)[
        #for g in (100.0, 140.0, 180.0, 220.0, 260.0, 300.0) {
          place(line(start: (0pt, py(g)), end: (plot-w, py(g)), stroke: 0.5pt + accent-soft))
          place(dx: -18mm, dy: py(g) - 2.4mm, box(width: 15mm)[
            #set align(right)
            #text(size: 10pt, fill: muted)[#calc.round(g)]
          ])
        }
        #place(line(
          start: (0pt, py(120.0)),
          end: (plot-w, py(120.0)),
          stroke: (paint: warm, thickness: 1pt, dash: "dashed"),
        ))
        #caption-at(3mm, py(120.0) + 1.5mm, [120 ms budget], size: 10pt, tint: warm)

        #series(((40.0, 301.0), (80.0, 268.0), (120.0, 241.0), (160.0, 214.0), (200.0, 190.0)), muted)
        #series(((40.0, 258.0), (80.0, 206.0), (120.0, 171.0), (160.0, 149.0), (200.0, 132.0)), moss)
        #series(((40.0, 236.0), (80.0, 181.0), (120.0, 152.0), (160.0, 133.0), (200.0, 121.0)), warm)
        #series(((40.0, 182.0), (80.0, 124.0), (120.0, 98.0), (160.0, 88.0), (200.0, 84.0)), accent)

        #place(line(start: (0pt, 0pt), end: (0pt, plot-h), stroke: 0.9pt + ink))
        #place(line(start: (0pt, plot-h), end: (plot-w, plot-h), stroke: 0.9pt + ink))

        #for t in (40.0, 80.0, 120.0, 160.0, 200.0) {
          place(line(start: (px(t), plot-h), end: (px(t), plot-h + 1.5mm), stroke: 0.9pt + ink))
          place(dx: px(t) - 8mm, dy: plot-h + 2.2mm, box(width: 16mm)[
            #set align(center)
            #text(size: 10pt, fill: muted)[#calc.round(t)]
          ])
        }
        #caption-at(plot-w / 2 - 26mm, plot-h + 8mm, [Per-region index budget (GB)], size: 11pt)
      ])
      #place(dx: 1mm, dy: 2mm + plot-h, rotate(-90deg, origin: left + top, reflow: false, box(width: plot-h)[
        #set align(center)
        #text(size: 11pt, fill: muted)[p99 latency (ms)]
      ]))
    ],
    [
      #v(4mm)
      #grid(
        columns: (6mm, 1fr),
        row-gutter: 3.2mm,
        column-gutter: 2mm,
        align: (center + horizon, left + horizon),
        circle(radius: 2.4pt, fill: accent, stroke: none), text(size: 14pt)[Halyard],
        circle(radius: 2.4pt, fill: warm, stroke: none), text(size: 14pt)[Greedy median],
        circle(radius: 2.4pt, fill: moss, stroke: none), text(size: 14pt)[Popularity],
        circle(radius: 2.4pt, fill: muted, stroke: none), text(size: 14pt)[Uniform],
      )
      #v(5mm)
      #text(size: 14pt)[
        Halyard is the only planner that meets the 120 millisecond budget at or below a 100 gigabyte regional footprint. At 120 gigabytes it clears the budget with 22 milliseconds of headroom.
      ]
    ],
  )
]

#slide[Results across the three traces][
  #data-table(
    (auto, auto, auto, auto, auto, auto),
    (left, right, right, right, right, right),
    ("Placement", "p50 (ms)", "p99 (ms)", "Remote fetch rate", "Recall@10", "Bytes moved per day"),
    [Uniform], [46.2], [241.4], [0.68], [0.947], [0],
    [Popularity], [31.8], [171.0], [0.44], [0.947], [0.4 TB],
    [Greedy median], [27.4], [152.3], [0.37], [0.946], [1.9 TB],
    [Halyard], [18.9], [98.1], [0.19], [0.947], [1.1 TB],
  )
  #v(4mm)
  #grid(
    columns: (1fr, 1fr),
    column-gutter: 9mm,
    bullets(
      size: 15pt,
      [Recall is unchanged by construction. Placement decides where a shard is read from, never whether it is read.],
      [Halyard moves 42 percent fewer bytes per day than greedy median and still reaches a lower p99, because quarantine suppresses repeated round trips.],
    ),
    bullets(
      size: 15pt,
      [Averaged over the three traces at a 120 gigabyte budget. Per-trace numbers are in the paper.],
      [Support chat, the trace with the lowest shard entropy, gains most: p99 falls from 228 to 71 milliseconds.],
    ),
  )
]

#slide[Ablation: which part is doing the work][
  #grid(
    columns: (1.1fr, 1fr),
    column-gutter: 9mm,
    align: (left + top, left + top),
    data-table(
      (auto, auto, auto),
      (left, right, right),
      ("Configuration", "p99 (ms)", "Delta"),
      [Full Halyard], [98.1], [],
      [No per-region probes], [166.9], [+68.8],
      [No dependent rounding], [117.4], [+19.3],
      [No repair pass], [104.2], [+6.1],
      [No quarantine], [102.7], [+4.6],
      [No drift guard], [131.5], [+33.4],
    ),
    bullets(
      size: 15pt,
      [Origin-conditioned probe estimates are the single largest contributor. A globally popular shard is often not the shard a given region needs.],
      [The drift guard matters more than its 14 firings suggest, because those intervals are exactly where a stale plan is worst.],
      [Rounding and repair are correctness machinery first. Their latency contribution is real but secondary.],
    ),
  )
]

#section-slide("IV", "Discussion", "The regimes where a planned placement is the wrong idea")

#slide[Limitations and failure modes][
  #grid(
    columns: (1fr, 1fr),
    column-gutter: 9mm,
    bullets(
      size: 15pt,
      [*High churn.* Above 15 percent of shards rebuilt per day, the move budget goes to reconstruction and the plan never converges. Uniform placement wins that regime.],
      [*Flat probe distributions.* The documentation trace carries 5.83 bits of shard entropy and gains only 14 percent. There is nothing to concentrate.],
    ),
    bullets(
      size: 15pt,
      [*Adversarial skew.* A tenant that deliberately probes cold shards can force evictions. We rate limit per tenant, but we have no principled defence.],
      [*Single objective.* The planner optimises expected fetch cost and ignores egress pricing, which in one region is the dominant operational cost.],
    ),
  )
]

#slide[Takeaways][
  #grid(
    columns: (1fr, 1fr, 1fr),
    column-gutter: 7mm,
    box(inset: (x: 4.5mm, y: 4.5mm), radius: 3pt, fill: accent-soft)[
      #text(size: 18pt, weight: "bold", fill: accent)[Skew is structure]
      #v(2mm)
      #text(size: 14pt)[
        Probe distributions conditioned on the origin region are skewed and stable for hours. That is enough signal to plan against, and global popularity discards it.
      ]
    ],
    box(inset: (x: 4.5mm, y: 4.5mm), radius: 3pt, fill: accent-soft)[
      #text(size: 18pt, weight: "bold", fill: accent)[Planning is cheap]
      #v(2mm)
      #text(size: 14pt)[
        A 14256 column linear program solved once an hour costs 3.1 seconds off the query path and cuts p99 latency by 2.5 times against the deployed baseline.
      ]
    ],
    box(inset: (x: 4.5mm, y: 4.5mm), radius: 3pt, fill: accent-soft)[
      #text(size: 18pt, weight: "bold", fill: accent)[Movement is the cost]
      #v(2mm)
      #text(size: 14pt)[
        Quarantine and a rate limited controller are what make the plan deployable. Without them the planner is correct and useless.
      ]
    ],
  )
  #v(5mm)
  #align(center, text(size: 15pt, fill: muted)[
    Trace replayer, planner, and the nine region latency matrix are released with the paper.
  ])
]

#slide[References][
  #set text(size: 13pt)
  #bibliography("refs.bib", title: none, style: "ieee")
]
