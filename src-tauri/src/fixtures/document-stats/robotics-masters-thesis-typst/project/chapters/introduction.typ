#import "../lib/style.typ": *

= Introduction

== Motivation

A parallel gripper closing on a plastic pouch of rice presents the planner with
a problem that no amount of additional camera resolution will solve. The
geometry the camera sees is the geometry of the object at rest. The geometry
that decides the outcome of the grasp is the geometry of the contact patch
after the fingers have compressed the surface, after the granular fill has
redistributed, and after the object has begun to rotate about the line joining
the two contacts. Between those two geometries lies a transformation that
depends on material properties the camera cannot measure.

Industrial practice works around this by removing the variability. Fixtures
constrain the pose, suction replaces friction, and the object set is enumerated
in advance. That strategy has carried automated handling a long way, and it
fails precisely where the demand is now growing: in logistics bins holding
mixed deformable goods, in food handling, in laboratory automation where the
consumables arrive in soft packaging. In these settings the object set is open,
the pose is unconstrained, and the surface behaviour under load is the dominant
source of uncertainty @sanchez2018robotic.

Human manipulation solves the same problem with a different information
source. Cutaneous mechanoreceptors in the fingertip report the onset of local
slip roughly one hundred milliseconds before gross slip occurs, and the
observed grip force response is a reflexive increase triggered by that signal
rather than by a visual estimate of object weight @johansson2009coding. The
robotics analogue of this loop has been studied for three decades
@howe1996tactile, and modern optical and capacitive tactile sensors deliver
spatially dense contact images at rates that make the loop realisable
@yuan2017gelsight @lambeta2020digit @kappassov2015tactile.

What has been slower to arrive is the corresponding change in the planner. The
dominant architecture still separates a geometric grasp planner, which chooses
where to place the fingers from a point cloud, from a tactile controller, which
regulates force once the fingers are in contact. The controller can save a
grasp whose geometry is marginal, and it can do so quickly, but it cannot move
the contact to a better place because it holds no representation of what a
better place would be. This thesis takes the position that the tactile image
should re-enter the planner, not only the controller, and that doing so is what
separates recoverable failures from unrecoverable ones.

== Problem statement

We consider a seven-axis arm with a parallel gripper whose two fingers each
carry a dense taxel array. The task is to grasp an object of unknown mass,
unknown surface friction, and unknown compliance, lift it 25 cm, transport it
along a 40 cm path with a peak lateral acceleration of 1.6 m/s#super[2], and
place it without dropping or crushing it. Vision provides a single depth image
before the approach and is not updated during closure, which is the realistic
case for an eye-in-hand camera occluded by its own gripper.

The planner must therefore commit to an approach direction from vision, but it
may revise the finger placement and the force schedule using tactile evidence
gathered during closure. The central question is:

#block(inset: (left: 12pt, right: 12pt), width: 100%)[
  #emph[
    Given a dense tactile observation acquired during closure, can a grasp
    planner revise its own geometric hypothesis quickly enough to change the
    outcome of the grasp, and does that revision matter more than reactive
    force control alone?
  ]
]

Three sub-questions follow. First, what representation of the contact patch is
both recoverable from a taxel array at control rate and sufficient for a
wrench-space quality metric. Second, how the friction available inside that
patch can be estimated without a dedicated probing motion that would defeat the
purpose. Third, when a revision should be executed as a translation of the
fingers along the surface and when the grasp should be abandoned and replanned
from a fresh approach.

== Contributions

The thesis makes four contributions.

+ A contact-patch representation, described in @sec:patch, that summarises a
  40 by 30 taxel field as an area-weighted second moment plus a boundary
  descriptor, and that is recoverable at 180 Hz on the embedded processor
  without leaving integer arithmetic in the inner loop.

+ A grasp quality metric, developed in @sec:metric, that replaces the point
  contact with friction assumption of the classical construction
  @ferrari1992planning @nguyen1988constructing with a patch contact whose
  friction cone aperture is estimated online. The metric reduces to the
  classical one when the patch degenerates to a point, which makes the
  comparison against prior work well posed.

+ An incipient-slip predictor, given in @sec:slip, built from the spatial
  divergence of the measured shear field rather than from its temporal
  derivative. The predictor fires 74 ms before gross slip on average, against
  31 ms for a temporal-derivative baseline, and its false positive rate on
  static holds is 0.6 per minute.

+ An experimental evaluation over 1440 physical grasp trials on 24 objects,
  reported in @sec:results, with an ablation that separates the contribution of
  the planner revision from the contribution of the reactive controller.

== Scope and limitations

The work is restricted to two-finger parallel grasps. Multi-finger and in-hand
manipulation raise questions about contact rolling that the patch
representation used here does not address. The objects are all graspable within
the 85 mm stroke of the gripper and weigh between 40 g and 1.4 kg. Surface
friction coefficients in the object set span 0.24 to 0.91, measured on an
inclined plane against the finger elastomer, but no object changes its friction
during a trial except through the deposition of moisture, which is one of the
two failure modes we characterise in @sec:failures.

No learned component is used in the planner or the controller. This is a
deliberate choice rather than a claim of superiority. A learned grasp policy
trained on tactile data can outperform an analytic one on the distribution it
was trained on @calandra2018more @mahler2017dexnet, but it makes the ablation
we care about, namely the separation of geometric revision from force control,
difficult to perform. The analytic formulation lets us switch one term off at a
time.

== Outline

@sec:background reviews grasp quality metrics, tactile sensing hardware, and
the existing literature on slip detection and tactile regrasping.
@sec:sensing describes the sensor, its calibration, and the contact state
estimator. @sec:planning develops the contact-consistent quality metric and the
sampling procedure that optimises it. @sec:control presents the slip predictor
and the regrasp policy. @sec:evaluation reports the experimental protocol and
results. @sec:conclusion discusses what the results imply for the architecture
of tactile manipulation systems and what remains open.
