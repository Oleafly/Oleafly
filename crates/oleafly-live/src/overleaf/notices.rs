use oleafly_collab::CollabError;
use oleafly_online::live::session::Resolution;
use serde::Serialize;

use super::{live_error, OverleafLive};
use crate::live::session::{guard, not_live};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Setting {
    MainDoc,
    Compiler,
    Spelling,
    Image,
    Bibliography,
}

impl Setting {
    pub fn wire(self) -> &'static str {
        match self {
            Setting::MainDoc => "rootDoc",
            Setting::Compiler => "compiler",
            Setting::Spelling => "spellCheckLanguage",
            Setting::Image => "imageName",
            Setting::Bibliography => "mainBibliographyDoc",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotSent {
    NoEquivalent,
    Refused,
    Failed,
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OverleafNotice {
    Merged {
        path: String,
        before: String,
        after: String,
    },
    NeedsReview {
        path: String,
        mine: String,
        theirs: String,
    },
    Maintenance {
        message: String,
        #[serde(rename = "delayMs")]
        delay_ms: u64,
    },
    SlowAck {
        waiting: bool,
    },
    Unsteady {
        path: String,
    },
    Fault {
        path: String,
        reason: String,
    },
    External {
        path: String,
    },
    Replaced {
        path: String,
    },
    SettingNotSent {
        setting: Setting,
        reason: NotSent,
    },
    Filling {
        done: usize,
        total: usize,
    },
    Filled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverleafNoticePayload {
    pub project_id: String,
    #[serde(flatten)]
    pub notice: OverleafNotice,
}

impl OverleafLive {
    pub fn resolve(&self, path: &str, choice: Resolution) -> Result<(), CollabError> {
        let doc = self.doc_at(path).ok_or_else(not_live)?;
        self.session.resolve(&doc, choice).map_err(live_error)
    }

    pub fn retry(&self, path: &str) -> Result<(), CollabError> {
        let doc = self.doc_at(path).ok_or_else(not_live)?;
        self.session.retry(&doc).map_err(live_error)
    }

    pub fn has_unsent(&self, path: &str) -> bool {
        let waiting = self.session.details().pending_docs;
        if waiting.contains(&self.mirror.engine_path(path)) {
            return true;
        }
        let here = self.mirror.read_exact(path).map(|(_, hash)| hash);
        here.is_some() && here != guard(&self.mirror.disk.disk).hashes.get(path).cloned()
    }

    pub fn keep_copy(&self, path: &str) -> Result<(), CollabError> {
        let doc = self.doc_at(path).ok_or_else(not_live)?;
        self.session.keep_and_reload(&doc).map_err(live_error)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{OverleafNotice, OverleafNoticePayload};

    #[test]
    fn a_notice_reaches_the_page_flat_and_camel_cased() {
        let payload = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::Maintenance {
                message: "Back <b>soon</b>".into(),
                delay_ms: 1_000,
            },
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            json!({ "projectId": "p1", "kind": "maintenance", "message": "Back <b>soon</b>", "delayMs": 1000 })
        );
        let review = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::NeedsReview {
                path: "main.tex".into(),
                mine: "a".into(),
                theirs: "b".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(&review).unwrap(),
            json!({ "projectId": "p1", "kind": "needs_review", "path": "main.tex", "mine": "a", "theirs": "b" })
        );
        let fault = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::Fault {
                path: "main.tex".into(),
                reason: "too_long".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(&fault).unwrap(),
            json!({ "projectId": "p1", "kind": "fault", "path": "main.tex", "reason": "too_long" })
        );
        let external = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::External {
                path: "main.tex".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(&external).unwrap(),
            json!({ "projectId": "p1", "kind": "external", "path": "main.tex" })
        );
    }
}
