//! Turning attachment references into what the run's model can read: an
//! image, a PDF document, extracted text, or a short note saying why a file
//! was not sent. Newer messages are resolved first, so the most recent
//! attachments win the request's size budget.
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine as _;
use oleafly_agent::caps::{
    accepts_documents, accepts_images, document_page_limit, request_media_budget,
    text_attachment_budget,
};
use oleafly_agent::{
    AgentEvent, CompletionRequest, ContentPart, Message, Resolved, Role, MAX_AGENT_DOCUMENTS,
    MAX_RUN_START_IMAGES, SUPPORTED_IMAGE_TYPES,
};

use super::{locate, read_bytes, read_meta, read_text, AttachmentMeta};

/// Text one attachment may add, before the run's overall text budget.
pub(crate) const PER_ATTACHMENT_TEXT_CHARS: usize = 200_000;

const SKIPPED: &str = "attachment_skipped";
const SENT_AS_TEXT: &str = "attachment_sent_as_text";
const TEXT_MIMES: [&str; 4] = [
    "application/json",
    "application/xml",
    "application/x-tex",
    "application/x-bibtex",
];

struct MediaBudget {
    bytes: usize,
    images_left: usize,
    documents_left: usize,
    /// PDF pages the request may still carry as documents. A provider limits
    /// the pages of a whole request, not of each file.
    pages_left: u32,
    text_chars: usize,
}

/// One run's attachment resolution, shared by the run start and every
/// steered message so they draw on the same budget.
pub(crate) struct RunMediaContext {
    root: PathBuf,
    project_id: Option<String>,
    images: Option<bool>,
    documents: bool,
    budget: Mutex<MediaBudget>,
}

enum Outcome {
    Document(ContentPart),
    Image(ContentPart),
    Text(ContentPart, Option<Box<AgentEvent>>),
}

fn notice(code: &str, name: &str) -> AgentEvent {
    AgentEvent::Notice {
        code: code.to_string(),
        detail: Some(name.to_string()),
    }
}

fn skipped(name: &str, reason: &str) -> Outcome {
    Outcome::Text(
        ContentPart::text(format!("[Attachment \"{name}\" was not sent: {reason}]")),
        Some(Box::new(notice(SKIPPED, name))),
    )
}

/// The length of `size` bytes as base64.
fn base64_len(size: u64) -> usize {
    usize::try_from(size.div_ceil(3).saturating_mul(4)).unwrap_or(usize::MAX)
}

/// What a PDF with no recorded page count is counted as: one page for every
/// 50 KB. Papers run lower and scans higher, so a guess that errs on the
/// high side sends such a file as text sooner, which is the safe way to be
/// wrong.
const BYTES_PER_PAGE_GUESS: u64 = 50_000;

fn guessed_pages(bytes: u64) -> u32 {
    u32::try_from(bytes.div_ceil(BYTES_PER_PAGE_GUESS).max(1)).unwrap_or(u32::MAX)
}

/// The PDF a page image belongs to: the renderer names the images it adds
/// for a scanned PDF `<pdf name> page <n>.png`.
fn page_image_owner(name: &str) -> Option<&str> {
    let (owner, page) = name.strip_suffix(".png")?.rsplit_once(" page ")?;
    (!page.is_empty() && page.bytes().all(|byte| byte.is_ascii_digit())).then_some(owner)
}

fn text_like(mime: &str) -> bool {
    mime.starts_with("text/") || TEXT_MIMES.contains(&mime)
}

fn pages_label(pages: Option<u32>) -> String {
    match pages {
        Some(1) => " (1 page)".to_string(),
        Some(pages) => format!(" ({pages} pages)"),
        None => String::new(),
    }
}

impl RunMediaContext {
    pub(crate) fn new(root: PathBuf, project_id: Option<String>, resolved: &Resolved) -> Self {
        RunMediaContext {
            root,
            project_id,
            images: accepts_images(resolved),
            documents: accepts_documents(resolved),
            budget: Mutex::new(MediaBudget {
                bytes: request_media_budget(resolved),
                images_left: MAX_RUN_START_IMAGES,
                documents_left: MAX_AGENT_DOCUMENTS,
                pages_left: document_page_limit(resolved),
                text_chars: text_attachment_budget(resolved),
            }),
        }
    }

