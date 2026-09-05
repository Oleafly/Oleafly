use std::collections::HashSet;
use std::path::Path;

use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::ai_model_metadata::{MetadataSnapshot, ModelCost};

const DAY_MS: i64 = 86_400_000;
const DEFAULT_RANGE_DAYS: i64 = 30;
const MAX_RANGE_DAYS: i64 = 366;
const MAX_FILTER_VALUES: usize = 64;
const MAX_PAGE_SIZE: u32 = 100;
const MAX_ID_BYTES: usize = 512;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEventInput {
    pub event_id: String,
    pub source_id: String,
    pub source_turn_id: String,
    pub project_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    pub session_id: String,
    #[serde(default)]
    pub parent_session_id: Option<String>,
    #[serde(default)]
    pub parent_record_key: Option<String>,
    pub runtime_id: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    pub occurred_at_ms: i64,
    #[serde(default)]
    pub observation_sequence: Option<i64>,
    #[serde(default)]
    pub input_tokens: Option<i64>,
    #[serde(default)]
    pub output_tokens: Option<i64>,
    #[serde(default)]
    pub cache_read_tokens: Option<i64>,
    #[serde(default)]
    pub cache_write_tokens: Option<i64>,
    pub input_semantics: String,
    pub counter_semantics: String,
    pub measurement: String,
    pub billing_mode: String,
    #[serde(default)]
    pub estimated_cost_usd: Option<f64>,
    #[serde(default)]
    pub price_version: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    pub status: String,
    #[serde(default = "default_aggregation_scope")]
    pub aggregation_scope: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecordResult {
    pub record_key: String,
    pub inserted: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UsageCostEstimate {
    pub estimated_cost_usd: f64,
    pub price_version: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEstimateInput {
    pub source_id: String,
    pub source_turn_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReportFilter {
    #[serde(default)]
    pub start_ms: Option<i64>,
    #[serde(default)]
    pub end_ms: Option<i64>,
    #[serde(default)]
    pub project_ids: Vec<String>,
    #[serde(default)]
    pub runtime_ids: Vec<String>,
    #[serde(default)]
    pub provider_ids: Vec<String>,
    #[serde(default)]
    pub model_ids: Vec<String>,
    #[serde(default)]
    pub session_ids: Vec<String>,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub page_size: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReportTotals {
    pub record_count: i64,
    pub session_count: i64,
    pub input_total: i64,
    pub input_known_records: i64,
    pub input_unknown_records: i64,
    pub input_fresh: i64,
    pub input_fresh_known_records: i64,
    pub output_total: i64,
    pub output_known_records: i64,
    pub output_unknown_records: i64,
    pub cache_read_total: i64,
    pub cache_write_total: i64,
    pub cache_known_records: i64,
    pub cache_unknown_records: i64,
    pub cache_rate: Option<f64>,
    pub estimated_cost_usd: f64,
    pub cost_known_records: i64,
    pub cost_unknown_records: i64,
    pub reported_records: i64,
    pub estimated_records: i64,
    pub unavailable_records: i64,
    pub excluded_child_records: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTrendPoint {
    pub day: String,
    pub input_total: Option<i64>,
    pub output_total: Option<i64>,
    pub cache_read_total: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
    pub record_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHeatmapCell {
    pub weekday: u8,
    pub hour: u8,
    pub token_total: Option<i64>,
    pub record_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBreakdown {
    pub key: String,
    pub input_total: Option<i64>,
    pub output_total: Option<i64>,
    pub cache_read_total: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
    pub record_count: i64,
    pub session_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSessionDetail {
    pub session_id: String,
    pub project_id: String,
    pub runtime_id: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub occurred_at_ms: i64,
    pub input_total: Option<i64>,
    pub output_total: Option<i64>,
    pub cache_read_total: Option<i64>,
    pub cache_write_total: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
    pub price_version: Option<String>,
    pub record_count: i64,
    pub status: String,
    pub measurement: String,
    pub billing_mode: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSessionPage {
    pub items: Vec<UsageSessionDetail>,
    pub page: u32,
    pub page_size: u32,
    pub total: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub start_ms: i64,
    pub end_ms: i64,
    pub timezone: String,
    pub generated_at_ms: i64,
    pub totals: UsageReportTotals,
    pub daily: Vec<UsageTrendPoint>,
    pub heatmap: Vec<UsageHeatmapCell>,
    pub by_project: Vec<UsageBreakdown>,
    pub by_runtime: Vec<UsageBreakdown>,
    pub by_provider: Vec<UsageBreakdown>,
    pub by_model: Vec<UsageBreakdown>,
    pub sessions: UsageSessionPage,
}

struct NormalizedFilter {
    start_ms: i64,
    end_ms: i64,
    project_ids: Vec<String>,
    runtime_ids: Vec<String>,
    provider_ids: Vec<String>,
    model_ids: Vec<String>,
    session_ids: Vec<String>,
    page: u32,
    page_size: u32,
}

fn default_aggregation_scope() -> String {
    "self".into()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn require_id(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if value.len() > MAX_ID_BYTES {
        return Err(format!("{field} is too long"));
    }
    Ok(())
}

fn validate_optional_id(value: &Option<String>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        require_id(value, field)?;
    }
    Ok(())
}

fn validate_counter(value: Option<i64>, field: &str) -> Result<(), String> {
    if value.is_some_and(|counter| counter < 0) {
        return Err(format!("{field} must be nonnegative"));
    }
    Ok(())
}

fn allowed(value: &str, choices: &[&str], field: &str) -> Result<(), String> {
    if choices.contains(&value) {
        Ok(())
    } else {
        Err(format!("{field} has an unsupported value"))
    }
}

fn validate_event(event: &UsageEventInput) -> Result<(), String> {
    require_id(&event.event_id, "eventId")?;
    require_id(&event.source_id, "sourceId")?;
    require_id(&event.source_turn_id, "sourceTurnId")?;
    require_id(&event.project_id, "projectId")?;
    require_id(&event.session_id, "sessionId")?;
    require_id(&event.runtime_id, "runtimeId")?;
    validate_optional_id(&event.task_id, "taskId")?;
    validate_optional_id(&event.parent_session_id, "parentSessionId")?;
    validate_optional_id(&event.parent_record_key, "parentRecordKey")?;
    validate_optional_id(&event.provider_id, "providerId")?;
    validate_optional_id(&event.model_id, "modelId")?;
    validate_optional_id(&event.price_version, "priceVersion")?;
    if event.occurred_at_ms < 0 {
        return Err("occurredAtMs must be nonnegative".into());
    }
    validate_counter(event.input_tokens, "inputTokens")?;
    validate_counter(event.output_tokens, "outputTokens")?;
    validate_counter(event.cache_read_tokens, "cacheReadTokens")?;
    validate_counter(event.cache_write_tokens, "cacheWriteTokens")?;
    validate_counter(event.duration_ms, "durationMs")?;
    if let (Some(cache_read), Some(cache_write)) =
        (event.cache_read_tokens, event.cache_write_tokens)
    {
        let cache_total = cache_read
            .checked_add(cache_write)
            .ok_or("normalized cache token count is too large")?;
        if event.input_semantics == "exclusive" {
            if let Some(input) = event.input_tokens {
                input
                    .checked_add(cache_total)
                    .ok_or("normalized input token count is too large")?;
            }
        }
    }
    if event
        .estimated_cost_usd
        .is_some_and(|cost| !cost.is_finite() || cost < 0.0)
    {
        return Err("estimatedCostUsd must be a finite nonnegative number".into());
    }
    if event.estimated_cost_usd.is_some() != event.price_version.is_some() {
        return Err("estimatedCostUsd and priceVersion must be provided together".into());
    }
    allowed(
        &event.input_semantics,
        &["inclusive", "exclusive", "unknown"],
        "inputSemantics",
    )?;
    allowed(
        &event.counter_semantics,
        &["delta", "cumulative"],
        "counterSemantics",
    )?;
    allowed(
        &event.measurement,
        &[
            "provider_reported",
            "runtime_reported",
            "estimated",
            "unavailable",
        ],
        "measurement",
    )?;
    allowed(
        &event.billing_mode,
        &["api", "subscription", "local", "unknown"],
        "billingMode",
    )?;
    allowed(
        &event.status,
        &[
            "in_progress",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
        ],
        "status",
    )?;
    allowed(
        &event.aggregation_scope,
        &["self", "includes_children"],
        "aggregationScope",
    )
}

fn stable_record_key(source_id: &str, identity: &str) -> String {
    format!("{}:{}:{}", source_id.len(), source_id, identity)
}

fn record_key(event: &UsageEventInput) -> String {
    let identity = if event.counter_semantics == "cumulative" {
        &event.source_turn_id
    } else {
        &event.event_id
    };
    stable_record_key(&event.source_id, identity)
}

fn priced_tokens(tokens: i64, price_per_million: Option<f64>) -> Option<f64> {
    if tokens == 0 {
        return Some(0.0);
    }
    let price = price_per_million?;
    if !price.is_finite() || price < 0.0 {
        return None;
    }
    Some(tokens as f64 * price / 1_000_000.0)
}

fn estimate_cost_from_rates(event: &UsageEventInput, rates: &ModelCost) -> Option<f64> {
    let input = event.input_tokens?;
    let output = event.output_tokens?;
    let cache_read = event.cache_read_tokens?;
    let cache_write = event.cache_write_tokens?;
    if input < 0 || output < 0 || cache_read < 0 || cache_write < 0 || cache_write > 0 {
        return None;
    }
    let fresh_input = match event.input_semantics.as_str() {
        "inclusive" => input.checked_sub(cache_read)?.checked_sub(cache_write)?,
        "exclusive" => input,
        _ => return None,
    };
    if fresh_input < 0 {
        return None;
    }
    let estimate = priced_tokens(fresh_input, rates.input)?
        + priced_tokens(output, rates.output)?
        + priced_tokens(cache_read, rates.cache_read)?;
    estimate.is_finite().then_some(estimate)
}

pub fn estimate_usage_cost(
    snapshot: &MetadataSnapshot,
    event: &UsageEventInput,
) -> Option<UsageCostEstimate> {
    if event.billing_mode != "api" {
        return None;
    }
    let provider_id = event.provider_id.as_deref()?;
    let model_id = event.model_id.as_deref()?;
    let rates = snapshot.lookup(provider_id, model_id)?.cost.as_ref()?;
    let estimated_cost_usd = estimate_cost_from_rates(event, rates)?;
    Some(UsageCostEstimate {
        estimated_cost_usd,
        price_version: format!("model-metadata:{}", snapshot.generated_at()),
    })
}

pub fn apply_model_metadata_cost(snapshot: &MetadataSnapshot, event: &mut UsageEventInput) -> bool {
    event.estimated_cost_usd = None;
    event.price_version = None;
    let Some(estimate) = estimate_usage_cost(snapshot, event) else {
        return false;
    };
    event.estimated_cost_usd = Some(estimate.estimated_cost_usd);
    event.price_version = Some(estimate.price_version);
    true
}

pub fn record_usage_observation(
    root: &Path,
    event: &UsageEventInput,
) -> Result<UsageRecordResult, String> {
    validate_event(event)?;
    if event.observation_sequence.is_some_and(|value| value < 0) {
        return Err("Usage observation sequence must be nonnegative.".into());
    }
    let conn = crate::library_db::open(root)?;
    record_event_with_connection(&conn, event)
}

fn record_event_with_connection(
    conn: &Connection,
    event: &UsageEventInput,
) -> Result<UsageRecordResult, String> {
    let key = record_key(event);
    let authoritative = "excluded.observation_sequence IS NOT NULL";
    let snapshot_advanced = "(
        (excluded.input_tokens IS NOT NULL AND
            (usage_records.input_tokens IS NULL OR excluded.input_tokens > usage_records.input_tokens))
        OR (excluded.output_tokens IS NOT NULL AND
            (usage_records.output_tokens IS NULL OR excluded.output_tokens > usage_records.output_tokens))
        OR (excluded.cache_read_tokens IS NOT NULL AND
            (usage_records.cache_read_tokens IS NULL OR excluded.cache_read_tokens > usage_records.cache_read_tokens))
        OR (excluded.cache_write_tokens IS NOT NULL AND
            (usage_records.cache_write_tokens IS NULL OR excluded.cache_write_tokens > usage_records.cache_write_tokens))
    )";
    let pricing_provenance_changed = "(
        (excluded.provider_id IS NOT NULL AND excluded.provider_id IS NOT usage_records.provider_id)
        OR (excluded.model_id IS NOT NULL AND excluded.model_id IS NOT usage_records.model_id)
        OR (excluded.billing_mode != 'unknown' AND excluded.billing_mode != usage_records.billing_mode)
        OR (excluded.input_semantics != 'unknown' AND excluded.input_semantics != usage_records.input_semantics)
    )";
    let sql = format!(
        "INSERT INTO usage_records (
            record_key, event_id, source_id, source_turn_id, project_id,
            task_id, session_id, parent_session_id, parent_record_key,
            runtime_id, provider_id, model_id, occurred_at_ms,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            input_semantics, counter_semantics, measurement, billing_mode,
            estimated_cost_usd, price_version, duration_ms, status,
            aggregation_scope, updated_at_ms, observation_sequence
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24,
            ?25, ?26, ?27, ?28
         )
         ON CONFLICT(record_key) DO UPDATE SET
            event_id = excluded.event_id,
            project_id = excluded.project_id,
            task_id = excluded.task_id,
            session_id = excluded.session_id,
            parent_session_id = excluded.parent_session_id,
            parent_record_key = excluded.parent_record_key,
            runtime_id = excluded.runtime_id,
            provider_id = CASE
                WHEN {authoritative} THEN excluded.provider_id
                WHEN excluded.counter_semantics = 'cumulative'
                     AND excluded.provider_id IS NULL AND {snapshot_advanced} THEN NULL
                ELSE COALESCE(excluded.provider_id, usage_records.provider_id)
            END,
            model_id = CASE
                WHEN {authoritative} THEN excluded.model_id
                WHEN excluded.counter_semantics = 'cumulative'
                     AND excluded.model_id IS NULL AND {snapshot_advanced} THEN NULL
                ELSE COALESCE(excluded.model_id, usage_records.model_id)
            END,
            occurred_at_ms = MIN(usage_records.occurred_at_ms, excluded.occurred_at_ms),
            input_tokens = CASE
                WHEN {authoritative} THEN excluded.input_tokens
                WHEN excluded.counter_semantics = 'cumulative'
                     AND excluded.input_tokens IS NULL AND {snapshot_advanced} THEN NULL
                WHEN excluded.counter_semantics = 'cumulative' THEN
                    CASE
                        WHEN usage_records.input_tokens IS NULL THEN excluded.input_tokens
                        WHEN excluded.input_tokens IS NULL THEN usage_records.input_tokens
                        ELSE MAX(usage_records.input_tokens, excluded.input_tokens)
                    END
                ELSE excluded.input_tokens
            END,
            output_tokens = CASE
                WHEN {authoritative} THEN excluded.output_tokens
                WHEN excluded.counter_semantics = 'cumulative'
                     AND excluded.output_tokens IS NULL AND {snapshot_advanced} THEN NULL
                WHEN excluded.counter_semantics = 'cumulative' THEN
                    CASE
                        WHEN usage_records.output_tokens IS NULL THEN excluded.output_tokens
                        WHEN excluded.output_tokens IS NULL THEN usage_records.output_tokens
                        ELSE MAX(usage_records.output_tokens, excluded.output_tokens)
                    END
                ELSE excluded.output_tokens
            END,
            cache_read_tokens = CASE
                WHEN {authoritative} THEN excluded.cache_read_tokens
                WHEN excluded.counter_semantics = 'cumulative'
                     AND excluded.cache_read_tokens IS NULL AND {snapshot_advanced} THEN NULL
                WHEN excluded.counter_semantics = 'cumulative' THEN
                    CASE
                        WHEN usage_records.cache_read_tokens IS NULL THEN excluded.cache_read_tokens
                        WHEN excluded.cache_read_tokens IS NULL THEN usage_records.cache_read_tokens
                        ELSE MAX(usage_records.cache_read_tokens, excluded.cache_read_tokens)
                    END
                ELSE excluded.cache_read_tokens
            END,
            cache_write_tokens = CASE
                WHEN {authoritative} THEN excluded.cache_write_tokens
                WHEN excluded.counter_semantics = 'cumulative'
                     AND excluded.cache_write_tokens IS NULL AND {snapshot_advanced} THEN NULL
                WHEN excluded.counter_semantics = 'cumulative' THEN
                    CASE
                        WHEN usage_records.cache_write_tokens IS NULL THEN excluded.cache_write_tokens
                        WHEN excluded.cache_write_tokens IS NULL THEN usage_records.cache_write_tokens
                        ELSE MAX(usage_records.cache_write_tokens, excluded.cache_write_tokens)
                    END
                ELSE excluded.cache_write_tokens
            END,
            input_semantics = CASE
                WHEN {authoritative} THEN excluded.input_semantics
                WHEN excluded.input_semantics = 'unknown' AND {snapshot_advanced} THEN 'unknown'
                WHEN excluded.input_semantics = 'unknown' THEN usage_records.input_semantics
                ELSE excluded.input_semantics
            END,
            counter_semantics = excluded.counter_semantics,
            measurement = CASE
                WHEN {authoritative} THEN excluded.measurement
                WHEN usage_records.measurement = 'provider_reported' THEN usage_records.measurement
                ELSE excluded.measurement
            END,
            billing_mode = CASE
                WHEN {authoritative} THEN excluded.billing_mode
                WHEN excluded.billing_mode = 'unknown' AND {snapshot_advanced} THEN 'unknown'
                WHEN excluded.billing_mode = 'unknown' THEN usage_records.billing_mode
                ELSE excluded.billing_mode
            END,
            estimated_cost_usd = CASE
                WHEN {authoritative} THEN excluded.estimated_cost_usd
                WHEN excluded.counter_semantics != 'cumulative' THEN excluded.estimated_cost_usd
                WHEN excluded.estimated_cost_usd IS NOT NULL THEN excluded.estimated_cost_usd
                WHEN {snapshot_advanced} OR {pricing_provenance_changed} THEN NULL
                ELSE usage_records.estimated_cost_usd
            END,
            price_version = CASE
                WHEN {authoritative} THEN excluded.price_version
                WHEN excluded.counter_semantics != 'cumulative' THEN excluded.price_version
                WHEN excluded.estimated_cost_usd IS NOT NULL THEN excluded.price_version
                WHEN {snapshot_advanced} OR {pricing_provenance_changed} THEN NULL
                ELSE usage_records.price_version
            END,
            duration_ms = CASE
                WHEN usage_records.duration_ms IS NULL THEN excluded.duration_ms
                WHEN excluded.duration_ms IS NULL THEN usage_records.duration_ms
                ELSE MAX(usage_records.duration_ms, excluded.duration_ms)
            END,
            status = CASE
                WHEN usage_records.status != 'in_progress' AND excluded.status = 'in_progress'
                    THEN usage_records.status
                ELSE excluded.status
            END,
            aggregation_scope = excluded.aggregation_scope,
            updated_at_ms = excluded.updated_at_ms,
            observation_sequence = excluded.observation_sequence
         WHERE usage_records.observation_sequence IS NULL
            OR excluded.observation_sequence > usage_records.observation_sequence",
        authoritative = authoritative,
        snapshot_advanced = snapshot_advanced,
        pricing_provenance_changed = pricing_provenance_changed,
    );
    let inserted = conn
        .query_row(
            "SELECT 1 FROM usage_records WHERE record_key = ?1",
            [&key],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| format!("usage record lookup failed: {error}"))?
        .is_none();
    conn.execute(
        &sql,
        params![
            key,
            event.event_id,
            event.source_id,
            event.source_turn_id,
            event.project_id,
            event.task_id,
            event.session_id,
            event.parent_session_id,
            event.parent_record_key,
            event.runtime_id,
            event.provider_id,
            event.model_id,
            event.occurred_at_ms,
            event.input_tokens,
            event.output_tokens,
            event.cache_read_tokens,
            event.cache_write_tokens,
            event.input_semantics,
            event.counter_semantics,
            event.measurement,
            event.billing_mode,
            event.estimated_cost_usd,
            event.price_version,
            event.duration_ms,
            event.status,
            event.aggregation_scope,
            now_ms(),
            event.observation_sequence,
        ],
    )
    .map_err(|error| format!("usage record failed: {error}"))?;
    Ok(UsageRecordResult {
        record_key: key,
        inserted,
    })
}

fn validated_values(values: Vec<String>, field: &str) -> Result<Vec<String>, String> {
    if values.len() > MAX_FILTER_VALUES {
        return Err(format!(
            "{field} accepts at most {MAX_FILTER_VALUES} values"
        ));
    }
    let mut unique = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        require_id(&value, field)?;
        if unique.insert(value.clone()) {
            result.push(value);
        }
    }
    Ok(result)
}

fn normalize_filter(filter: UsageReportFilter) -> Result<NormalizedFilter, String> {
    let now = now_ms();
    let end_ms = filter.end_ms.unwrap_or(now.saturating_add(1));
    let start_ms = filter
        .start_ms
        .unwrap_or_else(|| end_ms.saturating_sub(DEFAULT_RANGE_DAYS * DAY_MS));
    if start_ms < 0 || end_ms <= start_ms {
        return Err("usage report range must be a nonempty half-open interval".into());
    }
    if end_ms.saturating_sub(start_ms) > MAX_RANGE_DAYS * DAY_MS {
        return Err(format!(
            "usage report range cannot exceed {MAX_RANGE_DAYS} days"
        ));
    }
    let page = filter.page.unwrap_or(0);
    let page_size = filter.page_size.unwrap_or(25);
    if page_size == 0 || page_size > MAX_PAGE_SIZE {
        return Err(format!("pageSize must be between 1 and {MAX_PAGE_SIZE}"));
    }
    Ok(NormalizedFilter {
        start_ms,
        end_ms,
        project_ids: validated_values(filter.project_ids, "projectIds")?,
        runtime_ids: validated_values(filter.runtime_ids, "runtimeIds")?,
        provider_ids: validated_values(filter.provider_ids, "providerIds")?,
        model_ids: validated_values(filter.model_ids, "modelIds")?,
        session_ids: validated_values(filter.session_ids, "sessionIds")?,
        page,
        page_size,
    })
}

fn add_values_filter(
    sql: &mut String,
    params: &mut Vec<SqlValue>,
    column: &str,
    values: &[String],
) {
    if values.is_empty() {
        return;
    }
    sql.push_str(" AND ");
    sql.push_str(column);
    sql.push_str(" IN (");
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            sql.push(',');
        }
        sql.push('?');
        params.push(SqlValue::Text(value.clone()));
    }
    sql.push(')');
}

fn filter_clause(filter: &NormalizedFilter, exclude_children: bool) -> (String, Vec<SqlValue>) {
    let mut sql = "u.occurred_at_ms >= ? AND u.occurred_at_ms < ?".to_string();
    let mut params = vec![
        SqlValue::Integer(filter.start_ms),
        SqlValue::Integer(filter.end_ms),
    ];
    add_values_filter(&mut sql, &mut params, "u.project_id", &filter.project_ids);
    add_values_filter(&mut sql, &mut params, "u.runtime_id", &filter.runtime_ids);
    add_values_filter(&mut sql, &mut params, "u.provider_id", &filter.provider_ids);
    add_values_filter(&mut sql, &mut params, "u.model_id", &filter.model_ids);
    add_values_filter(&mut sql, &mut params, "u.session_id", &filter.session_ids);
    if exclude_children {
        sql.push_str(
            " AND NOT EXISTS (
                SELECT 1 FROM usage_records parent
                WHERE parent.record_key = u.parent_record_key
                  AND parent.aggregation_scope = 'includes_children'
            )",
        );
    }
    (sql, params)
}

fn input_total_sql() -> &'static str {
    "CASE
        WHEN u.input_tokens IS NULL THEN NULL
        WHEN u.input_semantics = 'exclusive'
             AND u.cache_read_tokens IS NOT NULL
             AND u.cache_write_tokens IS NOT NULL THEN
            u.input_tokens + u.cache_read_tokens + u.cache_write_tokens
        WHEN u.input_semantics = 'exclusive' THEN NULL
        ELSE u.input_tokens
     END"
}

fn input_fresh_sql() -> &'static str {
    "CASE
        WHEN u.input_tokens IS NULL THEN NULL
        WHEN u.input_semantics = 'exclusive' THEN u.input_tokens
        WHEN u.input_semantics = 'inclusive'
             AND u.cache_read_tokens IS NOT NULL
             AND u.cache_write_tokens IS NOT NULL
             AND u.cache_read_tokens + u.cache_write_tokens <= u.input_tokens THEN
            u.input_tokens - u.cache_read_tokens - u.cache_write_tokens
        ELSE NULL
     END"
}

fn comparable_denominator_sql() -> &'static str {
    "CASE
        WHEN u.input_tokens IS NULL
          OR u.cache_read_tokens IS NULL
          OR u.cache_write_tokens IS NULL
          OR u.input_semantics = 'unknown'
          OR (u.input_semantics = 'inclusive'
              AND u.cache_read_tokens + u.cache_write_tokens > u.input_tokens) THEN NULL
        WHEN u.input_semantics = 'exclusive' THEN
            u.input_tokens + u.cache_read_tokens + u.cache_write_tokens
        ELSE u.input_tokens
     END"
}

