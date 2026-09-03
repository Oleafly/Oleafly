#let ink = rgb("#16202b")
#let accent = rgb("#33475b")
#let rule-tint = rgb("#8fa3b5")
#let muted = rgb("#5f6f7e")
#let bar-tint = rgb("#4a6f8a")
#let bar-alt = rgb("#8a5a3c")

#let full-name = "Naomi A. Ferreira-Kwan"

#set document(title: full-name + " curriculum vitae", author: full-name)

#set page(
  paper: "a4",
  margin: (x: 18mm, top: 16mm, bottom: 15mm),
  footer: context {
    set text(size: 8.5pt, fill: muted)
    grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      [#full-name #h(2mm) curriculum vitae #h(2mm) revised August 2026],
      [#counter(page).display() of #context counter(page).final().first()],
    )
  },
)

#set text(font: "Libertinus Serif", size: 10pt, fill: ink, lang: "en")
#set par(justify: false, leading: 0.55em, spacing: 0.62em)

#let mono(body, size: 8.5pt) = text(font: "DejaVu Sans Mono", size: size, body)

#let section(title) = {
  v(3.6mm)
  block(breakable: false, spacing: 0pt)[
    #text(size: 10.5pt, weight: "bold", fill: accent, tracking: 1.3pt, upper(title))
    #v(0.9mm)
    #line(length: 100%, stroke: 0.7pt + rule-tint)
  ]
  v(1.9mm)
}

#let dated(date, body) = {
  block(breakable: false, spacing: 0pt, grid(
    columns: (28mm, 1fr),
    column-gutter: 4mm,
    align: (right + top, left + top),
    text(size: 9pt, fill: muted, date),
    body,
  ))
  v(1.9mm)
}

#let pub(tag, body) = {
  block(spacing: 0pt, grid(
    columns: (9mm, 1fr),
    column-gutter: 2.5mm,
    align: (right + top, left + top),
    text(size: 8.6pt, fill: muted, tag),
    text(size: 9.4pt, body),
  ))
  v(1.5mm)
}

#let role(title, place, detail) = [
  #text(weight: "bold", title) #h(1mm) #text(fill: muted)[|] #h(1mm) #place
  #linebreak()
  #text(size: 9.2pt, fill: muted, detail)
]

#let cv-table(columns, align-spec, header, ..rows) = {
  set text(size: 9.2pt)
  table(
    columns: columns,
    align: align-spec,
    stroke: none,
    inset: (x: 2.6mm, y: 1.5mm),
    fill: (_, y) => if calc.odd(y) { rgb("#f2f5f8") } else { white },
    table.hline(stroke: 0.7pt + accent),
    ..header.map(cell => text(weight: "bold", fill: accent, size: 8.8pt, upper(cell))),
    table.hline(stroke: 0.5pt + rule-tint),
    ..rows.pos(),
    table.hline(stroke: 0.7pt + accent),
  )
}

#block(spacing: 0pt)[
  #text(size: 22pt, weight: "bold", fill: accent, full-name)
  #v(1.2mm)
  #text(size: 10.5pt, fill: muted)[
    Associate Professor of Applied Mathematics and Geoscience #h(2mm) | #h(2mm)
    Carrowmore Institute of Technology
  ]
  #v(2mm)
  #line(length: 100%, stroke: 1.1pt + accent)
]
#v(2.2mm)

#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 5mm,
  align: (left + top, left + top, left + top),
  [
    #text(size: 9pt, fill: muted, weight: "bold")[Office] \
    #text(size: 9.2pt)[
      Cregan Building, Room 4.18 \
      Department of Applied Mathematics \
      Carrowmore Institute of Technology \
      Dunmore D14 RX72
    ]
  ],
  [
    #text(size: 9pt, fill: muted, weight: "bold")[Contact] \
    #mono(size: 7.9pt)[n.ferreira-kwan\@carrowmore.example.edu] \
    #text(size: 9.2pt)[Telephone +353 1 555 0148] \
    #text(size: 9.2pt)[Fax +353 1 555 0102]
  ],
  [
    #text(size: 9pt, fill: muted, weight: "bold")[Online] \
    #mono(size: 7.9pt)[orcid 0009-0004-2718-3310] \
    #mono(size: 7.9pt)[cryosphere.example.edu/nfk] \
    #text(size: 9.2pt)[Languages: English, Portuguese, Twi, German (reading)]
  ],
)