    fn budget(&self) -> std::sync::MutexGuard<'_, MediaBudget> {
        self.budget
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Resolves every attachment in the request. Images and documents
    /// already inline in it count against the budget first.
    pub(crate) fn resolve_request(
        &self,
        request: &mut CompletionRequest,
    ) -> Result<Vec<AgentEvent>, String> {
        {
            let mut budget = self.budget();
            for part in request.messages.iter().flat_map(|message| &message.content) {
                match part {
                    ContentPart::Image { image } => {
                        budget.bytes = budget.bytes.saturating_sub(image.len());
                        budget.images_left = budget.images_left.saturating_sub(1);
                    }
                    ContentPart::Document { data, .. } => {
                        budget.bytes = budget.bytes.saturating_sub(data.len());
                        budget.documents_left = budget.documents_left.saturating_sub(1);
                        let decoded = u64::try_from(data.len() / 4 * 3).unwrap_or(u64::MAX);
                        budget.pages_left =
                            budget.pages_left.saturating_sub(guessed_pages(decoded));
                    }
                    _ => {}
                }
            }
        }
        let mut events = Vec::new();
        let mut newest = true;
        for message in request.messages.iter_mut().rev() {
            if message.role == Role::User {
                let raised = self.resolve_message(message)?;
                if newest {
                    events.extend(raised);
                    newest = false;
                }
            }
        }
        Ok(events)
    }

    /// Resolves the attachments of one message (a steer, mid-run). Within
    /// the message, documents come first, then images, then attachment text
    /// and notes, then the user's own parts.
    pub(crate) fn resolve_message(&self, message: &mut Message) -> Result<Vec<AgentEvent>, String> {
        if !message
            .content
            .iter()
            .any(|part| matches!(part, ContentPart::Attachment { .. }))
        {
            return Ok(Vec::new());
        }
        // PDFs the renderer sent with page images of their own: a PDF that
        // cannot go as a document or text is still partly sent, as images.
        let pdfs_with_pages: HashSet<String> = message
            .content
            .iter()
            .filter_map(|part| match part {
                ContentPart::Attachment { name, mime, .. }
                    if mime.to_ascii_lowercase().starts_with("image/") =>
                {
                    page_image_owner(name).map(str::to_string)
                }
                _ => None,
            })
            .collect();
        let mut documents = Vec::new();
        let mut images = Vec::new();
        let mut texts = Vec::new();
        let mut own = Vec::new();
        let mut events = Vec::new();
        for part in std::mem::take(&mut message.content) {
            match part {
                ContentPart::Attachment { sha256, name, mime } => {
                    let pages_follow = pdfs_with_pages.contains(&name);
                    match self.resolve_one(&sha256, &name, &mime.to_ascii_lowercase(), pages_follow)
                    {
                        Outcome::Document(part) => documents.push(part),
                        Outcome::Image(part) => images.push(part),
                        Outcome::Text(part, event) => {
                            texts.push(part);
                            events.extend(event.map(|event| *event));
                        }
                    }
                }
                other => own.push(other),
            }
        }
        message.content = documents
            .into_iter()
            .chain(images)
            .chain(texts)
            .chain(own)
            .collect();
        Ok(events)
    }

    fn located(&self, sha256: &str) -> Option<(String, AttachmentMeta)> {
        let scope = locate(&self.root, self.project_id.as_deref(), sha256)?;
        let meta = read_meta(&self.root, &scope, sha256).ok().flatten()?;
        Some((scope, meta))
    }