fn query_totals(conn: &Connection, filter: &NormalizedFilter) -> Result<UsageReportTotals, String> {
    let (where_sql, values) = filter_clause(filter, true);
    let input_total = input_total_sql();
    let input_fresh = input_fresh_sql();
    let comparable = comparable_denominator_sql();
    let sql = format!(
        "SELECT
            COUNT(*), COUNT(DISTINCT u.session_id),
            COALESCE(SUM({input_total}), 0),
            COALESCE(SUM(CASE WHEN {input_total} IS NOT NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN {input_total} IS NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM({input_fresh}), 0),
            COALESCE(SUM(CASE WHEN {input_fresh} IS NOT NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(u.output_tokens), 0),
            COALESCE(SUM(CASE WHEN u.output_tokens IS NOT NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN u.output_tokens IS NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(u.cache_read_tokens), 0),
            COALESCE(SUM(u.cache_write_tokens), 0),
            COALESCE(SUM(CASE WHEN {comparable} IS NOT NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN {comparable} IS NULL THEN 1 ELSE 0 END), 0),
            CASE WHEN COALESCE(SUM({comparable}), 0) > 0
                THEN CAST(SUM(CASE WHEN {comparable} IS NOT NULL THEN u.cache_read_tokens ELSE 0 END) AS REAL)
                     / SUM({comparable})
                ELSE NULL END,
            COALESCE(SUM(u.estimated_cost_usd), 0),
            COALESCE(SUM(CASE WHEN u.estimated_cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN u.estimated_cost_usd IS NULL THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN u.measurement IN ('provider_reported', 'runtime_reported') THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN u.measurement = 'estimated' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN u.measurement = 'unavailable' THEN 1 ELSE 0 END), 0)
         FROM usage_records u WHERE {where_sql}"
    );
    let mut totals = conn
        .query_row(&sql, params_from_iter(values.iter()), |row| {
            Ok(UsageReportTotals {
                record_count: row.get(0)?,
                session_count: row.get(1)?,
                input_total: row.get(2)?,
                input_known_records: row.get(3)?,
                input_unknown_records: row.get(4)?,
                input_fresh: row.get(5)?,
                input_fresh_known_records: row.get(6)?,
                output_total: row.get(7)?,
                output_known_records: row.get(8)?,
                output_unknown_records: row.get(9)?,
                cache_read_total: row.get(10)?,
                cache_write_total: row.get(11)?,
                cache_known_records: row.get(12)?,
                cache_unknown_records: row.get(13)?,
                cache_rate: row.get(14)?,
                estimated_cost_usd: row.get(15)?,
                cost_known_records: row.get(16)?,
                cost_unknown_records: row.get(17)?,
                reported_records: row.get(18)?,
                estimated_records: row.get(19)?,
                unavailable_records: row.get(20)?,
                excluded_child_records: 0,
            })
        })
        .map_err(|error| format!("usage totals query failed: {error}"))?;
    let (all_where, all_values) = filter_clause(filter, false);
    let exclusion_sql = format!(
        "SELECT COUNT(*) FROM usage_records u
         WHERE {all_where}
           AND EXISTS (
               SELECT 1 FROM usage_records parent
               WHERE parent.record_key = u.parent_record_key
                 AND parent.aggregation_scope = 'includes_children'
           )"
    );
    totals.excluded_child_records = conn
        .query_row(&exclusion_sql, params_from_iter(all_values.iter()), |row| {
            row.get(0)
        })
        .map_err(|error| format!("usage child exclusion query failed: {error}"))?;
    Ok(totals)
}

fn query_daily(
    conn: &Connection,
    filter: &NormalizedFilter,
) -> Result<Vec<UsageTrendPoint>, String> {
    let (where_sql, values) = filter_clause(filter, true);
    let input_total = input_total_sql();
    let sql = format!(
        "SELECT strftime('%Y-%m-%d', u.occurred_at_ms / 1000, 'unixepoch') day,
                CASE WHEN COUNT({input_total}) = COUNT(*) THEN SUM({input_total}) ELSE NULL END,
                CASE WHEN COUNT(u.output_tokens) = COUNT(*) THEN SUM(u.output_tokens) ELSE NULL END,
                CASE WHEN COUNT(u.cache_read_tokens) = COUNT(*) THEN SUM(u.cache_read_tokens) ELSE NULL END,
                CASE WHEN COUNT(u.estimated_cost_usd) = COUNT(*) THEN SUM(u.estimated_cost_usd) ELSE NULL END,
                COUNT(*)
         FROM usage_records u WHERE {where_sql}
         GROUP BY day ORDER BY day"
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("usage trend prepare failed: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            Ok(UsageTrendPoint {
                day: row.get(0)?,
                input_total: row.get(1)?,
                output_total: row.get(2)?,
                cache_read_total: row.get(3)?,
                estimated_cost_usd: row.get(4)?,
                record_count: row.get(5)?,
            })
        })
        .map_err(|error| format!("usage trend query failed: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("usage trend row failed: {error}"))
}

fn query_heatmap(
    conn: &Connection,
    filter: &NormalizedFilter,
) -> Result<Vec<UsageHeatmapCell>, String> {
    let (where_sql, values) = filter_clause(filter, true);
    let input_total = input_total_sql();
    let sql = format!(
        "SELECT CAST(strftime('%w', u.occurred_at_ms / 1000, 'unixepoch') AS INTEGER),
                CAST(strftime('%H', u.occurred_at_ms / 1000, 'unixepoch') AS INTEGER),
                CASE WHEN COUNT({input_total}) = COUNT(*) AND COUNT(u.output_tokens) = COUNT(*)
                    THEN SUM({input_total}) + SUM(u.output_tokens)
                    ELSE NULL END,
                COUNT(*)
         FROM usage_records u WHERE {where_sql}
         GROUP BY 1, 2 ORDER BY 1, 2"
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("usage heatmap prepare failed: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            Ok(UsageHeatmapCell {
                weekday: row.get(0)?,
                hour: row.get(1)?,
                token_total: row.get(2)?,
                record_count: row.get(3)?,
            })
        })
        .map_err(|error| format!("usage heatmap query failed: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("usage heatmap row failed: {error}"))
}

fn query_breakdown(
    conn: &Connection,
    filter: &NormalizedFilter,
    column: &str,
) -> Result<Vec<UsageBreakdown>, String> {
    let (where_sql, values) = filter_clause(filter, true);
    let input_total = input_total_sql();
    let sql = format!(
        "SELECT COALESCE({column}, 'Unknown'),
                CASE WHEN COUNT({input_total}) = COUNT(*) THEN SUM({input_total}) ELSE NULL END,
                CASE WHEN COUNT(u.output_tokens) = COUNT(*) THEN SUM(u.output_tokens) ELSE NULL END,
                CASE WHEN COUNT(u.cache_read_tokens) = COUNT(*) THEN SUM(u.cache_read_tokens) ELSE NULL END,
                CASE WHEN COUNT(u.estimated_cost_usd) = COUNT(*) THEN SUM(u.estimated_cost_usd) ELSE NULL END,
                COUNT(*), COUNT(DISTINCT u.session_id)
         FROM usage_records u WHERE {where_sql}
         GROUP BY 1
         ORDER BY COALESCE(SUM({input_total}), 0) + COALESCE(SUM(u.output_tokens), 0) DESC
         LIMIT 100"
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("usage breakdown prepare failed: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            Ok(UsageBreakdown {
                key: row.get(0)?,
                input_total: row.get(1)?,
                output_total: row.get(2)?,
                cache_read_total: row.get(3)?,
                estimated_cost_usd: row.get(4)?,
                record_count: row.get(5)?,
                session_count: row.get(6)?,
            })
        })
        .map_err(|error| format!("usage breakdown query failed: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("usage breakdown row failed: {error}"))
}

fn query_sessions(
    conn: &Connection,
    filter: &NormalizedFilter,
) -> Result<UsageSessionPage, String> {
    let (where_sql, mut values) = filter_clause(filter, true);
    let input_total = input_total_sql();
    let total_sql = format!(
        "SELECT COUNT(*) FROM (
            SELECT u.session_id, u.project_id, u.runtime_id
            FROM usage_records u WHERE {where_sql}
            GROUP BY 1, 2, 3
         )"
    );
    let total = conn
        .query_row(&total_sql, params_from_iter(values.iter()), |row| {
            row.get(0)
        })
        .map_err(|error| format!("usage session count failed: {error}"))?;
    let sql = format!(
        "SELECT u.session_id, u.project_id, u.runtime_id,
                CASE WHEN COUNT(DISTINCT COALESCE(u.provider_id, '')) > 1
                    THEN 'Mixed' ELSE MAX(u.provider_id) END,
                CASE WHEN COUNT(DISTINCT COALESCE(u.model_id, '')) > 1
                    THEN 'Mixed' ELSE MAX(u.model_id) END,
                MAX(u.occurred_at_ms),
                CASE WHEN COUNT({input_total}) = COUNT(*) THEN SUM({input_total}) ELSE NULL END,
                CASE WHEN COUNT(u.output_tokens) = COUNT(*) THEN SUM(u.output_tokens) ELSE NULL END,
                CASE WHEN COUNT(u.cache_read_tokens) = COUNT(*) THEN SUM(u.cache_read_tokens) ELSE NULL END,
                CASE WHEN COUNT(u.cache_write_tokens) = COUNT(*) THEN SUM(u.cache_write_tokens) ELSE NULL END,
                CASE WHEN COUNT(u.estimated_cost_usd) = COUNT(*) THEN SUM(u.estimated_cost_usd) ELSE NULL END,
                COUNT(*),
                CASE
                    WHEN SUM(CASE WHEN u.status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
                    WHEN SUM(CASE WHEN u.status = 'cancelled' THEN 1 ELSE 0 END) > 0 THEN 'cancelled'
                    WHEN SUM(CASE WHEN u.status = 'interrupted' THEN 1 ELSE 0 END) > 0 THEN 'interrupted'
                    WHEN SUM(CASE WHEN u.status = 'in_progress' THEN 1 ELSE 0 END) > 0 THEN 'in_progress'
                    ELSE 'completed'
                END,
                CASE
                    WHEN SUM(CASE WHEN u.measurement = 'unavailable' THEN 1 ELSE 0 END) > 0 THEN 'mixed_or_unavailable'
                    WHEN SUM(CASE WHEN u.measurement = 'estimated' THEN 1 ELSE 0 END) > 0 THEN 'estimated'
                    WHEN SUM(CASE WHEN u.measurement = 'runtime_reported' THEN 1 ELSE 0 END) > 0 THEN 'runtime_reported'
                    ELSE 'provider_reported'
                END,
                CASE
                    WHEN COUNT(DISTINCT u.billing_mode) > 1 THEN 'mixed'
                    ELSE MIN(u.billing_mode)
                END,
                CASE WHEN COUNT(DISTINCT COALESCE(u.price_version, '')) > 1
                    THEN 'Mixed' ELSE MAX(u.price_version) END
         FROM usage_records u WHERE {where_sql}
         GROUP BY u.session_id, u.project_id, u.runtime_id
         ORDER BY MAX(u.occurred_at_ms) DESC
         LIMIT ? OFFSET ?"
    );
    values.push(SqlValue::Integer(i64::from(filter.page_size)));
    values.push(SqlValue::Integer(
        i64::from(filter.page) * i64::from(filter.page_size),
    ));
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("usage sessions prepare failed: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            Ok(UsageSessionDetail {
                session_id: row.get(0)?,
                project_id: row.get(1)?,
                runtime_id: row.get(2)?,
                provider_id: row.get(3)?,
                model_id: row.get(4)?,
                occurred_at_ms: row.get(5)?,
                input_total: row.get(6)?,
                output_total: row.get(7)?,
                cache_read_total: row.get(8)?,
                cache_write_total: row.get(9)?,
                estimated_cost_usd: row.get(10)?,
                record_count: row.get(11)?,
                status: row.get(12)?,
                measurement: row.get(13)?,
                billing_mode: row.get(14)?,
                price_version: row.get(15)?,
            })
        })
        .map_err(|error| format!("usage sessions query failed: {error}"))?;
    let items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("usage session row failed: {error}"))?;
    Ok(UsageSessionPage {
        items,
        page: filter.page,
        page_size: filter.page_size,
        total,
    })
}

