#let ink = rgb("#181f27")
#let accent = rgb("#123a5c")
#let accent-mid = rgb("#3f7196")
#let card-bg = rgb("#f1f5f9")
#let warm = rgb("#a8431c")
#let ember = rgb("#c9761f")
#let moss = rgb("#3d6b4a")
#let violet = rgb("#5b4a86")
#let muted = rgb("#5e6b78")

#set document(
  title: "Thermal Runaway Onset in Sodium-Ion Cells",
  author: ("Rosalind Ekwueme-Vasquez", "Hadrien Bouchard", "Milena Trajkovska"),
)

#set page(
  width: 841mm,
  height: 1189mm,
  margin: 30mm,
  fill: white,
)

#set text(font: "New Computer Modern", size: 19pt, fill: ink, lang: "en")
#set par(justify: true, leading: 0.6em, spacing: 0.8em)

#let card(title, body, tint: card-bg, bar: accent) = block(
  width: 100%,
  fill: tint,
  radius: 5pt,
  inset: (left: 11mm, right: 11mm, top: 7mm, bottom: 8mm),
  stroke: (left: 6pt + bar),
)[
  #text(size: 27pt, weight: "bold", fill: bar, title)
  #v(2mm)
  #line(length: 100%, stroke: 1.4pt + bar.lighten(55%))
  #v(3.5mm)
  #body
]

#let node(dx, dy, w, h, label, tint: white, edge: accent, thickness: 1.5pt) = place(
  dx: dx,
  dy: dy,
  box(width: w, height: h, fill: tint, stroke: thickness + edge, radius: 3pt, inset: 3.5mm)[
    #set align(center + horizon)
    #set par(justify: false, leading: 0.5em)
    #label
  ],
)

#let arrow-right(x, y, len, tint: accent) = {
  place(dx: x, dy: y, line(start: (0pt, 0pt), end: (len, 0pt), stroke: 2pt + tint))
  place(dx: x + len - 7pt, dy: y - 5pt, polygon(fill: tint, (0pt, 0pt), (7pt, 5pt), (0pt, 10pt)))
}

#let arrow-down(x, y, len, tint: accent) = {
  place(dx: x, dy: y, line(start: (0pt, 0pt), end: (0pt, len), stroke: 2pt + tint))
  place(dx: x - 5pt, dy: y + len - 7pt, polygon(fill: tint, (0pt, 0pt), (10pt, 0pt), (5pt, 7pt)))
}

#let arrow-up(x, y, len, tint: accent) = {
  place(dx: x, dy: y - len, line(start: (0pt, 0pt), end: (0pt, len), stroke: 2pt + tint))
  place(dx: x - 5pt, dy: y - len, polygon(fill: tint, (0pt, 7pt), (10pt, 7pt), (5pt, 0pt)))
}

#let label-at(x, y, body, size: 15pt, tint: muted) = place(dx: x, dy: y, text(size: size, fill: tint, body))

#let poster-table(columns, align-spec, header, ..rows) = {
  set text(size: 17.5pt)
  table(
    columns: columns,
    align: align-spec,
    stroke: none,
    inset: (x: 5mm, y: 3mm),
    fill: (_, y) => if calc.odd(y) { white } else { rgb("#e2eaf1") },
    table.hline(stroke: 2pt + accent),
    ..header.map(cell => text(weight: "bold", fill: accent, cell)),
    table.hline(stroke: 1.2pt + accent),
    ..rows.pos(),
    table.hline(stroke: 2pt + accent),
  )
}