    fn resolve_one(&self, sha256: &str, name: &str, mime: &str, pages_follow: bool) -> Outcome {
        let Some((scope, meta)) = self.located(sha256) else {
            return skipped(name, "it is no longer stored on this computer.");
        };
        if mime.starts_with("image/") {
            return self.image(&scope, &meta, name, mime);
        }
        if mime == "application/pdf" {
            return self.pdf(&scope, &meta, name, pages_follow);
        }
        if text_like(mime) {
            return match read_bytes(&self.root, &scope, sha256) {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    Outcome::Text(
                        self.attachment_text(&format!("Attached file \"{name}\":"), &text),
                        None,
                    )
                }
                Err(_) => skipped(name, "it is no longer stored on this computer."),
            };
        }
        skipped(name, "this file type is not supported.")
    }

    fn image(&self, scope: &str, meta: &AttachmentMeta, name: &str, mime: &str) -> Outcome {
        if !SUPPORTED_IMAGE_TYPES.contains(&mime) {
            return skipped(name, "this image type is not supported.");
        }
        if self.images == Some(false) {
            return skipped(name, "this model does not accept images.");
        }
        let prefix = format!("data:{mime};base64,");
        let size = prefix.len().saturating_add(base64_len(meta.size));
        {
            let budget = self.budget();
            if budget.images_left == 0 || size > budget.bytes {
                return skipped(name, "there was no room for it in this request.");
            }
        }
        let Ok(bytes) = read_bytes(&self.root, scope, &meta.sha256) else {
            return skipped(name, "it is no longer stored on this computer.");
        };
        let mut budget = self.budget();
        budget.images_left = budget.images_left.saturating_sub(1);
        budget.bytes = budget.bytes.saturating_sub(size);
        Outcome::Image(ContentPart::Image {
            image: format!(
                "{prefix}{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ),
        })
    }

    fn pdf(&self, scope: &str, meta: &AttachmentMeta, name: &str, pages_follow: bool) -> Outcome {
        let size = base64_len(meta.size);
        let pages = meta.pages.unwrap_or_else(|| guessed_pages(meta.size));
        let room = {
            let budget = self.budget();
            budget.documents_left > 0 && size <= budget.bytes && pages <= budget.pages_left
        };
        if self.documents && room {
            if let Ok(bytes) = read_bytes(&self.root, scope, &meta.sha256) {
                let mut budget = self.budget();
                budget.documents_left = budget.documents_left.saturating_sub(1);
                budget.bytes = budget.bytes.saturating_sub(size);
                budget.pages_left = budget.pages_left.saturating_sub(pages);
                return Outcome::Document(ContentPart::Document {
                    mime: "application/pdf".into(),
                    data: base64::engine::general_purpose::STANDARD.encode(bytes),
                    name: name.to_string(),
                });
            }
        }
        if meta.has_text {
            if let Ok(Some(text)) = read_text(&self.root, scope, &meta.sha256) {
                let header = format!(
                    "Attached file \"{name}\"{}. Oleafly extracted this text from the PDF:",
                    pages_label(meta.pages)
                );
                return Outcome::Text(
                    self.attachment_text(&header, &text),
                    Some(Box::new(notice(SENT_AS_TEXT, name))),
                );
            }
        }
        if pages_follow {
            return Outcome::Text(
                ContentPart::text(format!(
                    "[Attachment \"{name}\"{} has no text Oleafly could extract. The images that follow are its first pages.]",
                    pages_label(meta.pages)
                )),
                None,
            );
        }
        skipped(name, "no text could be extracted from it.")
    }

    /// `header` and `text`, cut to what one attachment and the run's text
    /// budget allow.
    fn attachment_text(&self, header: &str, text: &str) -> ContentPart {
        let mut budget = self.budget();
        let allowed = PER_ATTACHMENT_TEXT_CHARS.min(budget.text_chars);
        let total = text.chars().count();
        let kept: String = text.chars().take(allowed).collect();
        let used = kept.chars().count();
        budget.text_chars = budget.text_chars.saturating_sub(used);
        let mut body = format!("{header}\n{kept}");
        if used < total {
            body.push_str(&format!("\n[Text truncated after {used} characters.]"));
        }
        ContentPart::text(body)
    }
}

#[cfg(test)]
mod tests;
