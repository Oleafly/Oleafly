//! Statistics calculators for the Tools panel: p-values, sample sizes, and
//! confidence intervals. All distributions and their survival/inverse CDF
//! functions come from `statrs`.

use statrs::distribution::{ChiSquared, ContinuousCDF, Normal, StudentsT};

fn normal_quantile(p: f64) -> Result<f64, String> {
    if !p.is_finite() || !(0.0..1.0).contains(&p) {
        return Err(
            "the confidence level is too close to 0 or 100 percent to calculate a finite interval"
                .into(),
        );
    }
    let quantile = Normal::standard().inverse_cdf(p);
    if !quantile.is_finite() || quantile <= 0.0 {
        return Err(
            "the confidence level is too close to 0 or 100 percent to calculate a finite interval"
                .into(),
        );
    }
    Ok(quantile)
}

fn students_t_quantile(p: f64, df: f64) -> Result<f64, String> {
    let t = StudentsT::new(0.0, 1.0, df).map_err(|e| format!("invalid degrees of freedom: {e}"))?;
    let quantile = t.inverse_cdf(p);
    if !quantile.is_finite() || quantile <= 0.0 {
        return Err(
            "the confidence level is too close to 0 or 100 percent to calculate a finite interval"
                .into(),
        );
    }
    Ok(quantile)
}

fn two_sided_probability(confidence: f64) -> Result<f64, String> {
    let probability = 0.5 + confidence / 200.0;
    if !(0.5..1.0).contains(&probability) {
        return Err(
            "the confidence level is too close to 0 or 100 percent to calculate a finite interval"
                .into(),
        );
    }
    Ok(probability)
}

const MAX_EXACT_COUNT: f64 = 9_007_199_254_740_991.0;