#let numbered(bar, ..items) = {
  set par(justify: false)
  let entries = items.pos()
  grid(
    columns: (9mm, 1fr),
    row-gutter: 4mm,
    column-gutter: 2.5mm,
    align: (left + top, left + top),
    ..range(entries.len()).map(i => (text(fill: bar)[#{ i + 1 }.], entries.at(i))).flatten(),
  )
}

#block(
  width: 100%,
  fill: accent,
  radius: 5pt,
  inset: (x: 16mm, y: 10mm),
)[
  #set align(center)
  #text(size: 50pt, weight: "bold", fill: white)[
    Thermal Runaway Onset in Sodium-Ion Cells
  ]
  #v(3mm)
  #text(size: 27pt, fill: rgb("#cfe0ee"))[
    A coupled electrochemical, thermal, and decomposition-kinetic model validated against calorimetry
  ]
  #v(5mm)
  #line(length: 40%, stroke: 2pt + rgb("#7fa8c6"))
  #v(5mm)
  #text(size: 26pt, fill: white)[
    Rosalind Ekwueme-Vasquez#super[1] #h(8mm) Hadrien Bouchard#super[1,2] #h(8mm) Milena Trajkovska#super[1]
  ]
  #v(3mm)
  #text(size: 20pt, fill: rgb("#cfe0ee"))[
    #super[1] Centre for Energy Storage Science, Vallonbrunn University of Technology #h(6mm)
    #super[2] Department of Chemical Engineering, Kestrel College
  ]
]

#v(14mm)

#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 10mm,
  align: (top, top, top),
  card[Abstract][
    Sodium-ion cells are entering grid storage on the argument that they are intrinsically safer than
    lithium-ion cells. We test that argument quantitatively. A pseudo-two-dimensional electrochemical
    model is coupled to a radially resolved thermal model and to a three-reaction decomposition scheme
    fitted to accelerating rate calorimetry on 18650 cells with hard carbon anodes and
    #box[$"Na"_3 "V"_2 ("PO"_4)_2 "F"_3$] cathodes. The model reproduces measured self-heating onset
    to within 4.1 kelvin across four states of charge, and predicts that onset falls by 31 kelvin as
    charge rises from 30 to 100 percent. Peak temperature stays below 380 degrees Celsius in every
    case, roughly 250 kelvin below the comparable lithium-ion result, yet onset itself is only 24
    kelvin higher. Safety margin in these cells comes from the energy released, not from the
    temperature at which release begins @ekwueme2026coupled.
  ],
  card[Why onset, not peak][
    Qualification standards for stationary storage are written around peak temperature and vented gas
    volume @renaud2025gridsafety. Both are consequences of how much decomposable material the cell
    holds, and both are genuinely favourable for sodium chemistries.

    Onset temperature is a different quantity. It is set by the least stable interphase in the cell,
    which for hard carbon anodes is a sodium alkyl carbonate layer that begins to decompose near 103
    degrees Celsius @trajkovska2024hardcarbon. That sits below the corresponding lithium value by
    only a small margin, and it decides whether one failing cell can drive its neighbours past their
    own onset @hallgrimsson2026propagation.

    A module is safe when propagation stops. Propagation is an onset question.
  ],
  card[Contributions][
    #numbered(
      accent,
      [A three-reaction decomposition scheme for hard carbon and polyanionic sodium cathodes, fitted to 36 calorimetry runs.],
      [Two-way coupling of that scheme to a P2D electrochemical model, so state of charge enters the kinetics instead of being a fixed parameter.],
      [Validation against independent calorimetry at four states of charge, with onset predicted to within 4.1 kelvin.],
      [A propagation criterion for module design, stated in terms of onset temperature and cell to cell conductance.],
      [Open release of the parameter set, the calorimetry traces, and the solver.],
    )
  ],
)

#v(14mm)

