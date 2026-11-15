#[cfg(test)]
mod tests;

use std::time::{Duration, Instant};

use oleafly_ot::{diff, rebase, utf16_len, OtError, TextOperation};
use serde_json::{json, Map, Value};

use super::format::{
    blob_hash, CodecError, DocFormat, Echo, FormatState, MAX_CHANGES, MAX_COMMENTS,
};
use super::{AppliedUpdate, DocId, PublicId, SendMode};

pub const RESEND_AFTER: Duration = Duration::from_secs(5);
pub const HASH_EVERY: Duration = Duration::from_secs(5);
pub const MAX_UPDATE_BYTES: usize = 7 * 1024 * 1024 + 64 * 1024;
const FRAME_ALLOWANCE: usize = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Limit {
    Empty,
    BaseLength,
    DocLength,
    UpdateSize,
    TooOld,
    RangeCount,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DocError {
    #[error("updates are missing between version {expected} and {got}")]
    Gap { expected: u64, got: u64 },
    #[error(transparent)]
    Codec(#[from] CodecError),
    #[error("the change was held back: {0:?}")]
    Blocked(Limit),
    #[error("the editor sent a change that does not fit: {0}")]
    Local(OtError),
    #[error("the document is out of step with the server")]
    OutOfStep,
}

#[derive(Clone, Debug, PartialEq)]
struct Inflight {
    op: TextOperation,
    sent_versions: Vec<u64>,
    sent_on: Vec<PublicId>,
    sent_at: Instant,
    echo: Echo,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Applied {
    Acknowledged,
    Remote(TextOperation),
    Ignored,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejoin {
    Clean(TextOperation),
    Merged(TextOperation),
    Conflict { mine: String, theirs: String },
}

#[derive(Clone, Debug, PartialEq)]
pub struct OutgoingUpdate {
    pub doc: DocId,
    pub v: u64,
    pub op: Value,
    pub dup_if_source: Vec<PublicId>,
    pub hash: Option<String>,
    pub last_v: Option<u64>,
    pub tc: Option<String>,
}

impl OutgoingUpdate {
    pub fn payload(&self) -> Value {
        let mut update = Map::new();
        update.insert("doc".into(), json!(self.doc));
        update.insert("op".into(), self.op.clone());
        update.insert("v".into(), json!(self.v));
        if let Some(last_v) = self.last_v {
            update.insert("lastV".into(), json!(last_v));
        }
        if let Some(hash) = &self.hash {
            update.insert("hash".into(), json!(hash));
        }
        if !self.dup_if_source.is_empty() {
            update.insert("dupIfSource".into(), json!(self.dup_if_source));
        }
        if let Some(tc) = &self.tc {
            update.insert("meta".into(), json!({ "tc": tc }));
        }
        Value::Object(update)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocJournal {
    pub doc: DocId,
    pub format: DocFormat,
    pub version: u64,
    pub confirmed: String,
    pub local: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OverleafDoc {
    id: DocId,
    version: u64,
    known: u64,
    confirmed: String,
    local: String,
    inflight: Option<Inflight>,
    pending: Option<TextOperation>,
    format: FormatState,
    page_limit: Option<usize>,
    hashed_at: Option<Instant>,
    last_sent: Option<u64>,
}

impl OverleafDoc {
    pub fn joined(id: DocId, version: u64, text: String, format: FormatState) -> OverleafDoc {
        OverleafDoc {
            id,
            version,
            known: version,
            confirmed: text.clone(),
            local: text,
            inflight: None,
            pending: None,
            page_limit: None,
            format,
            hashed_at: None,
            last_sent: None,
        }
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn format(&self) -> &FormatState {
        &self.format
    }

    pub fn limit_length(&mut self, max_length: usize) {
        self.page_limit = Some(max_length);
    }

    fn max_length(&self) -> usize {
        let limit = self.format.limits().max_length;
        match (self.format.format(), self.page_limit) {
            (DocFormat::ShareJs, Some(page)) => limit.min(page),
            _ => limit,
        }
    }

    pub fn text(&self) -> &str {
        &self.local
    }

    pub fn is_settled(&self) -> bool {
        self.inflight.is_none() && self.pending.is_none()
    }

    pub fn journal(&self) -> DocJournal {
        DocJournal {
            doc: self.id.clone(),
            format: self.format.format(),
            version: self.version,
            confirmed: self.confirmed.clone(),
            local: self.local.clone(),
        }
    }

    pub fn local(&mut self, op: TextOperation) -> Result<Option<TextOperation>, DocError> {
        if op.base_len() != utf16_len(&self.local) {
            return Err(DocError::Local(OtError::LengthMismatch));
        }
        if op.is_noop() {
            return Ok(None);
        }
        let sanitized = self.format.sanitize(&op);
        let local = sanitized.send.apply(&self.local).map_err(DocError::Local)?;
        let pending = match self.pending.take() {
            Some(pending) => pending
                .compose(&sanitized.send)
                .map_err(|_| DocError::OutOfStep)?,
            None => sanitized.send,
        };
        self.local = local;
        self.pending = (!pending.is_noop()).then_some(pending);
        Ok(sanitized.correction)
    }

    pub fn next_update(
        &mut self,
        on: &PublicId,
        mode: &SendMode,
        now: Instant,
    ) -> Result<Option<OutgoingUpdate>, DocError> {
        if *mode == SendMode::Hold {
            return Ok(None);
        }
        if let Some(inflight) = &self.inflight {
            let this_connection = inflight.sent_on.contains(on);
            if this_connection && now.saturating_duration_since(inflight.sent_at) < RESEND_AFTER {
                return Ok(None);
            }
            if !inflight.op.is_noop() {
                let tracked_by = match mode {
                    SendMode::Suggest(tracking) => Some(tracking.user_id.as_str()),
                    SendMode::Edit | SendMode::Hold => None,
                };
                if this_connection
                    && !self.format.reencodes_on_one_connection()
                    && inflight.echo.tracked_by() != tracked_by
                {
                    return Ok(None);
                }
                let op = inflight.op.clone();
                return self.send(op, on, mode, now).map(Some);
            }
            if this_connection {
                return Ok(None);
            }
            self.inflight = None;
        }
        let Some(pending) = self.pending.clone() else {
            return Ok(None);
        };
        let update = self.send(pending, on, mode, now)?;
        self.pending = None;
        Ok(Some(update))
    }

    fn send(
        &mut self,
        op: TextOperation,
        on: &PublicId,
        mode: &SendMode,
        now: Instant,
    ) -> Result<OutgoingUpdate, DocError> {
        let tracking = match mode {
            SendMode::Suggest(tracking) => Some(tracking),
            SendMode::Edit | SendMode::Hold => None,
        };
        let limits = self.format.limits();
        if op.is_noop() {
            return Err(DocError::Blocked(Limit::Empty));
        }
        if op.base_len() != utf16_len(&self.confirmed) {
            return Err(DocError::Blocked(Limit::BaseLength));
        }
        if self.known.saturating_sub(self.version) > limits.replay_window {
            return Err(DocError::Blocked(Limit::TooOld));
        }
        let previous = self.inflight.as_ref().map(|inflight| &inflight.echo);
        let encoded = self
            .format
            .encode(&self.confirmed, &op, tracking, previous)?;
        if self.format.length_after(&op, &encoded.echo) > self.max_length() {
            return Err(DocError::Blocked(Limit::DocLength));
        }
        if let Some((comments, changes)) =
            self.format
                .range_counts_after(&self.confirmed, &op, &encoded.echo)?
        {
            if comments > MAX_COMMENTS || changes > MAX_CHANGES {
                return Err(DocError::Blocked(Limit::RangeCount));
            }
        }
        let after = op
            .apply(&self.confirmed)
            .map_err(|_| DocError::Blocked(Limit::BaseLength))?;
        let hash_due = self
            .hashed_at
            .is_none_or(|at| now.saturating_duration_since(at) >= HASH_EVERY);
        let hash = (limits.hashes && hash_due && self.local == after).then(|| blob_hash(&after));
        let dup_if_source = self
            .inflight
            .as_ref()
            .map(|inflight| inflight.sent_on.clone())
            .unwrap_or_default();
        let update = OutgoingUpdate {
            doc: self.id.clone(),
            v: self.version,
            op: encoded.op,
            dup_if_source,
            hash,
            last_v: self.last_sent,
            tc: encoded.tc,
        };
        let size = serde_json::to_vec(&update.payload()).map_or(usize::MAX, |bytes| bytes.len());
        if size.saturating_add(FRAME_ALLOWANCE) > MAX_UPDATE_BYTES {
            return Err(DocError::Blocked(Limit::UpdateSize));
        }
        if update.hash.is_some() {
            self.hashed_at = Some(now);
        }
        self.last_sent = Some(self.version);
        match &mut self.inflight {
            Some(inflight) => {
                if !inflight.sent_on.contains(on) {
                    inflight.sent_on.push(on.clone());
                }
                inflight.sent_versions.push(self.version);
                inflight.sent_at = now;
                inflight.echo = encoded.echo;
            }
            None => {
                self.inflight = Some(Inflight {
                    op,
                    sent_versions: vec![self.version],
                    sent_on: vec![on.clone()],
                    sent_at: now,
                    echo: encoded.echo,
                });
            }
        }
        Ok(update)
    }

    pub fn applied(
        &mut self,
        update: &AppliedUpdate,
        own: &[PublicId],
    ) -> Result<Applied, DocError> {
        if update.doc != self.id {
            return Ok(Applied::Ignored);
        }
        let ours = update.source.as_ref().is_some_and(|source| {
            own.contains(source)
                || self
                    .inflight
                    .as_ref()
                    .is_some_and(|inflight| inflight.sent_on.contains(source))
        });
        let counted = self.format.format() == DocFormat::HistoryOt;
        if !counted {
            if update.v < self.version {
                return Ok(Applied::Ignored);
            }
            if update.v > self.version {
                self.known = self.known.max(update.v + 1);
                return Err(DocError::Gap {
                    expected: self.version,
                    got: update.v,
                });
            }
        }
        if update.op.is_none() {
            let matches = self
                .inflight
                .as_ref()
                .is_some_and(|inflight| !counted || inflight.sent_versions.contains(&update.v));
            if !matches {
                return Ok(Applied::Ignored);
            }
            return self.acknowledge();
        }
        if ours && self.inflight.is_some() {
            return self.acknowledge();
        }
        self.remote(update)
    }

    fn acknowledge(&mut self) -> Result<Applied, DocError> {
        let Some(inflight) = self.inflight.take() else {
            return Ok(Applied::Ignored);
        };
        self.format
            .acknowledge(&self.confirmed, &inflight.op, &inflight.echo)?;
        self.confirmed = inflight
            .op
            .apply(&self.confirmed)
            .map_err(|_| DocError::OutOfStep)?;
        self.version += 1;
        self.known = self.known.max(self.version);
        Ok(Applied::Acknowledged)
    }

    fn remote(&mut self, update: &AppliedUpdate) -> Result<Applied, DocError> {
        let inflight = self
            .inflight
            .as_mut()
            .map(|inflight| (&mut inflight.op, &mut inflight.echo));
        let steps = self.format.decode(&self.confirmed, update, inflight)?;
        let mut editor = TextOperation::new();
        editor.retain(utf16_len(&self.local));
        for step in steps {
            self.confirmed = step
                .confirmed
                .apply(&self.confirmed)
                .map_err(|_| DocError::OutOfStep)?;
            let mut step = step.past_inflight;
            if let Some(pending) = self.pending.take() {
                let (ours, theirs) =
                    TextOperation::transform(&pending, &step).map_err(|_| DocError::OutOfStep)?;
                self.pending = (!ours.is_noop()).then_some(ours);
                step = theirs;
            }
            self.local = step.apply(&self.local).map_err(|_| DocError::OutOfStep)?;
            editor = editor.compose(&step).map_err(|_| DocError::OutOfStep)?;
        }
        self.version += 1;
        self.known = self.known.max(self.version);
        if editor.is_noop() {
            return Ok(Applied::Ignored);
        }
        Ok(Applied::Remote(editor))
    }

    pub fn catch_up(
        &mut self,
        updates: &[AppliedUpdate],
        own: &[PublicId],
    ) -> Result<Vec<TextOperation>, DocError> {
        let mut remote = Vec::new();
        for update in updates {
            if let Applied::Remote(op) = self.applied(update, own)? {
                remote.push(op);
            }
        }
        Ok(remote)
    }

    pub fn rejoin_fresh(&mut self, version: u64, text: String, format: FormatState) -> Rejoin {
        let mine = std::mem::take(&mut self.local);
        let base = self
            .inflight
            .as_ref()
            .and_then(|inflight| inflight.op.apply(&self.confirmed).ok())
            .filter(|applied| *applied == text)
            .unwrap_or_else(|| self.confirmed.clone());
        *self = OverleafDoc {
            page_limit: self.page_limit,
            ..OverleafDoc::joined(self.id.clone(), version, text, format)
        };
        if mine == base || mine == self.local {
            let op = diff(&mine, &self.local);
            return Rejoin::Clean(op);
        }
        match rebase(&base, &mine, &self.local) {
            Some(rebased) if !rebased.overlapped => match rebased.operation.apply(&self.local) {
                Ok(merged) => {
                    let op = diff(&mine, &merged);
                    self.local = merged;
                    self.pending = (!rebased.operation.is_noop()).then_some(rebased.operation);
                    Rejoin::Merged(op)
                }
                Err(_) => Rejoin::Conflict {
                    mine,
                    theirs: self.local.clone(),
                },
            },
            _ => Rejoin::Conflict {
                mine,
                theirs: self.local.clone(),
            },
        }
    }
}