#section[Research profile]

#set par(justify: true)
Inverse problems and uncertainty quantification for ice-sheet dynamics. My group develops
gradient-based calibration methods for Stokes and shallow-shelf ice flow models, with an emphasis
on making basal friction inversions honest about what the observations can and cannot constrain.
Recent work covers adjoint-consistent discretisations for grounding-line migration, dimension-robust
Markov chain Monte Carlo for spatially distributed friction fields, and the propagation of calibration
uncertainty into century-scale sea-level projections. I maintain #mono[Sedgewick], an open source
adjoint framework for finite element ice flow that is used by four modelling groups.
#set par(justify: false)

#section[Education]

#dated("2013 to 2017")[
  #role([PhD, Applied Mathematics], [Rivenhall University, Coleraine], [
    Thesis: Adjoint methods for basal friction inversion in marine ice sheets. \
    Advisor: Prof. Dorothea Klemens-Ravel. Committee: Prof. Silas Marchetti, Prof. Ayo Adebanjo. \
    Awarded the Rivenhall Faculty Medal for the best dissertation in the mathematical sciences.
  ])
]

#dated("2011 to 2013")[
  #role([MSc, Computational Science, with distinction], [Rivenhall University, Coleraine], [
    Dissertation: Preconditioners for the Stokes system on anisotropic ice geometries.
  ])
]

#dated("2008 to 2011")[
  #role([BSc, Mathematics and Physics, first class honours], [University of Achimota, Accra], [
    Final year project: Spectral methods for the shallow water equations on the sphere.
  ])
]

#section[Academic appointments]

#dated("2023 to present")[
  #role([Associate Professor], [Carrowmore Institute of Technology], [
    Department of Applied Mathematics and Geoscience. Director of the Cryosphere Inversion Group,
    currently four doctoral students, two postdoctoral researchers, and one research software engineer.
  ])
]

#dated("2020 to 2023")[
  #role([Assistant Professor], [Carrowmore Institute of Technology], [
    Tenure track appointment. Founded the Cryosphere Inversion Group in 2020.
  ])
]

#dated("2019 to 2020")[
  #role([Visiting Scientist], [Meridian Polar Modelling Centre, Hobart], [
    Six month visit funded by the Southern Ocean Fellowship. Coupled ice sheet and ocean calibration.
  ])
]

#dated("2017 to 2020")[
  #role([Postdoctoral Research Fellow], [Institute for Environmental Computation, Uppsala], [
    Host: Prof. Ingrid Halvorsen. Dimension-robust sampling for distributed parameter fields.
  ])
]

#dated("2016")[
  #role([Research Intern], [National Centre for Climate Simulation, Grenoble], [
    Three month placement on adjoint code generation for finite element ice flow solvers.
  ])
]

#section[Peer-reviewed journal articles]