#grid(
  columns: (0.84fr, 1.16fr),
  column-gutter: 10mm,
  align: (top, top),
  card[Governing equations][
    Energy is balanced on a radially resolved cylindrical domain, with the electrochemical model
    supplying the reversible and ohmic source terms @oduya2023p2d,

    $ rho c_p (partial T) / (partial t) = 1/r (partial) / (partial r) (r lambda (partial T) / (partial r))
      + dot(q)_"ohm" + dot(q)_"rev" + dot(q)_"dec" . $

    Decomposition heat is the sum of three Arrhenius reactions, indexed by the interphase layer, the
    cathode, and the electrolyte @vasquez2023kinetics,

    $ dot(q)_"dec" = sum_(k=1)^(3) H_k rho_k A_k alpha_k^(n_k) exp(- E_k / (R T)) , $
    $ (dif alpha_k) / (dif t) = - A_k alpha_k^(n_k) exp(- E_k / (R T)) . $

    State of charge enters through the interphase reaction extent, which is what makes the coupling
    two-way rather than a post-processing step,

    $ rho_1 = rho_1^0 (1 + beta (c_s^"surf" / c_s^"max" - 1/2)) , quad beta = 0.63 . $

    Onset is declared when the self-heating rate first exceeds 0.02 kelvin per minute with the oven
    held isothermal, the standard heat, wait, and seek criterion @bouchard2025arc.
  ],
  card[Model coupling and cell geometry][
    #align(center)[
      #box(width: 100%, height: 204mm)[
        #place(dx: 0mm, dy: 2mm, box(width: 150mm, height: 150mm, stroke: (paint: muted, thickness: 1.2pt, dash: "dashed"), radius: 4pt))
        #label-at(5mm, 5mm, [Cell cross section, 18650 format], size: 16pt, tint: accent)

        #node(10mm, 20mm, 130mm, 16mm, tint: rgb("#dfe4e9"), edge: muted)[#text(size: 15pt)[Steel casing, 0.30 mm]]
        #node(10mm, 40mm, 130mm, 22mm, tint: rgb("#e6edf3"), edge: accent-mid)[#text(size: 15pt)[Aluminium collector and #box[$"Na"_3 "V"_2 ("PO"_4)_2 "F"_3$] cathode]]
        #node(10mm, 66mm, 130mm, 15mm, tint: rgb("#f4f1e6"), edge: ember)[#text(size: 15pt)[Separator, 20 um polyolefin]]
        #node(10mm, 85mm, 130mm, 22mm, tint: rgb("#e5eee7"), edge: moss)[#text(size: 15pt)[Hard carbon anode and interphase layer]]
        #node(10mm, 111mm, 130mm, 16mm, tint: rgb("#dfe4e9"), edge: muted)[#text(size: 15pt)[Copper collector, mandrel void]]

        #place(dx: 6mm, dy: 133mm, box(width: 138mm, text(size: 15pt, fill: muted)[
          Radial conduction to the casing, then convection and radiation to the oven.
        ]))

        #place(dx: 225mm, dy: 6mm, box(width: 150mm, height: 42mm, fill: white, stroke: 1.8pt + accent, radius: 3pt, inset: 4mm)[
          #set align(center + horizon)
          #set par(justify: false, leading: 0.5em)
          #text(size: 20pt, weight: "bold", fill: accent)[Electrochemical model] \
          #text(size: 15pt, fill: muted)[P2D, 60 radial nodes]
        ])
        #place(dx: 225mm, dy: 76mm, box(width: 150mm, height: 42mm, fill: white, stroke: 1.8pt + warm, radius: 3pt, inset: 4mm)[
          #set align(center + horizon)
          #set par(justify: false, leading: 0.5em)
          #text(size: 20pt, weight: "bold", fill: warm)[Thermal model] \
          #text(size: 15pt, fill: muted)[cylindrical, 40 nodes]
        ])
        #place(dx: 225mm, dy: 146mm, box(width: 150mm, height: 42mm, fill: white, stroke: 1.8pt + moss, radius: 3pt, inset: 4mm)[
          #set align(center + horizon)
          #set par(justify: false, leading: 0.5em)
          #text(size: 20pt, weight: "bold", fill: moss)[Decomposition kinetics] \
          #text(size: 15pt, fill: muted)[three Arrhenius reactions]
        ])

        #arrow-down(250mm, 48mm, 28mm, tint: accent)
        #label-at(256mm, 50mm, [ohmic and reversible heat], size: 14pt, tint: accent)
        #arrow-up(350mm, 76mm, 28mm, tint: warm)
        #label-at(300mm, 63mm, [temperature], size: 14pt, tint: warm)

        #arrow-down(250mm, 118mm, 28mm, tint: warm)
        #label-at(256mm, 120mm, [cell temperature], size: 14pt, tint: warm)
        #arrow-up(350mm, 146mm, 28mm, tint: moss)
        #label-at(288mm, 133mm, [decomposition heat], size: 14pt, tint: moss)

        #place(dx: 205mm, dy: 167mm, line(start: (0pt, 0pt), end: (20mm, 0pt), stroke: (paint: moss, thickness: 2pt, dash: "dashed")))
        #place(dx: 205mm, dy: 27mm, line(start: (0pt, 0pt), end: (0pt, 140mm), stroke: (paint: moss, thickness: 2pt, dash: "dashed")))
        #arrow-right(205mm, 27mm, 20mm, tint: moss)
        #place(dx: 154mm, dy: 76mm, box(width: 47mm)[
          #set par(justify: false, leading: 0.5em)
          #text(size: 14pt, fill: moss)[interphase extent feeds back to the surface concentration]
        ])
      ]
    ]
    #v(1mm)
    #text(size: 15.5pt, fill: muted)[
      The two-way loop is what separates this model from a decomposition scheme evaluated on a
      prescribed temperature history. Reaction extent changes the surface concentration, which changes
      the ohmic source, which changes the temperature that drives the reaction.
    ]
  ],
)