pub fn query_report(root: &Path, filter: UsageReportFilter) -> Result<UsageReport, String> {
    let filter = normalize_filter(filter)?;
    let conn = crate::library_db::open(root)?;
    Ok(UsageReport {
        start_ms: filter.start_ms,
        end_ms: filter.end_ms,
        timezone: "UTC".into(),
        generated_at_ms: now_ms(),
        totals: query_totals(&conn, &filter)?,
        daily: query_daily(&conn, &filter)?,
        heatmap: query_heatmap(&conn, &filter)?,
        by_project: query_breakdown(&conn, &filter, "u.project_id")?,
        by_runtime: query_breakdown(&conn, &filter, "u.runtime_id")?,
        by_provider: query_breakdown(&conn, &filter, "u.provider_id")?,
        by_model: query_breakdown(&conn, &filter, "u.model_id")?,
        sessions: query_sessions(&conn, &filter)?,
    })
}

pub fn update_usage_estimate(
    root: &Path,
    estimate: &UsageEstimateInput,
    snapshot: &MetadataSnapshot,
) -> Result<bool, String> {
    require_id(&estimate.source_id, "sourceId")?;
    require_id(&estimate.source_turn_id, "sourceTurnId")?;
    let conn = crate::library_db::open(root)?;
    let key = stable_record_key(&estimate.source_id, &estimate.source_turn_id);
    let current = conn
        .query_row(
            "SELECT provider_id, model_id, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, input_semantics, billing_mode
             FROM usage_records WHERE record_key = ?1 AND counter_semantics = 'cumulative'",
            [&key],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("usage estimate lookup failed: {error}"))?;
    let Some((
        provider_id,
        model_id,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        input_semantics,
        billing_mode,
    )) = current
    else {
        return Ok(false);
    };
    let observed = UsageEventInput {
        event_id: estimate.source_turn_id.clone(),
        source_id: estimate.source_id.clone(),
        source_turn_id: estimate.source_turn_id.clone(),
        project_id: "repair".into(),
        task_id: None,
        session_id: "repair".into(),
        parent_session_id: None,
        parent_record_key: None,
        runtime_id: "repair".into(),
        provider_id: provider_id.clone(),
        model_id: model_id.clone(),
        occurred_at_ms: 0,
        observation_sequence: None,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        input_semantics: input_semantics.clone(),
        counter_semantics: "cumulative".into(),
        measurement: "provider_reported".into(),
        billing_mode: billing_mode.clone(),
        estimated_cost_usd: None,
        price_version: None,
        duration_ms: None,
        status: "completed".into(),
        aggregation_scope: "self".into(),
    };
    let Some(cost) = estimate_usage_cost(snapshot, &observed) else {
        return Ok(false);
    };
    let changed = conn
        .execute(
            "UPDATE usage_records
             SET estimated_cost_usd = ?1, price_version = ?2, updated_at_ms = ?3
             WHERE record_key = ?4
               AND provider_id IS ?5 AND model_id IS ?6
               AND input_tokens IS ?7 AND output_tokens IS ?8
               AND cache_read_tokens IS ?9 AND cache_write_tokens IS ?10
               AND input_semantics = ?11 AND billing_mode = ?12",
            params![
                cost.estimated_cost_usd,
                cost.price_version,
                now_ms(),
                key,
                provider_id,
                model_id,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                input_semantics,
                billing_mode,
            ],
        )
        .map_err(|error| format!("usage estimate update failed: {error}"))?;
    Ok(changed == 1)
}