fn valid_count(value: f64, minimum: f64) -> bool {
    value.is_finite() && value >= minimum && value <= MAX_EXACT_COUNT && value.fract() == 0.0
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PValueResult {
    pub p: f64,
    pub label: String,
}

/// p-value for a test statistic. `test`: "t-two", "t-one", "z-two",
/// "z-one", or "chi" (chi-square upper tail). `df` applies to the t and
/// chi-square tests.
#[tauri::command]
pub async fn stats_p_value(
    test: String,
    statistic: f64,
    df: Option<f64>,
) -> Result<PValueResult, String> {
    if !statistic.is_finite() {
        return Err("the test statistic must be a number".into());
    }
    let df = df.unwrap_or(0.0);
    match test.as_str() {
        "z-two" => Ok(PValueResult {
            p: 2.0 * Normal::standard().sf(statistic.abs()),
            label: "Two-tailed z-test".into(),
        }),
        "z-one" => Ok(PValueResult {
            p: Normal::standard().sf(statistic),
            label: "One-tailed z-test (upper tail)".into(),
        }),
        "t-two" | "t-one" => {
            if df <= 0.0 || !df.is_finite() {
                return Err("enter degrees of freedom greater than zero".into());
            }
            let t = StudentsT::new(0.0, 1.0, df)
                .map_err(|e| format!("invalid degrees of freedom: {e}"))?;
            if test == "t-two" {
                Ok(PValueResult {
                    p: 2.0 * t.sf(statistic.abs()),
                    label: format!("Two-tailed t-test ({df} df)"),
                })
            } else {
                let p = t.sf(statistic);
                Ok(PValueResult {
                    p,
                    label: format!("One-tailed t-test, upper tail ({df} df)"),
                })
            }
        }
        "chi" => {
            if df <= 0.0 || !df.is_finite() {
                return Err("enter degrees of freedom greater than zero".into());
            }
            if statistic < 0.0 {
                return Err("a chi-square statistic cannot be negative".into());
            }
            let chi =
                ChiSquared::new(df).map_err(|e| format!("invalid degrees of freedom: {e}"))?;
            Ok(PValueResult {
                p: chi.sf(statistic),
                label: format!("Chi-square, upper tail ({df} df)"),
            })
        }
        _ => Err("unknown test. Choose t-two, t-one, z-two, z-one, or chi.".into()),
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleSizeResult {
    pub z: f64,
    pub infinite_population: u64,
    pub finite_population: Option<u64>,
}

/// Sample size for a proportion: `n0 = z^2 * p(1-p) / e^2`, with the
/// finite-population correction `n = n0 / (1 + (n0-1)/N)` when a population
/// size is given. `proportion`, `margin_error`, and `confidence` are percents
/// (e.g. 50, 5, 95).
#[tauri::command]
pub async fn stats_sample_size(
    proportion: f64,
    margin_error: f64,
    confidence: f64,
    population: Option<f64>,
) -> Result<SampleSizeResult, String> {
    if !proportion.is_finite()
        || !(0.0..=100.0).contains(&proportion)
        || proportion <= 0.0
        || proportion >= 100.0
    {
        return Err("the expected proportion must be between 0 and 100 percent".into());
    }
    if !margin_error.is_finite() || margin_error <= 0.0 || margin_error >= 100.0 {
        return Err("the margin of error must be between 0 and 100 percent".into());
    }
    if !confidence.is_finite() || confidence <= 0.0 || confidence >= 100.0 {
        return Err("the confidence level must be between 0 and 100 percent".into());
    }
    if let Some(n) = population {
        if !valid_count(n, 1.0) {
            return Err(
                "the population size must be a whole number between 1 and 9 quadrillion".into(),
            );
        }
    }
    let p = proportion / 100.0;
    let e = margin_error / 100.0;
    let z = normal_quantile(two_sided_probability(confidence)?)?;
    let n0 = z * z * p * (1.0 - p) / (e * e);
    if !n0.is_finite() || n0 <= 0.0 || n0 > MAX_EXACT_COUNT {
        return Err(
            "these inputs require a sample size outside the supported numeric range".into(),
        );
    }
    let finite = population.map(|n| (n * n0 / ((n - 1.0) + n0)).ceil().min(n) as u64);
    Ok(SampleSizeResult {
        z,
        infinite_population: n0.ceil() as u64,
        finite_population: finite,
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceIntervalResult {
    pub point_estimate: f64,
    pub lower: f64,
    pub upper: f64,
    pub standard_error: f64,
    pub margin_of_error: f64,
    pub critical_value: f64,
    pub critical_label: String,
    pub degrees_of_freedom: Option<f64>,
    pub interval_method: String,
}

/// Confidence interval for a mean (`mode = "mean"`: mean, sd, n) or a
/// proportion (`mode = "proportion"`: successes out of n). `confidence` is a
/// percent. Mean intervals use the t distribution; proportions use the Wilson
/// score interval.
#[tauri::command]
pub async fn stats_confidence_interval(
    mode: String,
    confidence: f64,
    mean: Option<f64>,
    sd: Option<f64>,
    n: Option<f64>,
    successes: Option<f64>,
) -> Result<ConfidenceIntervalResult, String> {
    if !confidence.is_finite() || confidence <= 0.0 || confidence >= 100.0 {
        return Err("the confidence level must be between 0 and 100 percent".into());
    }
    let n = n.unwrap_or(0.0);
    let probability = two_sided_probability(confidence)?;
    match mode.as_str() {
        "mean" => {
            let mean = mean
                .ok_or_else(|| "enter the sample mean".to_string())?
                .is_finite()
                .then_some(mean.unwrap());
            let mean = mean.ok_or_else(|| "the sample mean must be a number".to_string())?;
            let sd = sd
                .ok_or_else(|| "enter the sample standard deviation".to_string())?
                .is_finite()
                .then_some(sd.unwrap());
            let sd = sd.ok_or_else(|| "the standard deviation must be a number".to_string())?;
            if sd < 0.0 {
                return Err("the standard deviation cannot be negative".into());
            }
            if !valid_count(n, 2.0) {
                return Err(
                    "the sample size must be a whole number between 2 and 9 quadrillion".into(),
                );
            }
            let df = n - 1.0;
            let t = students_t_quantile(probability, df)?;
            let se = sd / n.sqrt();
            let moe = t * se;
            if !se.is_finite() || !moe.is_finite() {
                return Err("these inputs overflow the confidence interval calculation".into());
            }
            let lower = mean - moe;
            let upper = mean + moe;
            if !lower.is_finite() || !upper.is_finite() {
                return Err("these inputs overflow the confidence interval calculation".into());
            }
            Ok(ConfidenceIntervalResult {
                point_estimate: mean,
                lower,
                upper,
                standard_error: se,
                margin_of_error: moe,
                critical_value: t,
                critical_label: "t".into(),
                degrees_of_freedom: Some(df),
                interval_method: "t interval for a mean".into(),
            })
        }
        "proportion" => {
            let successes = successes.ok_or_else(|| "enter the number of successes".to_string())?;
            if !valid_count(successes, 0.0) {
                return Err(
                    "the number of successes must be a whole number between 0 and 9 quadrillion"
                        .into(),
                );
            }
            if !valid_count(n, 1.0) {
                return Err(
                    "the sample size must be a whole number between 1 and 9 quadrillion".into(),
                );
            }
            if successes > n {
                return Err("the number of successes cannot exceed the sample size".into());
            }
            let p_hat = successes / n;
            let z = normal_quantile(probability)?;
            // Wilson's score interval remains informative for zero/all
            // successes, unlike the Wald interval whose width collapses.
            let z_squared = z * z;
            let denominator = 1.0 + z_squared / n;
            let center = (p_hat + z_squared / (2.0 * n)) / denominator;
            let moe =
                z / denominator * (p_hat * (1.0 - p_hat) / n + z_squared / (4.0 * n * n)).sqrt();
            let se = (p_hat * (1.0 - p_hat) / n).sqrt();
            if !denominator.is_finite()
                || !center.is_finite()
                || !moe.is_finite()
                || !se.is_finite()
            {
                return Err("these inputs overflow the confidence interval calculation".into());
            }
            Ok(ConfidenceIntervalResult {
                point_estimate: p_hat,
                lower: if successes == 0.0 {
                    0.0
                } else {
                    (center - moe).max(0.0)
                },
                upper: if successes == n {
                    1.0
                } else {
                    (center + moe).min(1.0)
                },
                standard_error: se,
                margin_of_error: moe,
                critical_value: z,
                critical_label: "z".into(),
                degrees_of_freedom: None,
                interval_method: "Wilson score interval for a proportion".into(),
            })
        }
        _ => Err("unknown mode. Choose mean or proportion.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_population_of_one_stays_one_at_low_confidence() {
        let result = stats_sample_size(50.0, 99.0, 0.000_001, Some(1.0))
            .await
            .unwrap();
        assert_eq!(result.infinite_population, 1);
        assert_eq!(result.finite_population, Some(1));
    }

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn normal_quantile_matches_tables() {
        assert!(close(normal_quantile(0.975).unwrap(), 1.959964, 1e-4));
        assert!(close(normal_quantile(0.95).unwrap(), 1.644854, 1e-4));
    }

    #[test]
    fn students_t_quantile_matches_tables() {
        assert!(close(
            students_t_quantile(0.975, 9.0).unwrap(),
            2.262157,
            1e-4
        ));
        assert!(close(
            students_t_quantile(0.975, 29.0).unwrap(),
            2.045230,
            1e-4
        ));
        assert!(close(
            students_t_quantile(0.95, 4.0).unwrap(),
            2.131847,
            1e-4
        ));
        assert!(students_t_quantile(0.999_999_999_999, 1.0).unwrap() > 10_000.0);
    }

    #[tokio::test]
    async fn p_values_match_reference_implementation() {
        // Two-tailed t with t=2.34, df=28.
        let r = stats_p_value("t-two".into(), 2.34, Some(28.0))
            .await
            .unwrap();
        assert!(close(r.p, 0.026640, 1e-5), "p = {}", r.p);
        // Two-tailed z with z=1.96.
        let r = stats_p_value("z-two".into(), 1.96, None).await.unwrap();
        assert!(close(r.p, 0.049996, 1e-4), "p = {}", r.p);
        let r = stats_p_value("z-two".into(), 10.0, None).await.unwrap();
        assert!(r.p > 0.0 && r.p < 2e-22, "p = {}", r.p);
        // Chi-square upper tail, chi2=11.07, df=5 -> p ~= 0.05.
        let r = stats_p_value("chi".into(), 11.0705, Some(5.0))
            .await
            .unwrap();
        assert!(close(r.p, 0.05, 1e-3), "p = {}", r.p);
        // One-tailed t (upper) with t=-2.0, df=10.
        let r = stats_p_value("t-one".into(), -2.0, Some(10.0))
            .await
            .unwrap();
        assert!(close(r.p, 0.96330, 1e-4), "p = {}", r.p);
    }

    #[tokio::test]
    async fn sample_size_matches_reference_formula() {
        // 50% proportion, 5% margin, 95% confidence: n0 = 384.16 -> 385.
        let r = stats_sample_size(50.0, 5.0, 95.0, None).await.unwrap();
        assert_eq!(r.infinite_population, 385);
        assert!(close(r.z, 1.959964, 1e-4));
        // With a population of 1000 the corrected size is 278.
        let r = stats_sample_size(50.0, 5.0, 95.0, Some(1000.0))
            .await
            .unwrap();
        assert_eq!(r.finite_population, Some(278));
    }

    #[tokio::test]
    async fn rejects_non_finite_sample_size_inputs() {
        assert!(stats_sample_size(f64::NAN, 5.0, 95.0, None).await.is_err());
        assert!(stats_sample_size(50.0, f64::INFINITY, 95.0, None)
            .await
            .is_err());
        assert!(stats_confidence_interval(
            "mean".into(),
            f64::NAN,
            Some(1.0),
            Some(1.0),
            Some(2.0),
            None
        )
        .await
        .is_err());
        assert!(stats_confidence_interval(
            "proportion".into(),
            95.0,
            None,
            None,
            Some(10.5),
            Some(2.0)
        )
        .await
        .is_err());
        assert!(stats_confidence_interval(
            "proportion".into(),
            95.0,
            None,
            None,
            Some(10.0),
            Some(2.5)
        )
        .await
        .is_err());
        // A finite percentage can still round to an unusable inverse-CDF
        // probability at either endpoint.
        assert!(stats_sample_size(50.0, 5.0, 99.999_999_999_999_99, None)
            .await
            .is_err());
        assert!(stats_confidence_interval(
            "mean".into(),
            f64::MIN_POSITIVE,
            Some(1.0),
            Some(1.0),
            Some(2.0),
            None,
        )
        .await
        .is_err());
        assert!(stats_confidence_interval(
            "mean".into(),
            95.0,
            Some(f64::MAX),
            Some(1.0e307),
            Some(100.0),
            None,
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn confidence_intervals_match_reference_formula() {
        // Mean 100, sd 15, n 9, 95%: t(8) = 2.306004, moe = 11.53.
        let r = stats_confidence_interval(
            "mean".into(),
            95.0,
            Some(100.0),
            Some(15.0),
            Some(9.0),
            None,
        )
        .await
        .unwrap();
        assert!(close(r.critical_value, 2.306004, 1e-4));
        assert!(
            close(r.margin_of_error, 11.530, 1e-3),
            "moe = {}",
            r.margin_of_error
        );
        assert!(close(r.lower, 88.470, 1e-3));
        // Proportion 81/263, 95% Wilson score interval.
        let r = stats_confidence_interval(
            "proportion".into(),
            95.0,
            None,
            None,
            Some(263.0),
            Some(81.0),
        )
        .await
        .unwrap();
        assert!(close(r.point_estimate, 0.307985, 1e-5));
        assert!(r.lower < r.point_estimate && r.point_estimate < r.upper);
        assert_eq!(r.interval_method, "Wilson score interval for a proportion");
        assert!(close(
            r.standard_error,
            (r.point_estimate * (1.0 - r.point_estimate) / 263.0).sqrt(),
            1e-12,
        ));
        let zero =
            stats_confidence_interval("proportion".into(), 95.0, None, None, Some(10.0), Some(0.0))
                .await
                .unwrap();
        assert!(close(zero.upper, 0.2775, 1e-4), "upper = {}", zero.upper);
        assert_eq!(zero.lower, 0.0);
        let all = stats_confidence_interval(
            "proportion".into(),
            95.0,
            None,
            None,
            Some(10.0),
            Some(10.0),
        )
        .await
        .unwrap();
        assert_eq!(all.upper, 1.0);
        assert!(close(all.lower, 1.0 - zero.upper, 1e-12));
    }
}