#pub("J21")[
  Ferreira-Kwan, N. A., Oyelaran, T., and Halvorsen, I. (2026). Adjoint-consistent treatment of
  grounding-line migration in finite element ice flow. #emph[Journal of Computational Geophysics],
  58(3), 411 to 442.
]
#pub("J20")[
  Delacroix, M., Ferreira-Kwan, N. A., and Sundqvist, P. (2026). Observation error correlations
  dominate basal friction uncertainty in West Antarctic inversions.
  #emph[Cryosphere Modelling and Analysis], 14(1), 77 to 104.
]
#pub("J19")[
  Ferreira-Kwan, N. A. and Adebanjo, A. (2025). Dimension-robust Metropolis sampling for
  spatially distributed friction fields. #emph[SIAM Journal on Uncertainty Quantification],
  13(2), 588 to 617.
]
#pub("J18")[
  Nkemelu, C., Ferreira-Kwan, N. A., and Bergström, L. (2025). Century-scale sea-level projections
  are more sensitive to calibration priors than to emissions pathway below 2.5 degrees of warming.
  #emph[Earth System Dynamics Letters], 9(4), 301 to 329.
]
#pub("J17")[
  Ferreira-Kwan, N. A. (2025). What an ice-sheet inversion can and cannot identify: a resolution
  analysis. #emph[Inverse Problems in the Geosciences], 41(2), 105 to 138.
]
#pub("J16")[
  Sundqvist, P., Ferreira-Kwan, N. A., and Klemens-Ravel, D. (2024). Mesh-independent
  preconditioning for anisotropic Stokes ice flow. #emph[Numerische Mathematik der Geowissenschaften],
  33(6), 921 to 954.
]
#pub("J15")[
  Ferreira-Kwan, N. A., Marchetti, S., and Oyelaran, T. (2024). Sedgewick: an open adjoint framework
  for finite element ice flow. #emph[Journal of Open Research Software in the Geosciences], 7, 22.
]
#pub("J14")[
  Oyelaran, T. and Ferreira-Kwan, N. A. (2024). Calibrating sliding laws against surface velocity
  alone leaves the exponent unidentified. #emph[Cryosphere Modelling and Analysis], 12(3), 245 to 271.
]
#pub("J13")[
  Ferreira-Kwan, N. A., Halvorsen, I., and Nkemelu, C. (2023). Hierarchical priors for basal
  topography under sparse radar coverage. #emph[Journal of Computational Geophysics], 55(5), 733 to 768.
]
#pub("J12")[
  Bergström, L., Ferreira-Kwan, N. A., and Delacroix, M. (2023). Coupled ice and ocean calibration
  with asynchronous observation windows. #emph[Ocean and Ice Modelling], 19(2), 158 to 191.
]
#pub("J11")[
  Ferreira-Kwan, N. A. and Klemens-Ravel, D. (2022). A discrete adjoint for the shallow-shelf
  approximation with a moving grounding line. #emph[SIAM Journal on Scientific Computing],
  44(4), B812 to B841.
]
#pub("J10")[
  Adebanjo, A., Ferreira-Kwan, N. A., and Sundqvist, P. (2022). Multilevel Monte Carlo for
  ensemble sea-level projections. #emph[Statistics and Computing in the Environmental Sciences],
  32, 88.
]
#pub("J09")[
  Ferreira-Kwan, N. A. (2021). Regularisation choices are prior choices: a case study in
  friction inversion. #emph[Inverse Problems in the Geosciences], 37(1), 44 to 71.
]
#pub("J08")[
  Halvorsen, I. and Ferreira-Kwan, N. A. (2021). Preconditioned Crank-Nicolson sampling on
  function spaces with non-Gaussian priors. #emph[Bernoulli Methods and Applications], 27(3), 1902 to 1931.
]
#pub("J07")[
  Ferreira-Kwan, N. A., Nkemelu, C., and Marchetti, S. (2020). Surface elevation change as a
  weak constraint on englacial rheology. #emph[Cryosphere Modelling and Analysis], 8(4), 512 to 540.
]
#pub("J06")[
  Ferreira-Kwan, N. A. and Halvorsen, I. (2020). Automatic differentiation through nonlinear
  solvers in ice flow codes. #emph[ACM Transactions on Mathematical Software], 46(3), 31.
]
#pub("J05")[
  Marchetti, S., Ferreira-Kwan, N. A., and Klemens-Ravel, D. (2019). Anisotropic mesh adaptation
  for marine ice sheet margins. #emph[Journal of Computational Geophysics], 51(2), 209 to 238.
]
#pub("J04")[
  Ferreira-Kwan, N. A. (2019). Identifiability of two-parameter sliding laws from synthetic
  observations. #emph[Inverse Problems in the Geosciences], 35(3), 288 to 312.
]
#pub("J03")[
  Ferreira-Kwan, N. A. and Klemens-Ravel, D. (2018). Adjoint-based basal friction inversion for
  marine terminating glaciers. #emph[Journal of Glaciological Computation], 12(1), 33 to 66.
]
#pub("J02")[
  Klemens-Ravel, D., Ferreira-Kwan, N. A., and Adebanjo, A. (2017). Block preconditioners for
  the Glen-flow Stokes system. #emph[Numerische Mathematik der Geowissenschaften], 26(4), 601 to 630.
]
#pub("J01")[
  Ferreira-Kwan, N. A. (2016). Spectral discretisation of the shallow water equations on the
  cubed sphere with variable bathymetry. #emph[Applied Numerical Mathematics], 108, 145 to 163.
]

