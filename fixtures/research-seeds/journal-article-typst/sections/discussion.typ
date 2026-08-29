= Discussion <sec:discussion>

== The threshold does not follow the particles

If the threshold stress in @eq:threshold were the Orowan stress of the MX
dispersion, it would fall as the particles coarsen. The Orowan contribution for
a dispersion of mean planar spacing $lambda_p$ is

$ sigma_"Orowan" = (M 0.8 G b) / lambda_p, $ <eq:orowan>

with $M = 3.06$ the Taylor factor, $G = 64$ GPa the shear modulus of austenite
at 923 K, and $b = 0.258$ nm the Burgers vector. The values computed from the
measured spacings are in the fifth column of @tab:fit, and they behave as
@eq:orowan requires: 58 MPa, then 44 MPa, then 32 MPa as $lambda_p$ grows from
78 nm to 141 nm. The fitted threshold moves the other way, from 61 MPa to 74
MPa. The two quantities are anticorrelated over the exposure range, which
rules out the dispersion as the sole origin of the threshold. A detached
threshold of the kind that arises from dislocation relaxation at the particle
interface @arzt1998threshold would also decay with coarsening, so that variant
does not rescue the dispersion account either.

What does track the threshold is boundary enrichment. Plotting $sigma_"th"$
against $Gamma_"Nb"$ across all five conditions in @tab:fit, including both
heats, gives a linear relation with a slope of 2.0 MPa per at.% and an
intercept of 57 MPa, with a residual scatter of 2 MPa. The intercept is
consistent with the solution-treated Orowan stress, which is what one would
expect if the total threshold is a sum of a decaying dispersion term and a
growing segregation term. The 3,000 h condition of heat A then decomposes as
roughly 32 MPa of dispersion and 42 MPa of segregation, an inversion of the
solution-treated balance.

== Segregation kinetics and the equilibrium limit

The practical question is where the enrichment stops. Boundary segregation from
a dilute solution approaches the McLean equilibrium

$ X_b / (1 - X_b) = X_c / (1 - X_c) exp( (Delta G_"seg") / (R T) ), $ <eq:mclean>

with $X_b$ the boundary and $X_c$ the bulk atomic fraction, and $Delta
G_"seg"$ the segregation free energy. Fitting @eq:mclean to the heat A series
at 923 K gives $Delta G_"seg" = -41$ kJ mol#super[-1], which sits at the strong
end of the range reported for substitutional segregants in austenite but is not
anomalous @lejcek2010segregation. That value predicts an equilibrium boundary
concentration of 11.2 at.% at 923 K for heat A, so the 3,000 h measurement of
7.4 at.% is at roughly two-thirds of saturation. Extrapolating the approach
with a boundary-diffusion-limited kinetic law places saturation at
approximately $2.4 times 10^4$ h at 923 K, which is inside the design life of
the components this alloy class is used for and outside the range of any
laboratory creep programme we are aware of.

There is a competing sink. Niobium consumed by MX coarsening is niobium not
available to the boundary, and the coarsening we measure is not negligible: the
number density falls by a factor of 2.6 over 3,000 h while the mean radius
grows from 11 nm to 19 nm. A Zener estimate of the boundary pinning that the
same dispersion provides,

$ d_"lim" = (4 r) / (3 f), $ <eq:zener>

with $r$ the mean particle radius and $f$ the volume fraction, gives a limiting
grain size that stays above the measured grain size throughout, so grain growth
is not competing with the segregation measurement. The mass balance is
nevertheless the reason we regard the extrapolated saturation time as a lower
bound on the time to peak strength rather than an estimate of it.

== Consistency with the second heat

Heat B is a check rather than an independent experiment, and it behaves as the
argument predicts. It has 14% less niobium, a nearly identical MX population by
spacing at both exposures, and a boundary enrichment about 53% of heat A at
matched exposure. Its threshold is correspondingly lower and its minimum creep
rate correspondingly higher. If the dispersion were controlling, the two heats
should have been nearly indistinguishable, since @tab:fit shows their particle
spacings agree to within 5%. They differ by a factor of 3.4 in creep rate at
190 MPa.

== Where the description fails

Two boundaries of validity should be stated. First, the threshold fit assumes
$n' = 5$ and $Q_c = 280$ kJ mol#super[-1]. Relaxing $n'$ to a free parameter
gives $n' = 4.6 plus.minus 0.5$ and shifts $sigma_"th"$ by at most 4 MPa, so
the conclusion is not an artefact of that constraint, but the fit is not
independent evidence for the climb mechanism either.

Second, and more seriously, the description fails at high stress. At 260 MPa,
above the range in @tab:creep, the measured rates for both heats fall below the
extrapolation of @eq:threshold, and the rupture surfaces change from
intergranular with wedge cracking to transgranular with dimples. Boundary
sliding is not the rate-controlling process there, so a threshold attributed to
boundary chemistry has no reason to apply. We therefore restrict every
quantitative claim in this paper to the interval 150 MPa to 220 MPa at 923 K,
and we note that the extrapolation to service stresses near 90 MPa carries the
opposite risk: it assumes the mechanism does not change as the stress falls,
which we have not tested.
