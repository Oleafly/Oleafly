#import "../lib/style.typ": *

= Discussion and Conclusion <sec:conclusion>

== What the results say

The headline number, 91.4 percent against 74.2 percent, is not the interesting
result. The interesting result is the shape of the ablation in @tab:main.
Reactive force control, which is the component most systems add first, recovers
roughly half of the gap on deformable objects. The planner revision recovers
the other half, and it does so on top of the reactive controller rather than
instead of it. The two mechanisms address different failures: the controller
saves a grasp whose geometry is adequate but whose force is not, and the
revision loop replaces a geometry that no force will save.

This suggests a design principle that we did not hold at the start of the work.
The value of a tactile sensor in a manipulation system is not proportional to
how quickly the system can react to it. It is proportional to how deep into the
decision hierarchy the signal is allowed to travel. A sensor read at 1 kHz and
consumed only by a force loop is worth less than the same sensor read at 180 Hz
and consumed by a planner that can still change its mind.

== Limitations

Four limitations bound the claim.

The friction estimate of @eq:mu is measured once, at the transition out of the
elastic phase, and is not updated during the hold. On surfaces whose friction
changes under load, which includes every object in our set that accumulates
moisture, this is the dominant residual failure mode. A continuous estimator
that tracks $mu$ through the hold would address it, but the excitation required
to identify $mu$ is precisely the partial slip we are trying to avoid, so the
estimator and the controller have opposed objectives.

The patch representation assumes a single connected contact region. A finger
that straddles a ridge produces two disjoint patches, and the current
implementation takes the larger and discards the other, which underestimates
the available friction. Extending the metric to multiple patches per finger is
straightforward in the wrench-space formulation and was left out only because
no object in the test set required it.

The evaluation uses a single gripper and a single elastomer formulation. The
geometric correction $eta = 0.87$ in @eq:mu was fitted for that pad, and we
have no evidence about how it transfers. The two-stage calibration of
@eq:calib is more portable, since it depends on the array rather than the pad,
but this was not tested across hardware.

Finally, the object set is small by the standards of learned grasping work
@mahler2017dexnet @calandra2018more. Twenty-four objects and 1440 physical
trials is a large campaign for a thesis and a small one for a claim about
generality. The classes are chosen to span the property that matters, which is
compliance, but they do not span the space of shapes.

== Future work

Three directions follow directly.

The first is a continuous friction estimator that uses the natural excitation
of the transport trajectory rather than a deliberate probe. The transport
segment already imposes a time-varying tangential load with a known profile,
and the stuck fraction responds to it. Inverting that response for $mu$ is a
system identification problem with a known input, which is a substantially
easier problem than identifying $mu$ from the closure transient alone.

The second is to extend the patch conditioning to multi-finger hands. The
wrench-space construction of @eq:qpc does not care how many fingers contribute
cells, so the metric extends without modification. What does not extend is the
regrasp policy, since a three-finger hand can reposition one finger while the
other two maintain the grasp, which turns a discrete action choice into a
continuous one.

The third is to reconsider the interface between vision and touch. Our protocol
acquires a single depth image and never updates it, which is realistic for an
occluded eye-in-hand camera but wasteful when an external camera is available.
The revision loop currently predicts the patch that an alternative candidate
would produce by rigidly transporting the observed patch. A visual estimate of
local curvature would improve that prediction, and the improvement would be
concentrated exactly on the articulated objects where our second failure mode
lives.

== Conclusion

We set out to determine whether a grasp planner that revises its geometric
hypothesis from dense tactile feedback outperforms one that only regulates
force in response to the same signal. It does, by 9.4 points overall and by
17.7 points on deformable objects, and the ablation shows that the gain comes
from the revision rather than from the improved contact model alone. The
mechanism is not exotic. It requires an area contact model, an online friction
estimate that is conservative by construction, and enough computational
headroom to rescore a small candidate set at 60 Hz. All three are available on
commodity hardware today.

The broader observation is architectural. Tactile sensing entered robotic
manipulation as a safety and reflex modality, and much of the field still
treats it that way. Treating it instead as a source of geometric evidence, and
routing it into the component that decides where the fingers go, changes the
class of objects a gripper can handle. That change is worth more than a faster
reflex.