#section[Refereed conference proceedings]

#pub("C08")[
  Ferreira-Kwan, N. A. and Oyelaran, T. (2026). Checkpointing strategies for long adjoint runs in
  transient ice flow. In #emph[Proceedings of the Conference on Computational Methods in
  Environmental Science], 118 to 133.
]
#pub("C07")[
  Nkemelu, C. and Ferreira-Kwan, N. A. (2025). Scalable ensemble calibration on heterogeneous
  clusters. In #emph[Proceedings of the International Symposium on High Performance Scientific
  Computing], 402 to 417.
]
#pub("C06")[
  Ferreira-Kwan, N. A., Sundqvist, P., and Bergström, L. (2024). A benchmark suite for grounding-line
  adjoints. In #emph[Proceedings of the Workshop on Verification in Earth System Modelling], 55 to 70.
]
#pub("C05")[
  Delacroix, M. and Ferreira-Kwan, N. A. (2023). Reduced-order surrogates for ice-sheet emulation
  under distribution shift. In #emph[Proceedings of the Conference on Machine Learning for the
  Physical Sciences], 771 to 786.
]
#pub("C04")[
  Ferreira-Kwan, N. A. (2022). Teaching adjoints without tears: an undergraduate module design.
  In #emph[Proceedings of the Symposium on Computational Science Education], 44 to 55.
]
#pub("C03")[
  Adebanjo, A. and Ferreira-Kwan, N. A. (2021). Variance reduction in multilevel ensembles of
  ice-sheet simulations. In #emph[Proceedings of the Conference on Uncertainty in Computational
  Science], 289 to 304.
]
#pub("C02")[
  Ferreira-Kwan, N. A. and Halvorsen, I. (2019). Sampling in high dimensions with geometry-aware
  proposals. In #emph[Proceedings of the Conference on Bayesian Computation], 611 to 626.
]
#pub("C01")[
  Ferreira-Kwan, N. A. (2017). An adjoint for grounding-line flux with a moving boundary.
  In #emph[Proceedings of the Workshop on Numerical Methods for Free Boundary Problems], 90 to 103.
]

#section[Preprints and manuscripts under review]

#pub("P03")[
  Ferreira-Kwan, N. A., Bergström, L., and Oyelaran, T. (2026). Calibration transfer between
  ice-sheet models does not preserve projection spread. Under review at
  #emph[Nature Computational Geoscience]. Preprint #mono[arXiv-like:2608.11204].
]
#pub("P02")[
  Sundqvist, P. and Ferreira-Kwan, N. A. (2026). Goal-oriented error estimation for sea-level
  functionals. Under review at #emph[SIAM Journal on Scientific Computing].
]
#pub("P01")[
  Nkemelu, C., Delacroix, M., and Ferreira-Kwan, N. A. (2026). A reproducibility audit of
  eleven published basal friction inversions. Under review at #emph[Geoscientific Model Development
  and Practice].
]

