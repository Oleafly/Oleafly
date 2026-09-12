export const PREVIEW_MESSAGE_KEYS = [
  "error.passwordIncorrect",
  "error.passwordRequired",
  "error.invalid",
  "error.unavailable",
  "error.generic",
  "error.empty",
  "error.firstPage",
  "link.blockedScheme",
  "search.failed",
  "outline.empty",
  "outline.failed",
  "outline.destinationUnavailable",
  "outline.blockedScheme",
  "outline.noDestination",
  "outline.untitled",
  "status.loading",
  "a11y.document",
  "a11y.page",
  "a11y.textLayer",
  "screenReader.layer",
  "screenReader.title",
  "screenReader.pageLabel",
  "screenReader.empty",
] as const;

export type PreviewMessageKey = (typeof PREVIEW_MESSAGE_KEYS)[number];

export type PreviewTranslator = (
  key: PreviewMessageKey,
  params?: Record<string, string | number>,
) => string;

export const keyEchoTranslator: PreviewTranslator = (key) => key;
