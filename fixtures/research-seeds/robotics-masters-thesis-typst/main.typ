#import "lib/style.typ": *

#set document(
  title: "Contact-Consistent Grasp Planning from Dense Tactile Feedback",
  author: "Marta Iversen-Okoye",
)

#set page(
  paper: "a4",
  margin: (top: 2.6cm, bottom: 2.6cm, inside: 3.0cm, outside: 2.4cm),
  numbering: none,
  header: context {
    let heads = query(selector(heading.where(level: 1)).before(here()))
    if heads.len() > 0 {
      set text(size: 8.5pt, fill: luma(35%))
      emph(heads.last().body)
      v(-4pt)
      line(length: 100%, stroke: 0.4pt + luma(72%))
    }
  },
)

#set text(font: "New Computer Modern", size: 11pt, lang: "en")
#set par(justify: true, leading: 0.72em, first-line-indent: 1.2em)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#show raw: set text(font: "DejaVu Sans Mono", size: 9pt)
#show link: set text(fill: accent)

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(1.1cm)
  block(width: 100%)[
    #if it.numbering != none [
      #context text(size: 10.5pt, fill: luma(45%), tracking: 1.6pt)[
        #if in-appendix.get() [APPENDIX] else [CHAPTER]
        #counter(heading).display(it.numbering)
      ]
      #v(3mm)
    ]
    #par(justify: false, first-line-indent: 0pt)[#text(size: 20pt, weight: "bold", hyphenate: false)[#it.body]]
  ]
  v(4mm)
  line(length: 100%, stroke: 0.8pt + luma(60%))
  v(8mm)
}

#show heading.where(level: 2): it => {
  v(6mm)
  block(text(size: 13pt, weight: "bold")[#counter(heading).display() #h(5pt) #it.body])
  v(1mm)
}

#show heading.where(level: 3): it => {
  v(4mm)
  block(text(size: 11.5pt, weight: "bold", style: "italic")[#counter(heading).display() #h(5pt) #it.body])
  v(0.5mm)
}

#show figure: set block(above: 12pt, below: 12pt)
#show table: set par(justify: false, first-line-indent: 0pt)
#show figure.caption: set text(size: 9.5pt)

#align(center)[
  #v(0.4cm)
  #text(size: 12pt, tracking: 2pt)[VARDENHOEK UNIVERSITY OF TECHNOLOGY]
  #v(2mm)
  #text(size: 10.5pt)[Faculty of Mechanical, Maritime and Systems Engineering]
  #v(1mm)
  #text(size: 10.5pt)[Institute for Autonomous Manipulation]

  #v(1.7cm)
  #line(length: 70%, stroke: 0.8pt)
  #v(6mm)
  #text(size: 21pt, weight: "bold")[
    Contact-Consistent Grasp Planning\
    from Dense Tactile Feedback
  ]
  #v(5mm)
  #text(size: 13pt, style: "italic")[
    Slip prediction and reactive regrasping for deformable objects
  ]
  #v(6mm)
  #line(length: 70%, stroke: 0.8pt)

  #v(1.5cm)
  #text(size: 12pt)[A thesis submitted in partial fulfilment of the requirements for the degree of]
  #v(3mm)
  #text(size: 14pt, weight: "bold")[Master of Science in Robotics]

  #v(1.2cm)
  #text(size: 13pt)[Marta Iversen-Okoye]
  #v(2mm)
  #text(size: 10pt)[Student number 4718203]

  #v(1.5cm)
  #grid(
    columns: (4.6cm, 6cm),
    align: (right, left),
    row-gutter: 4mm,
    column-gutter: 5mm,
    text(size: 10.5pt)[Supervisor:], text(size: 10.5pt)[Prof. dr. ir. Hanne Vestergaard],
    text(size: 10.5pt)[Daily supervisor:], text(size: 10.5pt)[Dr. Rafael Nzeogwu],
    text(size: 10.5pt)[External member:], text(size: 10.5pt)[Dr. ir. Sanne Kolthoorn],
  )

  #v(1.4cm)
  #text(size: 11pt)[Vardenhoek, August 2026]
]

#pagebreak()
#set page(numbering: "i")
#counter(page).update(1)

#heading(numbering: none)[Abstract]

Robotic grasping of deformable and semi-rigid objects remains unreliable
because the two quantities that decide whether a grasp holds, the true contact
patch and the local friction available inside it, are not observable from
vision alone. A visually plausible antipodal grasp on a filled polymer pouch
can fail within two hundred milliseconds of lift-off when the contact patch
migrates under load and the effective friction coefficient at the leading edge
falls below the value the planner assumed. This thesis argues that the correct
response is not a more conservative force schedule but a planner that treats
the tactile image as a first-class geometric observation and revises its grasp
hypothesis while the grasp is being formed.

We present Palisade, a grasp planner that consumes the dense output of a
40 by 30 taxel array on each finger of a parallel gripper, reconstructs a
contact patch and a per-patch friction estimate at 180 Hz, and scores candidate
grasps with a wrench-space metric that is conditioned on the observed patch
rather than on an assumed point contact. Palisade couples this planner to an
incipient-slip predictor built from the spatial divergence of the shear field,
and to a regrasp policy that decides, within a single control cycle, whether to
raise normal force, translate the fingers along the object surface, or abandon
and replan.

On a set of 24 objects spanning rigid, articulated, and deformable classes, and
across 1440 grasp trials on a seven-axis arm, Palisade lifts and transports
objects successfully in 91.4 percent of trials, against 74.2 percent for a
vision-only baseline that uses the same candidate generator and 82.0 percent
for a tactile baseline that reacts to slip but does not replan geometry. The
gain concentrates on the deformable class, where the vision-only baseline
reaches 58.3 percent and Palisade reaches 88.9 percent. We show that the
contact-patch conditioning, not the reactive force control, accounts for most
of that gap, and we characterise the two regimes in which Palisade still fails:
objects whose surface friction changes faster than the estimator settles, and
grasps in which the available patch is smaller than four taxels in either
direction.

#pagebreak()

#heading(numbering: none)[Acknowledgements]

This work was carried out in the Institute for Autonomous Manipulation between
September 2025 and July 2026. I thank Prof. Vestergaard for insisting, early
and repeatedly, that a slip detector is not a grasp planner, and Dr. Nzeogwu
for the many hours spent recalibrating taxel arrays that I had bent out of
tolerance. The mechanical workshop under Bert Osinga fabricated four
generations of finger housings without once complaining about the tolerances I
asked for. My fellow students in the manipulation group, in particular
Wiebke Dorn and Tomasz Bielawski, absorbed several months of half-formed
arguments about friction cones and returned better ones. The remaining errors
are mine.

#pagebreak()

#outline(title: [Contents], depth: 2)

#pagebreak()

#outline(title: [List of Figures], target: figure.where(kind: image))

#outline(title: [List of Tables], target: figure.where(kind: table))

#pagebreak()
#set page(numbering: "1")
#counter(page).update(1)

#include "chapters/introduction.typ"
#include "chapters/background.typ"
#include "chapters/sensing.typ"
#include "chapters/planning.typ"
#include "chapters/control.typ"
#include "chapters/evaluation.typ"
#include "chapters/conclusion.typ"

#counter(heading).update(0)
#set heading(numbering: "A.1")
#in-appendix.update(true)

#include "chapters/appendix.typ"

#bibliography("refs.bib", style: "ieee", title: [Bibliography])