#section[Book chapters]

#pub("B02")[
  Ferreira-Kwan, N. A. (2025). Inverse problems in glaciology. In D. Klemens-Ravel and
  A. Adebanjo, editors, #emph[Handbook of Computational Cryosphere Science], chapter 9, 271 to 318.
  Marlowe Academic Press.
]
#pub("B01")[
  Ferreira-Kwan, N. A. and Halvorsen, I. (2022). Adjoint methods. In S. Marchetti, editor,
  #emph[Numerical Methods for Geophysical Flows], chapter 14, 405 to 448. Rivenhall University Press.
]

#section[Publication and citation record]

#let bar-w = 5mm
#let gap = 2.6mm
#let step = bar-w + gap
#let axis-w = 11 * step - gap
#let base = 24mm
#let years = ("15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25")
#let counts = (1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 5)
#let cites = (2, 9, 24, 51, 88, 141, 210, 296, 388, 494, 571)

#grid(
  columns: (1fr, 1fr),
  column-gutter: 6mm,
  align: (left + top, left + top),
  box(width: 100%, height: 33mm)[
    #for i in range(years.len()) {
      let h = base * (counts.at(i) / 6.0)
      place(dx: i * step, dy: base - h, rect(width: bar-w, height: h, fill: bar-tint, stroke: none))
      place(dx: i * step, dy: base + 0.8mm, box(width: bar-w)[
        #set align(center)
        #text(size: 7.2pt, fill: muted, years.at(i))
      ])
      place(dx: i * step, dy: base - h - 3.6mm, box(width: bar-w)[
        #set align(center)
        #text(size: 7.2pt, fill: bar-tint, str(counts.at(i)))
      ])
    }
    #place(dy: base, line(start: (0pt, 0pt), end: (axis-w, 0pt), stroke: 0.6pt + muted))
    #place(dy: 29mm, text(size: 7.6pt, fill: muted)[Refereed outputs per year, 2015 to 2025])
  ],
  box(width: 100%, height: 33mm)[
    #let scale = base / 600.0
    #let pts = range(years.len()).map(i => (i * step + bar-w / 2, base - scale * cites.at(i)))
    #for i in range(pts.len() - 1) {
      place(line(start: pts.at(i), end: pts.at(i + 1), stroke: 1.2pt + bar-alt))
    }
    #for p in pts {
      place(dx: p.at(0) - 1.2pt, dy: p.at(1) - 1.2pt, circle(radius: 1.2pt, fill: bar-alt, stroke: none))
    }
    #place(dy: base, line(start: (0pt, 0pt), end: (axis-w, 0pt), stroke: 0.6pt + muted))
    #for i in (0, 5, 10) {
      place(dx: i * step, dy: base + 0.8mm, box(width: bar-w)[
        #set align(center)
        #text(size: 7.2pt, fill: muted, years.at(i))
      ])
    }
    #place(dx: pts.last().at(0) - 12mm, dy: pts.last().at(1) - 4.4mm, text(size: 7.2pt, fill: bar-alt)[571])
    #place(dy: 29mm, text(size: 7.6pt, fill: muted)[Cumulative citations, 571 total])
  ],
)

#v(1.2mm)
#set par(justify: true)
#text(size: 9.2pt)[
  Twenty-one refereed journal articles, eight conference papers, two book chapters, three
  manuscripts under review. Aggregate citation count 571, h-index 14, i10-index 19, as recorded by
  the institutional bibliometric service in July 2026. Six articles are first or sole authored in the
  top quartile of their field, and software artefacts accompany fourteen of the twenty-one journal
  articles, each archived with a persistent identifier.
]
#set par(justify: false)

#section[Grants and contracts]

