#import "../lib/style.typ": *

= Reactive Control and Regrasping <sec:control>

== Incipient slip from shear divergence <sec:slip>

Gross slip is easy to detect and useless to detect, because by the time the
whole patch is moving the object has already begun to fall. The signal that
arrives in time is incipient slip: an annulus at the boundary of the patch in
which the local shear traction has reached its friction limit while the interior
remains stuck @dong2019maintaining.

Let $s(x)$ be the measured shear vector field over the patch, expressed in the
finger frame. In the stuck region the elastomer deforms affinely with the
object, so $s$ varies smoothly and its divergence is small. Where the surface
has broken away, the elastomer relaxes towards its undeformed state and the
field develops a source. We therefore compute

$ D(x) = nabla dot s(x) approx (s_(i+1,j)^x - s_(i-1,j)^x) / (2 h)
        + (s_(i,j+1)^y - s_(i,j-1)^y) / (2 h), $ <eq:divergence>

with $h$ the taxel pitch, and define the stuck fraction of a region $R$ as

$ sigma(R) = 1 / (|R|) sum_((i,j) in R) bb(1)[ |D_(i j)| < d_"thr" ]. $ <eq:stuck>

The threshold $d_"thr"$ is set from the noise floor of the shear channel and
equals 0.42 N per millimetre squared. @fig:trace shows a representative trial:
the global stuck fraction begins to fall 74 ms before the tangential
displacement of the object exceeds 1 mm, which is our operational definition of
gross slip.

#figure(
  plotbox(8.6cm, 4.6cm, {
    let w = 8.6cm
    let h = 4.6cm
    gridlines(w, h, (0.25, 0.5, 0.75, 1.0))
    axes(
      w, h,
      xticks: ((0.0, [0]), (0.2, [100]), (0.4, [200]), (0.6, [300]), (0.8, [400]), (1.0, [500])),
      yticks: ((0.0, [0]), (0.25, [0.25]), (0.5, [0.50]), (0.75, [0.75]), (1.0, [1.00])),
      xlabel: [time since first contact (ms)],
      ylabel: [normalised value],
    )
    let stuck = ((0.0, 1.0), (0.14, 1.0), (0.28, 0.99), (0.40, 0.97), (0.50, 0.93),
                 (0.58, 0.86), (0.64, 0.74), (0.70, 0.58), (0.76, 0.41), (0.82, 0.30),
                 (0.90, 0.24), (1.0, 0.22))
    let force = ((0.0, 0.06), (0.10, 0.24), (0.20, 0.40), (0.30, 0.48), (0.42, 0.51),
                 (0.55, 0.52), (0.64, 0.53), (0.70, 0.66), (0.76, 0.78), (0.84, 0.80),
                 (0.92, 0.80), (1.0, 0.80))
    let disp = ((0.0, 0.0), (0.30, 0.0), (0.50, 0.01), (0.62, 0.02), (0.70, 0.05),
                (0.76, 0.12), (0.82, 0.20), (0.88, 0.26), (0.94, 0.30), (1.0, 0.32))
    series(w, h, stuck, color: accent, thickness: 1.2pt)
    series(w, h, force, color: accent2, thickness: 1.2pt)
    series(w, h, disp, color: accent3, thickness: 1.2pt, dash: "dashed")

    place(dx: 0.64 * w, dy: 0pt, line(angle: 90deg, length: h, stroke: (paint: luma(45%), thickness: 0.6pt, dash: "dotted")))
    place(dx: 0.79 * w, dy: 0pt, line(angle: 90deg, length: h, stroke: (paint: luma(45%), thickness: 0.6pt, dash: "dotted")))
    lbl(0.64 * w - 1.3cm, -0.62cm, text(size: 6.5pt)[predictor fires], w: 2.6cm)
    lbl(0.79 * w - 0.9cm, -0.28cm, text(size: 6.5pt)[gross slip], w: 2.6cm)

    place(dx: 0.06 * w, dy: 0.06 * h, legendbox((
      ([stuck fraction $sigma$], accent),
      ([normal force, scaled], accent2),
      ([tangential displacement], accent3),
    )))
  }),
  caption: [
    A representative grasp on the 0.62 kg filled pouch. The stuck fraction
    departs from unity at 320 ms, the predictor fires at 350 ms, and gross slip
    occurs at 424 ms. The force regulator responds within one control cycle and
    the grasp is recovered.
  ],
) <fig:trace>

@tab:predictor compares the divergence predictor against two baselines on 240
slip events induced by ramping a tangential load on a stationary grasp. The
temporal-derivative baseline thresholds the rate of change of total shear. The
vibration baseline thresholds the energy of the shear channel in a 60 to 400 Hz
band, which is the classical micro-slip signature @su2015force.