#v(14mm)

#grid(
  columns: (1.3fr, 0.7fr),
  column-gutter: 10mm,
  align: (top, top),
  card[Results: measured and simulated runaway][
    #let plot-w = 372mm
    #let plot-h = 152mm
    #let x-lo = 0.0
    #let x-hi = 180.0
    #let y-lo = 0.0
    #let y-hi = 400.0
    #let px(v) = plot-w * ((v - x-lo) / (x-hi - x-lo))
    #let py(v) = plot-h * (1.0 - (v - y-lo) / (y-hi - y-lo))
    #let trace(points, tint) = {
      let mapped = points.map(p => (px(p.at(0)), py(p.at(1))))
      let steps = mapped.slice(1).map(p => curve.line(p))
      place(curve(stroke: 2.6pt + tint, curve.move(mapped.first()), ..steps))
    }
    #let onset-mark(x, y, tint) = place(
      dx: px(x) - 4pt,
      dy: py(y) - 4pt,
      circle(radius: 4pt, fill: white, stroke: 2.2pt + tint),
    )

    #align(center)[
      #box(width: plot-w + 46mm, height: plot-h + 28mm)[
        #place(dx: 36mm, dy: 2mm, box(width: plot-w, height: plot-h)[
          #for g in (50.0, 100.0, 150.0, 200.0, 250.0, 300.0, 350.0, 400.0) {
            place(line(start: (0pt, py(g)), end: (plot-w, py(g)), stroke: 0.8pt + rgb("#d6dee6")))
            place(dx: -33mm, dy: py(g) - 4mm, box(width: 29mm)[
              #set align(right)
              #text(size: 15pt, fill: muted)[#calc.round(g)]
            ])
          }
          #for t in (0.0, 30.0, 60.0, 90.0, 120.0, 150.0, 180.0) {
            place(line(start: (px(t), plot-h), end: (px(t), plot-h + 2.5mm), stroke: 1.4pt + ink))
            place(dx: px(t) - 12mm, dy: plot-h + 4mm, box(width: 24mm)[
              #set align(center)
              #text(size: 15pt, fill: muted)[#calc.round(t)]
            ])
          }

          #trace(((0.0, 25.0), (70.0, 109.0), (103.0, 149.0), (115.0, 172.0), (126.0, 203.0), (133.0, 229.0), (138.0, 246.0), (160.0, 241.0), (180.0, 232.0)), violet)
          #trace(((0.0, 25.0), (60.0, 97.0), (97.0, 141.0), (107.0, 163.0), (114.0, 212.0), (119.0, 264.0), (122.0, 291.0), (140.0, 285.0), (180.0, 255.0)), moss)
          #trace(((0.0, 25.0), (50.0, 85.0), (91.0, 134.0), (100.0, 158.0), (106.0, 214.0), (110.0, 286.0), (112.0, 328.0), (120.0, 330.0), (150.0, 296.0), (180.0, 266.0)), ember)
          #trace(((0.0, 25.0), (40.0, 73.0), (77.0, 117.0), (85.0, 142.0), (90.0, 196.0), (93.0, 281.0), (95.0, 352.0), (100.0, 372.0), (120.0, 338.0), (150.0, 290.0), (180.0, 258.0)), warm)

          #onset-mark(77.0, 117.0, warm)
          #onset-mark(91.0, 134.0, ember)
          #onset-mark(97.0, 141.0, moss)
          #onset-mark(103.0, 149.0, violet)

          #place(line(
            start: (0pt, py(103.0)),
            end: (plot-w, py(103.0)),
            stroke: (paint: muted, thickness: 1.6pt, dash: "dashed"),
          ))
          #label-at(3mm, py(103.0) + 2mm, [Interphase decomposition threshold, 103 C], size: 15pt)

          #place(line(start: (0pt, 0pt), end: (0pt, plot-h), stroke: 1.6pt + ink))
          #place(line(start: (0pt, plot-h), end: (plot-w, plot-h), stroke: 1.6pt + ink))
          #label-at(plot-w / 2 - 38mm, plot-h + 11mm, [Time under a 1.2 K per minute ramp (min)], size: 17pt)
        ])
        #place(dx: 1mm, dy: 2mm + plot-h, rotate(-90deg, origin: left + top, reflow: false, box(width: plot-h)[
          #set align(center)
          #text(size: 17pt, fill: muted)[Cell surface temperature (C)]
        ]))
      ]
    ]

    #v(2mm)
    #grid(
      columns: (auto, auto, auto, auto, 1fr),
      column-gutter: 7mm,
      align: (horizon, horizon, horizon, horizon, horizon),
      text(size: 17pt)[#box(width: 12mm, height: 3.5pt, fill: warm) #h(2mm) 100 percent SOC],
      text(size: 17pt)[#box(width: 12mm, height: 3.5pt, fill: ember) #h(2mm) 70 percent SOC],
      text(size: 17pt)[#box(width: 12mm, height: 3.5pt, fill: moss) #h(2mm) 50 percent SOC],
      text(size: 17pt)[#box(width: 12mm, height: 3.5pt, fill: violet) #h(2mm) 30 percent SOC],
      text(size: 16pt, fill: muted)[Open circles mark the 0.02 K per minute onset criterion.],
    )

    #v(4mm)
    #poster-table(
      (auto, auto, auto, auto, auto, auto),
      (left, right, right, right, right, right),
      ("State of charge", "Onset, measured", "Onset, model", "Peak rate", "Peak temperature", "Vented gas"),
      [100 percent], [118.4 C], [117.2 C], [412 K/min], [372 C], [1.94 L],
      [70 percent], [133.1 C], [134.0 C], [188 K/min], [328 C], [1.41 L],
      [50 percent], [143.6 C], [141.3 C], [96 K/min], [291 C], [1.08 L],
      [30 percent], [148.9 C], [149.4 C], [41 K/min], [246 C], [0.72 L],
    )
    #v(2mm)
    #text(size: 16pt, fill: muted)[
      Nine 18650 cells per state of charge, accelerating rate calorimeter, 1.2 kelvin per minute ramp
      with heat, wait, and seek above 60 degrees Celsius. Onset residuals are 1.2, 0.9, 2.3, and 0.5
      kelvin, with a root mean square of 4.1 kelvin over the full 36 cell set.
    ]
  ],
  [
    #card(bar: warm)[What the numbers say][
      Peak temperature falls by 126 kelvin between full and 30 percent charge, and vented gas volume
      by 63 percent. Onset temperature moves by only 31 kelvin over the same range, and never rises
      above 149 degrees Celsius.

      The comparable lithium iron phosphate cell in our laboratory, measured on the same instrument,
      reaches a peak of 621 degrees Celsius from an onset of 125 degrees Celsius. Sodium is far
      better on release and only modestly better on onset @lindmark2024gasrelease.

      #v(3mm)
      #block(fill: white, radius: 3pt, inset: 6mm, stroke: 1.4pt + warm)[
        #set par(justify: false)
        #text(size: 18pt)[
          *Propagation criterion.* A module avoids propagation when the cell to cell thermal
          conductance satisfies
          $ G < (Q_"peak") / (Delta t (T_"onset" - T_"amb")) , $
          which for the 100 percent case gives 0.31 watts per kelvin. Measured conductance in our
          prismatic module is 0.44 watts per kelvin, so that design propagates.
        ]
      ]
    ]

    #v(8mm)

    #card(bar: moss)[Sensitivity][
      #poster-table(
        (1fr, auto),
        (left, right),
        ("Parameter perturbed by 10 percent", "Onset shift"),
        [Interphase activation energy $E_1$], [8.9 K],
        [Interphase heat of reaction $H_1$], [2.1 K],
        [Radial conductivity $lambda$], [1.7 K],
        [Casing emissivity], [0.9 K],
        [Cathode activation energy $E_2$], [0.2 K],
      )
      #v(3mm)
      Onset is governed almost entirely by the interphase activation energy. Cathode kinetics, which
      dominate peak temperature, barely move the onset. Measuring $E_1$ well is worth more than
      refining the cathode scheme.
    ]
  ],
)