#cv-table(
  (auto, 1fr, auto, auto, auto),
  (left, left, center, right, left),
  ("Period", "Award", "Role", "Value", "Sponsor"),
  [2025 to 2029], [Identifiability limits of ice-sheet calibration], [PI], [EUR 1,840,000], [European Frontier Council],
  [2024 to 2027], [Sedgewick: sustaining an open adjoint framework], [PI], [EUR 420,000], [Research Software Trust],
  [2023 to 2026], [Coupled ice and ocean uncertainty propagation], [Co-I], [EUR 2,110,000], [National Climate Programme],
  [2022 to 2025], [Doctoral training in computational geoscience], [Co-I], [EUR 3,300,000], [Higher Education Authority],
  [2021 to 2023], [Multilevel ensembles for sea-level projection], [PI], [EUR 268,000], [Carrowmore Seed Fund],
  [2019 to 2020], [Southern Ocean Visiting Fellowship], [Fellow], [EUR 74,000], [Meridian Polar Foundation],
)

#v(2mm)
#text(size: 9pt, fill: muted)[
  Total awarded as principal investigator: EUR 2,602,000. Total on which named as investigator:
  EUR 8,012,000. Two proposals declined in 2024, both resubmitted and one subsequently funded.
]

#section[Teaching]

#cv-table(
  (auto, 1fr, auto, auto, auto),
  (left, left, center, center, center),
  ("Term", "Course", "Level", "Enrolment", "Evaluation"),
  [Every spring since 2021], [MA4210 Numerical Methods for Partial Differential Equations], [MSc], [38 to 52], [4.6 / 5],
  [Every autumn since 2020], [MA3105 Scientific Computing in Practice], [BSc year 3], [95 to 130], [4.4 / 5],
  [Alternate autumns since 2022], [MA5340 Inverse Problems and Data Assimilation], [MSc and PhD], [14 to 21], [4.8 / 5],
  [2021, 2023, 2025], [GE6011 Computational Cryosphere Field School], [PhD], [12], [not rated],
  [2020 to 2022], [MA1020 Linear Algebra], [BSc year 1], [210 to 260], [4.1 / 5],
)

#v(2.4mm)
#text(size: 9.6pt, weight: "bold", fill: accent)[Research supervision]
#v(1.4mm)

#dated("2022 to present")[
  #text(size: 9.4pt)[
    *Doctoral students.* Tunde Oyelaran (submitting 2026, adjoint checkpointing),
    Chiamaka Nkemelu (2027, ensemble calibration at scale), Petra Sundqvist (2028, goal-oriented
    error estimation), Marius Delacroix (2029, surrogate transferability). One completed:
    Lena Bergström, PhD 2025, now a research scientist at the Meridian Polar Modelling Centre.
  ]
]

#dated("2020 to present")[
  #text(size: 9.4pt)[
    *Postdoctoral researchers.* Dr. Ayo Adebanjo (2023 to present), Dr. Silas Marchetti
    (2021 to 2024, now Assistant Professor at Rivenhall University).
  ]
]

#dated("2020 to present")[
  #text(size: 9.4pt)[
    *Masters and undergraduate.* Nineteen MSc dissertations and eleven final year projects.
    Four MSc students continued to doctoral study.
  ]
]

#section[Selected invited talks]

#dated("2026")[
  #text(size: 9.4pt)[
    Plenary, International Congress on Inverse Problems, Valparaiso. "What an inversion cannot tell you."
  ]
]
#dated("2025")[
  #text(size: 9.4pt)[
    Keynote, European Cryosphere Modelling Workshop, Innsbruck. "Priors, regularisers, and the
    projections that follow from them."
  ]
]
#dated("2024")[
  #text(size: 9.4pt)[
    Departmental colloquium, Institute for Environmental Computation, Uppsala.
  ]
]
#dated("2023")[
  #text(size: 9.4pt)[
    Invited lecture series, Summer School on Computational Geophysics, Trieste. Three lectures.
  ]
]