#figure(
  table(
    columns: (5.2cm, auto, auto, auto),
    align: (left, right, right, right),
    stroke: none,
    inset: (x: 8pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Predictor*],
      [*Lead time (ms)*],
      [*Detection rate*],
      [*False alarms per min*],
    ),
    table.hline(stroke: 0.5pt),
    [Temporal derivative of shear], [31.2], [0.87], [4.1],
    [Vibration band energy], [44.6], [0.79], [9.3],
    [Shear divergence (this work)], [*74.3*], [*0.96*], [*0.6*],
    table.hline(stroke: 0.5pt),
    [Shear divergence, boundary only], [69.1], [0.94], [0.5],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    Slip prediction performance over 240 induced slip events on eight surfaces.
    Lead time is the interval between the predictor firing and 1 mm of
    tangential object displacement. The final row restricts the divergence
    computation to the boundary run-length encoding, which costs 5 ms of lead
    time and saves 68 percent of the computation.
  ],
) <tab:predictor>

The boundary-only variant is what runs on the robot. Losing 5 ms of lead time
is acceptable; spending 68 percent more of the frame budget on a predictor that
must share the processor with the patch extractor is not.

== Grip force regulation

The regulator holds the stuck fraction near a target $sigma^*$ rather than
holding force at a fixed value. Let $e = sigma^* - sigma$ be the error. The
commanded normal force follows

$ dot(F)_"cmd" = K_p e + K_i integral_0^t e(tau) dif tau + K_f dot(W)_"ext", $ <eq:regulator>

where $dot(W)_"ext"$ is the rate of change of the external wrench predicted
from the commanded arm trajectory. The feedforward term is what allows the
regulator to raise force before an acceleration arrives rather than after it,
and it is the difference between a grasp that survives the transport segment
and one that does not.

We set $sigma^* = 0.85$. Higher targets waste force on objects that tolerate
it and crush the ones that do not. Lower targets leave no margin for the
disturbance that arrives between control cycles. @tab:sigma reports the sweep.

#figure(
  table(
    columns: (auto, auto, auto, auto, auto),
    align: (center, right, right, right, right),
    stroke: none,
    inset: (x: 9pt, y: 4.5pt),
    table.hline(stroke: 0.9pt),
    table.header(
      [$sigma^*$],
      [*Success*],
      [*Mean force (N)*],
      [*Crush events*],
      [*Drops*],
    ),
    table.hline(stroke: 0.5pt),
    [0.70], [0.812], [7.4], [1], [26],
    [0.80], [0.889], [9.1], [2], [14],
    [0.85], [*0.914*], [10.3], [3], [9],
    [0.90], [0.897], [13.8], [11], [4],
    [0.95], [0.834], [19.6], [27], [2],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    Sweep of the stuck-fraction target over 144 trials per setting. A crush
    event is a permanent deformation of more than 3 mm measured after release.
    The optimum trades a small number of drops against a small number of crush
    events.
  ],
) <tab:sigma>

== Regrasp policy

When the revision loop decides that the active candidate is inadequate, three
actions are available. The choice is made by the following rule, which is
evaluated once per revision cycle and is deliberately simple enough to be
audited from a log.

#definition("regrasp action")[
  Let $Q_a$ be the quality of the active grasp, $Q_b$ the best alternative,
  $d$ the surface distance to the alternative contact, and $z$ the height of
  the object above its support. The action is
  $ a = cases(
    "hold" & "if" Q_a >= 0.8 Q_b,
    "slide" & "if" Q_a < 0.8 Q_b and d < 8 "mm" and z < 2 "mm",
    "reset" & "if" Q_a < 0.8 Q_b and z < 2 "mm",
    "stiffen" & "otherwise"
  ). $
]

The $z < 2$ mm conditions matter. Once the object has left its support there is
no safe way to slide the fingers, because the load is carried entirely by
friction and a deliberate reduction of the stuck fraction is a deliberate drop.
Above that height the only available action is to raise force and complete the
transport, accepting the quality the grasp has.

#remark[
  In 1440 trials the policy selected hold in 71.2 percent of revision cycles,
  slide in 18.9 percent, reset in 6.4 percent, and stiffen in 3.5 percent. The
  reset action is expensive, costing on average 2.8 s, but it converts what
  would otherwise be a failure into a second attempt whose success rate is 88
  percent.
]

== Interaction between the two loops

A subtlety appears when the revision loop commands a slide while the force
regulator is holding the stuck fraction at 0.85. Sliding requires breaking the
contact, which is to say driving the stuck fraction towards zero, and the
regulator will fight it. We resolve this by suspending the regulator for the
duration of the slide and replacing it with an open-loop force schedule that
reduces normal force to 60 percent of its current value, executes the
translation, and restores force over 120 ms.

The alternative, which we implemented first, was to lower $sigma^*$ during the
slide and let the regulator do the work. It failed in a way that is worth
recording: the regulator has an integral term, and lowering the target caused
the integrator to unwind during the slide and then overshoot on restoration,
producing a force spike that crushed three of the deformable objects before we
diagnosed it. Suspending the loop entirely avoids the interaction.