#v(14mm)

#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 10mm,
  align: (top, top, top),
  card(bar: accent-mid)[Conclusions][
    #numbered(
      accent-mid,
      [The coupled model predicts runaway onset to 4.1 kelvin without fitting to the validation set.],
      [Sodium-ion safety is a released-energy advantage, not an onset-temperature advantage.],
      [Onset falls 31 kelvin from 30 to 100 percent charge, so qualifying at partial charge is not conservative.],
      [Interphase activation energy is the parameter to measure precisely. For onset, everything else is secondary.],
      [Our own prismatic module fails the propagation criterion at full charge.],
    )
  ],
  card(bar: ember)[Limitations and next steps][
    The kinetic scheme lumps every interphase reaction into one step. Calorimetry alone cannot
    separate them, and differential scanning results suggest at least two.

    Ageing is absent. Interphase mass grows with cycling, so onset should fall over life, and we have
    no data past 200 cycles.

    Venting is treated as an instantaneous mass loss with a fixed enthalpy, which is adequate for
    onset and poor for peak temperature.

    Next: three-cell propagation experiments in a purpose-built fixture, and an aged-cell calorimetry
    campaign at 200, 600, and 1200 cycles.
  ],
  card(bar: muted)[References and artefacts][
    #set text(size: 15.5pt)
    #set par(justify: false, leading: 0.5em)
    #bibliography("refs.bib", title: none, style: "ieee")
    #v(2mm)
    #text(size: 16pt, fill: muted)[
      Parameter set, all 36 calorimetry traces, and the coupled solver are archived under a persistent
      identifier and released under a permissive licence. Contact
      #box[#text(font: "DejaVu Sans Mono", size: 14pt)[r.ekwueme-vasquez\@vallonbrunn.example.edu]].
    ]
  ],
)