#[tauri::command]
pub async fn record_usage_event(event: UsageEventInput) -> Result<UsageRecordResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::paths::oleafly_root()?;
        record_usage_observation(&root, &event)
    })
    .await
    .map_err(|error| format!("usage record task failed: {error}"))?
}

#[tauri::command]
pub async fn usage_report_query(filter: UsageReportFilter) -> Result<UsageReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::paths::oleafly_root()?;
        query_report(&root, filter)
    })
    .await
    .map_err(|error| format!("usage report task failed: {error}"))?
}

#[tauri::command]
pub async fn usage_estimate_update(estimate: UsageEstimateInput) -> Result<bool, String> {
    let snapshot = crate::ai_model_metadata::snapshot();
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::paths::oleafly_root()?;
        update_usage_estimate(&root, &estimate, &snapshot)
    })
    .await
    .map_err(|error| format!("usage estimate task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn event(event_id: &str, turn_id: &str, input: Option<i64>) -> UsageEventInput {
        UsageEventInput {
            event_id: event_id.into(),
            source_id: "source".into(),
            source_turn_id: turn_id.into(),
            project_id: "project".into(),
            task_id: None,
            session_id: "session".into(),
            parent_session_id: None,
            parent_record_key: None,
            runtime_id: "built-in".into(),
            provider_id: Some("provider".into()),
            model_id: Some("model".into()),
            occurred_at_ms: 1_800_000,
            observation_sequence: None,
            input_tokens: input,
            output_tokens: Some(20),
            cache_read_tokens: Some(10),
            cache_write_tokens: Some(0),
            input_semantics: "inclusive".into(),
            counter_semantics: "cumulative".into(),
            measurement: "provider_reported".into(),
            billing_mode: "api".into(),
            estimated_cost_usd: Some(0.02),
            price_version: Some("test".into()),
            duration_ms: Some(100),
            status: "completed".into(),
            aggregation_scope: "self".into(),
        }
    }

    fn report(root: &Path) -> UsageReport {
        query_report(
            root,
            UsageReportFilter {
                start_ms: Some(0),
                end_ms: Some(DAY_MS),
                ..UsageReportFilter::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn ordered_snapshots_clear_missing_counters_and_ignore_stale_replay() {
        let root = TempDir::new().unwrap();
        let mut known = event("known", "turn", Some(100));
        known.observation_sequence = Some(1);
        record_usage_observation(root.path(), &known).unwrap();
        let mut absent = known.clone();
        absent.observation_sequence = Some(2);
        absent.input_tokens = None;
        absent.output_tokens = None;
        absent.cache_read_tokens = None;
        absent.cache_write_tokens = None;
        absent.estimated_cost_usd = None;
        absent.price_version = None;
        absent.measurement = "unavailable".into();
        record_usage_observation(root.path(), &absent).unwrap();
        record_usage_observation(root.path(), &known).unwrap();
        known.observation_sequence = None;
        record_usage_observation(root.path(), &known).unwrap();
        let totals = report(root.path()).totals;
        assert_eq!(totals.record_count, 1);
        assert_eq!(totals.input_known_records, 0);
        assert_eq!(totals.output_known_records, 0);
        assert_eq!(totals.cost_known_records, 0);
        assert_eq!(totals.unavailable_records, 1);
        known.observation_sequence = Some(3);
        known.input_tokens = Some(0);
        known.output_tokens = Some(0);
        known.cache_read_tokens = Some(0);
        known.cache_write_tokens = Some(0);
        known.estimated_cost_usd = Some(0.0);
        record_usage_observation(root.path(), &known).unwrap();
        let totals = report(root.path()).totals;
        assert_eq!(totals.input_known_records, 1);
        assert_eq!(totals.output_known_records, 1);
        assert_eq!(totals.input_total, 0);
        assert_eq!(totals.cost_known_records, 1);
    }

    #[test]
    fn cumulative_replay_updates_one_record_without_decreasing_it() {
        let root = TempDir::new().unwrap();
        let first = event("first", "turn", Some(100));
        let first_result = record_usage_observation(root.path(), &first).unwrap();
        assert!(first_result.inserted);
        let mut later = event("later", "turn", Some(140));
        later.output_tokens = Some(30);
        assert!(
            !record_usage_observation(root.path(), &later)
                .unwrap()
                .inserted
        );
        let mut stale = event("stale", "turn", Some(90));
        stale.output_tokens = Some(10);
        record_usage_observation(root.path(), &stale).unwrap();

        let result = report(root.path());
        assert_eq!(result.totals.record_count, 1);
        assert_eq!(result.totals.input_total, 140);
        assert_eq!(result.totals.output_total, 30);
    }

    #[test]
    fn delta_events_deduplicate_by_event_id() {
        let root = TempDir::new().unwrap();
        let mut first = event("one", "turn", Some(25));
        first.counter_semantics = "delta".into();
        let mut second = event("two", "turn", Some(15));
        second.counter_semantics = "delta".into();
        record_usage_observation(root.path(), &first).unwrap();
        record_usage_observation(root.path(), &first).unwrap();
        record_usage_observation(root.path(), &second).unwrap();

        let result = report(root.path());
        assert_eq!(result.totals.record_count, 2);
        assert_eq!(result.totals.input_total, 40);
    }

    #[test]
    fn inclusive_and_exclusive_input_are_normalized_without_double_counting_cache() {
        let root = TempDir::new().unwrap();
        let inclusive = event("inclusive", "inclusive", Some(100));
        record_usage_observation(root.path(), &inclusive).unwrap();
        let mut exclusive = event("exclusive", "exclusive", Some(80));
        exclusive.input_semantics = "exclusive".into();
        exclusive.cache_read_tokens = Some(15);
        exclusive.cache_write_tokens = Some(5);
        record_usage_observation(root.path(), &exclusive).unwrap();

        let result = report(root.path());
        assert_eq!(result.totals.input_total, 200);
        assert_eq!(result.totals.input_fresh, 170);
        assert_eq!(result.totals.cache_read_total, 25);
        assert!((result.totals.cache_rate.unwrap() - 0.125).abs() < 1e-9);
    }

    #[test]
    fn unknown_cache_stays_out_of_cache_rate() {
        let root = TempDir::new().unwrap();
        let mut unknown = event("unknown", "unknown", Some(40));
        unknown.input_semantics = "unknown".into();
        unknown.cache_read_tokens = None;
        unknown.cache_write_tokens = None;
        unknown.status = "cancelled".into();
        record_usage_observation(root.path(), &unknown).unwrap();

        let result = report(root.path());
        assert_eq!(result.totals.record_count, 1);
        assert_eq!(result.totals.cache_unknown_records, 1);
        assert_eq!(result.totals.cache_rate, None);
        assert_eq!(result.sessions.items[0].status, "cancelled");
    }

    #[test]
    fn exclusive_input_total_stays_unknown_when_cache_counters_are_missing() {
        let root = TempDir::new().unwrap();
        let mut unknown = event("unknown", "unknown", Some(40));
        unknown.input_semantics = "exclusive".into();
        unknown.cache_read_tokens = None;
        unknown.cache_write_tokens = None;
        record_usage_observation(root.path(), &unknown).unwrap();

        let result = report(root.path());
        assert_eq!(result.totals.input_total, 0);
        assert_eq!(result.totals.input_known_records, 0);
        assert_eq!(result.totals.input_unknown_records, 1);
        assert_eq!(result.daily[0].input_total, None);
        assert_eq!(result.sessions.items[0].input_total, None);
    }

    #[test]
    fn child_usage_linked_to_an_inclusive_parent_counts_once() {
        let root = TempDir::new().unwrap();
        let mut parent = event("parent", "parent", Some(150));
        parent.session_id = "parent-session".into();
        parent.aggregation_scope = "includes_children".into();
        let parent_key = record_usage_observation(root.path(), &parent)
            .unwrap()
            .record_key;
        let mut child = event("child", "child", Some(50));
        child.session_id = "child-session".into();
        child.parent_session_id = Some("parent-session".into());
        child.parent_record_key = Some(parent_key);
        record_usage_observation(root.path(), &child).unwrap();

        let result = report(root.path());
        assert_eq!(result.totals.record_count, 1);
        assert_eq!(result.totals.input_total, 150);
        assert_eq!(result.totals.excluded_child_records, 1);
    }

    #[test]
    fn failed_and_cancelled_usage_remains_reportable() {
        let root = TempDir::new().unwrap();
        let mut failed = event("failed", "failed", Some(12));
        failed.status = "failed".into();
        let mut cancelled = event("cancelled", "cancelled", Some(8));
        cancelled.status = "cancelled".into();
        record_usage_observation(root.path(), &failed).unwrap();
        record_usage_observation(root.path(), &cancelled).unwrap();

        let result = report(root.path());
        assert_eq!(result.totals.record_count, 2);
        assert_eq!(result.totals.input_total, 20);
        assert_eq!(result.sessions.total, 1);
        assert_eq!(result.sessions.items[0].status, "failed");
    }

    #[test]
    fn legacy_rows_migrate_without_inventing_cache_counters() {
        let root = TempDir::new().unwrap();
        let legacy = Connection::open(root.path().join("library.db")).unwrap();
        legacy
            .execute_batch(
                "CREATE TABLE usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts_ms INTEGER NOT NULL,
                    project_id TEXT NOT NULL,
                    chat_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    cost_usd REAL NOT NULL
                );
                INSERT INTO usage (
                    ts_ms, project_id, chat_id, provider, model,
                    input_tokens, output_tokens, cost_usd
                ) VALUES (1800000, 'project', 'legacy-chat', 'provider', 'model', 60, 20, 0.03);",
            )
            .unwrap();
        drop(legacy);

        let result = report(root.path());
        assert_eq!(result.totals.input_total, 60);
        assert_eq!(result.totals.cache_unknown_records, 1);
        assert_eq!(result.totals.estimated_cost_usd, 0.03);
    }

    #[test]
    fn filters_and_pagination_are_bounded() {
        let root = TempDir::new().unwrap();
        let mut invalid = UsageReportFilter {
            start_ms: Some(10),
            end_ms: Some(10),
            ..UsageReportFilter::default()
        };
        assert!(query_report(root.path(), invalid.clone()).is_err());
        invalid.start_ms = Some(0);
        invalid.end_ms = Some((MAX_RANGE_DAYS + 1) * DAY_MS);
        assert!(query_report(root.path(), invalid).is_err());

        let mut invalid_event = event("bad", "bad", Some(-1));
        assert!(record_usage_observation(root.path(), &invalid_event).is_err());
        invalid_event.input_tokens = Some(1);
        invalid_event.estimated_cost_usd = Some(f64::NAN);
        assert!(record_usage_observation(root.path(), &invalid_event).is_err());
    }

    #[test]
    fn empty_report_has_zero_totals_and_no_sessions() {
        let root = TempDir::new().unwrap();
        let result = report(root.path());
        assert_eq!(result.totals.record_count, 0);
        assert_eq!(result.totals.input_total, 0);
        assert_eq!(result.totals.cache_rate, None);
        assert!(result.daily.is_empty());
        assert!(result.sessions.items.is_empty());
    }

    #[test]
    fn a_known_estimate_updates_the_existing_native_record() {
        let root = TempDir::new().unwrap();
        let mut observation = event("event", "turn", Some(100));
        observation.provider_id = Some("openai".into());
        observation.model_id = Some("gpt-4.1".into());
        observation.estimated_cost_usd = None;
        observation.price_version = None;
        record_usage_observation(root.path(), &observation).unwrap();
        let snapshot = crate::ai_model_metadata::bundled_snapshot();
        assert!(update_usage_estimate(
            root.path(),
            &UsageEstimateInput {
                source_id: "source".into(),
                source_turn_id: "turn".into(),
            },
            &snapshot,
        )
        .unwrap());
        assert!((report(root.path()).totals.estimated_cost_usd - 0.000345).abs() < 1e-12);
    }

    #[test]
    fn metadata_estimate_prices_inclusive_cache_without_double_counting() {
        let mut observation = event("event", "turn", Some(100));
        observation.output_tokens = Some(20);
        observation.cache_read_tokens = Some(40);
        observation.cache_write_tokens = Some(0);
        observation.provider_id = Some("openai".into());
        observation.model_id = Some("gpt-4.1".into());
        observation.estimated_cost_usd = None;
        observation.price_version = None;

        let snapshot = crate::ai_model_metadata::bundled_snapshot();
        assert!(apply_model_metadata_cost(&snapshot, &mut observation));
        assert!((observation.estimated_cost_usd.unwrap() - 0.0003).abs() < 1e-12);
        let expected_price_version = format!("model-metadata:{}", snapshot.generated_at());
        assert_eq!(
            observation.price_version.as_deref(),
            Some(expected_price_version.as_str())
        );
    }

    #[test]
    fn metadata_estimate_requires_complete_supported_cache_pricing() {
        let rates = ModelCost {
            input: Some(2.0),
            output: Some(8.0),
            cache_read: Some(0.5),
        };
        let mut observation = event("event", "turn", Some(100));
        observation.estimated_cost_usd = None;
        observation.cache_write_tokens = None;
        assert_eq!(estimate_cost_from_rates(&observation, &rates), None);

        observation.cache_write_tokens = Some(10);
        assert_eq!(estimate_cost_from_rates(&observation, &rates), None);

        observation.cache_write_tokens = Some(0);
        observation.input_semantics = "unknown".into();
        assert_eq!(estimate_cost_from_rates(&observation, &rates), None);
    }

    #[test]
    fn subscription_usage_does_not_become_a_dollar_estimate() {
        let mut observation = event("event", "turn", Some(100));
        observation.provider_id = Some("openai".into());
        observation.model_id = Some("gpt-4.1".into());
        observation.billing_mode = "subscription".into();
        observation.estimated_cost_usd = None;
        observation.price_version = None;

        let snapshot = crate::ai_model_metadata::bundled_snapshot();
        assert!(!apply_model_metadata_cost(&snapshot, &mut observation));
        assert_eq!(observation.estimated_cost_usd, None);
        assert_eq!(observation.price_version, None);
    }

    #[test]
    fn advancing_cumulative_usage_invalidates_stale_cache_and_cost() {
        let root = TempDir::new().unwrap();
        let snapshot = crate::ai_model_metadata::bundled_snapshot();
        let mut observation = event("event", "turn", Some(100));
        observation.provider_id = Some("openai".into());
        observation.model_id = Some("gpt-4.1".into());
        observation.estimated_cost_usd = None;
        observation.price_version = None;
        assert!(apply_model_metadata_cost(&snapshot, &mut observation));
        record_usage_observation(root.path(), &observation).unwrap();
        assert_eq!(report(root.path()).totals.cost_known_records, 1);

        observation.provider_id = None;
        observation.model_id = None;
        observation.input_semantics = "unknown".into();
        observation.billing_mode = "unknown".into();
        assert!(!apply_model_metadata_cost(&snapshot, &mut observation));
        record_usage_observation(root.path(), &observation).unwrap();
        let terminal_replay = report(root.path());
        assert_eq!(terminal_replay.totals.cost_known_records, 1);
        assert_eq!(terminal_replay.by_provider[0].key, "openai");

        observation.input_tokens = Some(140);
        observation.output_tokens = Some(30);
        observation.cache_read_tokens = None;
        observation.cache_write_tokens = None;
        assert!(!apply_model_metadata_cost(&snapshot, &mut observation));
        record_usage_observation(root.path(), &observation).unwrap();

        let unknown = report(root.path());
        assert_eq!(unknown.totals.input_total, 140);
        assert_eq!(unknown.totals.cache_unknown_records, 1);
        assert_eq!(unknown.totals.cost_known_records, 0);
        assert_eq!(unknown.totals.cost_unknown_records, 1);
        assert_eq!(unknown.by_provider[0].key, "Unknown");
        assert_eq!(unknown.sessions.items[0].cache_read_total, None);
        assert_eq!(unknown.sessions.items[0].estimated_cost_usd, None);
        assert_eq!(unknown.sessions.items[0].billing_mode, "unknown");

        observation.provider_id = Some("openai".into());
        observation.model_id = Some("gpt-4.1".into());
        observation.input_semantics = "inclusive".into();
        observation.billing_mode = "api".into();
        observation.cache_read_tokens = Some(20);
        observation.cache_write_tokens = Some(0);
        assert!(apply_model_metadata_cost(&snapshot, &mut observation));
        record_usage_observation(root.path(), &observation).unwrap();

        let recovered = report(root.path());
        assert_eq!(recovered.totals.cache_known_records, 1);
        assert_eq!(recovered.totals.cost_known_records, 1);
        assert!(recovered.sessions.items[0].estimated_cost_usd.is_some());
    }
}