#section[Service and professional activity]

#dated("2025 to present")[
  #text(size: 9.4pt)[
    *Associate Editor*, #emph[Inverse Problems in the Geosciences]. Handling roughly thirty
    manuscripts per year.
  ]
]
#dated("2024 to present")[
  #text(size: 9.4pt)[
    *Editorial board member*, #emph[Cryosphere Modelling and Analysis].
  ]
]
#dated("2023 to present")[
  #text(size: 9.4pt)[
    *Chair*, Departmental Research Committee, Carrowmore Institute of Technology. Responsible for
    internal seed funding and the annual research review.
  ]
]
#dated("2022 to present")[
  #text(size: 9.4pt)[
    *Steering committee*, Open Cryosphere Software Consortium. Co-author of the consortium's
    reproducibility guidance for published inversions.
  ]
]
#dated("2021 to 2024")[
  #text(size: 9.4pt)[
    *Programme committee*, Conference on Uncertainty in Computational Science (2021 to 2024),
    Conference on Machine Learning for the Physical Sciences (2023, 2024).
  ]
]
#dated("Ongoing")[
  #text(size: 9.4pt)[
    *Reviewing.* SIAM Journal on Scientific Computing, SIAM Journal on Uncertainty Quantification,
    Journal of Computational Physics, Geoscientific Model Development and Practice,
    ACM Transactions on Mathematical Software. Panel member for the National Climate Programme
    in 2023 and 2025.
  ]
]
#dated("Ongoing")[
  #text(size: 9.4pt)[
    *Outreach.* Coordinator of the Carrowmore Winter Coding Clinic, a free four week programme in
    scientific computing for secondary school teachers, running since 2022 with 140 participants
    to date.
  ]
]

#section[Software and data]

#dated("2019 to present")[
  #text(size: 9.4pt)[
    *Sedgewick.* Adjoint framework for finite element ice flow. Roughly 61,000 lines of Python and
    C++, 780 stars, adopted by four modelling groups. Lead maintainer.
  ]
]
#dated("2023 to present")[
  #text(size: 9.4pt)[
    *Grounding-line adjoint benchmark.* Seven reference problems with analytic or
    high-resolution reference solutions, archived under a persistent identifier.
  ]
]
#dated("2021 to present")[
  #text(size: 9.4pt)[
    *Carrowmore inversion archive.* Posterior ensembles for eleven published basal friction
    inversions, 1.9 terabytes, released under a permissive licence.
  ]
]

#section[Honours]

#dated("2026")[#text(size: 9.4pt)[Carrowmore President's Award for Research Excellence.]]
#dated("2024")[#text(size: 9.4pt)[Early Career Prize, Society for Computational Geoscience.]]
#dated("2022")[#text(size: 9.4pt)[Best paper, Conference on Uncertainty in Computational Science.]]
#dated("2017")[#text(size: 9.4pt)[Rivenhall Faculty Medal for the best dissertation in the mathematical sciences.]]
#dated("2011")[#text(size: 9.4pt)[University of Achimota Vice-Chancellor's Prize in Mathematics.]]

#section[References]

#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 6mm,
  [
    #text(size: 9.4pt)[
      *Prof. Dorothea Klemens-Ravel* \
      Rivenhall University, Coleraine \
      #mono(size: 7.7pt)[d.klemens-ravel\@rivenhall.example.edu]
    ]
  ],
  [
    #text(size: 9.4pt)[
      *Prof. Ingrid Halvorsen* \
      Institute for Environmental Computation, Uppsala \
      #mono(size: 7.7pt)[i.halvorsen\@iec.example.se]
    ]
  ],
  [
    #text(size: 9.4pt)[
      *Prof. Ayo Adebanjo* \
      University of Achimota, Accra \
      #mono(size: 7.7pt)[a.adebanjo\@achimota.example.gh]
    ]
  ],
)
