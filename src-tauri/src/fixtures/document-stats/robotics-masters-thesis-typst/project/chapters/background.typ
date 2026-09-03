#import "../lib/style.typ": *

= Background and Related Work <sec:background>

== Grasp quality in wrench space

The classical formulation treats each contact as a point on the object surface
at which a force may be applied inside a friction cone, and asks whether the
set of wrenches the contacts can jointly exert spans the six-dimensional wrench
space @murray1994mathematical @bicchi2000robotic. Let $c_i$ be a contact point,
$n_i$ the inward surface normal, and $mu$ the Coulomb friction coefficient. The
force that contact $i$ can apply lies in the cone

$ cal(F)_i = { f in RR^3 : f dot n_i >= 0, norm(f - (f dot n_i) n_i) <= mu (f dot n_i) }. $ <eq:cone>

Linearising each cone with $m$ generators $g_(i,1), dots, g_(i,m)$ and mapping
each generator to a wrench about the object centre of mass gives the primitive
wrench set

$ cal(W) = { vec(g_(i,j), (c_i - p) times g_(i,j)) : i = 1, dots, k, space j = 1, dots, m }, $ <eq:wrenchset>

where $p$ is the reference point. The grasp achieves force closure when the
convex hull of $cal(W)$ contains the origin in its interior
@nguyen1988constructing. The scalar quality measure introduced by Ferrari and
Canny @ferrari1992planning is the radius of the largest ball centred at the
origin and contained in that hull, which is the smallest wrench magnitude the
grasp resists in the worst direction:

$ Q_"FC" = min_(w in partial "conv"(cal(W))) norm(w). $ <eq:qfc>

Roa and Suarez survey the alternatives and observe that most published measures
are monotone transformations of one another once the contact model is fixed
@roa2015grasp. Their conclusion is that the choice of contact model matters
more than the choice of measure, which is precisely the observation this thesis
builds on. The point contact with friction model in @eq:cone is a strong
assumption. It is exact for a rigid sphere on a rigid plane, adequate for a
rigid gripper on a machined part, and wrong for an elastomer finger on a
deformable surface, where the contact is an area whose shape changes with load.

Prattichizzo and Trinkle discuss the soft finger contact model, which augments
the point contact with a torsional friction limit about the normal
@prattichizzo2016grasping. That extension captures one consequence of the
contact area, namely the resistance to spin, but it retains a single contact
location and therefore cannot express the fact that the pressure distribution
inside the patch is not uniform and that the leading edge of the patch reaches
its friction limit before the centre does.

== Tactile sensing modalities

Three sensing families dominate current practice. Optical tactile sensors image
the deformation of an elastomer pad through a camera, and recover both geometry
and shear from the displacement of embedded markers @yuan2017gelsight. Their
spatial resolution is excellent, they measure geometry directly, and they are
comparatively cheap to build. Their weaknesses are the depth of the optical
stack, which makes the fingertip bulky, and the latency of the imaging and
processing chain, which is typically 30 ms or more end to end.

Capacitive and piezoresistive taxel arrays measure normal pressure at discrete
sites, and with a suitable electrode geometry also the two shear components.
They are thin, fast, and robust, and they scale to large areas
@sundaram2019learning. Their spatial resolution is lower than an optical sensor
of the same footprint, and they are sensitive to temperature drift and to
hysteresis in the elastomer.

Biomimetic fluid-filled sensors measure pressure at a small number of
electrodes inside a conductive gel and infer contact location and force from
the pattern @su2015force. They are compact and durable, but the inverse problem
is ill conditioned and the effective spatial resolution is low.

The sensor used in this thesis, described in @sec:sensing, belongs to the
second family. The choice was driven by latency. A planner that revises its
hypothesis during closure has approximately 300 ms of useful time, and a 30 ms
sensing delay consumes a tenth of it before any computation begins.

== Slip detection and slip prediction

Slip detection has been approached as vibration classification, as tracking of
marker displacement, and as supervised learning on raw tactile sequences. Veiga
and colleagues train a random forest on features of the tactile signal and use
its output to modulate grip force, demonstrating stabilisation of previously
unseen objects @veiga2015stabilizing. Su and colleagues detect the
high-frequency signature of micro-slip in a biomimetic sensor and classify slip
direction @su2015force.

The distinction that matters for control is between gross slip, in which the
entire contact patch translates relative to the object, and incipient slip, in
which an annulus at the boundary of the patch has already exceeded its friction
limit while the centre remains stuck. Dong and colleagues show that incipient
slip is visible in the divergence of the marker displacement field in an
optical sensor and that a controller which regulates the stuck-area fraction
maintains grasps at forces far below those a conservative policy would apply
@dong2019maintaining. Our slip predictor in @sec:slip adopts the same physical
insight but works on a taxel shear field rather than on a marker image, and it
runs on the sensor rather than on the host.

== Tactile regrasping

Regrasping is the natural response when the initial contact is poor. Hogan and
colleagues learn a model that predicts the tactile image that would result from
a candidate finger displacement, and select the displacement whose predicted
image is closest to a set of images labelled as stable grasps
@hogan2018tactile. Calandra and colleagues learn an action-conditional outcome
predictor over combined visual and tactile inputs and use it to select regrasp
actions @calandra2018more.

Both approaches learn the mapping from tactile observation to grasp outcome. We
instead compute it. The advantage is that the computation transfers to objects
outside any training distribution and that its failure cases are diagnosable.
The cost is that we must estimate the physical quantities the computation
consumes, in particular the friction coefficient, which a learned model can
leave implicit.

== Positioning

@tab:positioning places this work relative to the closest prior systems along
three axes: whether the tactile signal reaches the planner or only the
controller, whether contact is modelled as a point or as an area, and whether
the friction coefficient is assumed or estimated.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: (left, center, center, center),
    stroke: none,
    inset: (x: 7pt, y: 5pt),
    table.hline(stroke: 0.9pt),
    table.header(
      [*System*], [*Tactile reaches*], [*Contact model*], [*Friction*],
    ),
    table.hline(stroke: 0.5pt),
    [Dex-Net 2.0 @mahler2017dexnet], [planner (simulated)], [point], [assumed],
    [GPD @tenpas2017grasp], [not used], [point], [assumed],
    [Veiga et al. @veiga2015stabilizing], [controller], [none], [not modelled],
    [Su et al. @su2015force], [controller], [point], [not modelled],
    [Dong et al. @dong2019maintaining], [controller], [area], [estimated],
    [Hogan et al. @hogan2018tactile], [planner (learned)], [implicit], [implicit],
    [Palisade (this work)], [planner and controller], [area], [estimated],
    table.hline(stroke: 0.9pt),
  ),
  caption: [
    Position of this work relative to representative prior systems. The
    distinguishing property is not the use of tactile sensing, which is common,
    but the combination of an area contact model with an online friction
    estimate inside the planner.
  ],
) <tab:positioning>

The row that is closest to ours is the incipient-slip controller of Dong and
colleagues, which shares the area contact model and the online friction
estimate. The difference is architectural: their estimate feeds a force
regulator, ours feeds a quality metric that can also decide to move the
fingers. @sec:results quantifies what that difference is worth.
