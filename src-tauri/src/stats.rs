//! Statistics calculators for the Tools panel: p-values, sample sizes, and
//! confidence intervals. All distributions come from `statrs`; quantiles are
//! solved by bisection on the CDF so the inverse functions need no extra
//! trait plumbing and stay exactly testable against textbook values.

use statrs::distribution::{ChiSquared, ContinuousCDF, Normal, StudentsT};

/// Solve `cdf(x) = p` by bisection. The CDF is monotone, so ~100 halvings
/// converge to double-precision resolution.
fn quantile_by_bisection(cdf: impl Fn(f64) -> f64, p: f64, mut lo: f64, mut hi: f64) -> f64 {
    for _ in 0..200 {
        let mid = lo + (hi - lo) / 2.0;
        if cdf(mid) < p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo + (hi - lo) / 2.0
}

fn normal_quantile(p: f64) -> f64 {
    quantile_by_bisection(|x| Normal::standard().cdf(x), p, -40.0, 40.0)
}

fn students_t_quantile(p: f64, df: f64) -> Result<f64, String> {
    let t = StudentsT::new(0.0, 1.0, df).map_err(|e| format!("invalid degrees of freedom: {e}"))?;
    Ok(quantile_by_bisection(|x| t.cdf(x), p, -1e4, 1e4))
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
            p: 2.0 * (1.0 - Normal::standard().cdf(statistic.abs())),
            label: "Two-tailed z-test".into(),
        }),
        "z-one" => Ok(PValueResult {
            p: 1.0 - Normal::standard().cdf(statistic),
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
                    p: 2.0 * (1.0 - t.cdf(statistic.abs())),
                    label: format!("Two-tailed t-test ({df} df)"),
                })
            } else {
                let p = 1.0 - t.cdf(statistic);
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
                p: 1.0 - chi.cdf(statistic),
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
    if !(0.0..=100.0).contains(&proportion) || proportion <= 0.0 || proportion >= 100.0 {
        return Err("the expected proportion must be between 0 and 100 percent".into());
    }
    if margin_error <= 0.0 || margin_error >= 100.0 {
        return Err("the margin of error must be between 0 and 100 percent".into());
    }
    if confidence <= 0.0 || confidence >= 100.0 {
        return Err("the confidence level must be between 0 and 100 percent".into());
    }
    if let Some(n) = population {
        if !n.is_finite() || n < 1.0 {
            return Err("the population size must be at least 1".into());
        }
    }
    let p = proportion / 100.0;
    let e = margin_error / 100.0;
    let z = normal_quantile(1.0 - (1.0 - confidence / 100.0) / 2.0);
    let n0 = z * z * p * (1.0 - p) / (e * e);
    let finite = population.map(|n| (n0 / (1.0 + (n0 - 1.0) / n)).ceil() as u64);
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
}

/// Confidence interval for a mean (`mode = "mean"`: mean, sd, n) or a
/// proportion (`mode = "proportion"`: successes out of n). `confidence` is a
/// percent. Mean intervals use the t distribution; proportions use Wald.
#[tauri::command]
pub async fn stats_confidence_interval(
    mode: String,
    confidence: f64,
    mean: Option<f64>,
    sd: Option<f64>,
    n: Option<f64>,
    successes: Option<f64>,
) -> Result<ConfidenceIntervalResult, String> {
    if confidence <= 0.0 || confidence >= 100.0 {
        return Err("the confidence level must be between 0 and 100 percent".into());
    }
    let n = n.unwrap_or(0.0);
    let alpha = 1.0 - confidence / 100.0;
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
            if n <= 1.0 || !n.is_finite() {
                return Err("the sample size must be greater than 1".into());
            }
            let df = n - 1.0;
            let t = students_t_quantile(1.0 - alpha / 2.0, df)?;
            let se = sd / n.sqrt();
            let moe = t * se;
            Ok(ConfidenceIntervalResult {
                point_estimate: mean,
                lower: mean - moe,
                upper: mean + moe,
                standard_error: se,
                margin_of_error: moe,
                critical_value: t,
                critical_label: "t".into(),
                degrees_of_freedom: Some(df),
            })
        }
        "proportion" => {
            let successes = successes.ok_or_else(|| "enter the number of successes".to_string())?;
            if !(successes.is_finite()) || successes < 0.0 {
                return Err("the number of successes must be zero or more".into());
            }
            if n <= 0.0 || !n.is_finite() {
                return Err("the sample size must be greater than 0".into());
            }
            if successes > n {
                return Err("the number of successes cannot exceed the sample size".into());
            }
            let p_hat = successes / n;
            let z = normal_quantile(1.0 - alpha / 2.0);
            let se = (p_hat * (1.0 - p_hat) / n).sqrt();
            let moe = z * se;
            Ok(ConfidenceIntervalResult {
                point_estimate: p_hat,
                lower: (p_hat - moe).max(0.0),
                upper: (p_hat + moe).min(1.0),
                standard_error: se,
                margin_of_error: moe,
                critical_value: z,
                critical_label: "z".into(),
                degrees_of_freedom: None,
            })
        }
        _ => Err("unknown mode. Choose mean or proportion.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn normal_quantile_matches_tables() {
        assert!(close(normal_quantile(0.975), 1.959964, 1e-4));
        assert!(close(normal_quantile(0.95), 1.644854, 1e-4));
        assert!(close(normal_quantile(0.5), 0.0, 1e-9));
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
        // Proportion 81/263, 95%: p̂ = 0.30798, Wald moe = 0.05568.
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
        assert!(
            close(r.margin_of_error, 0.055795, 1e-5),
            "moe = {}",
            r.margin_of_error
        );
        assert!(r.lower >= 0.0 && r.upper <= 1.0);
    }
}
