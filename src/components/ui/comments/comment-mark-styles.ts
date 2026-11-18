export function commentMarkStyle(active: boolean) {
  const [background, underline] = active
    ? ["--comment-active", "--comment-active-underline"]
    : ["--comment-highlight", "--comment-underline"];
  return {
    backgroundColor: `var(${background})`,
    backgroundImage: `linear-gradient(to top, var(${underline}) 2px, transparent 2px)`,
  };
}

export const COMMENT_RANGE_STYLES = {
  ".cm-comment-range": {
    ...commentMarkStyle(false),
    borderRadius: "2px 2px 0 0",
  },
  ".cm-comment-range.cm-comment-active, .cm-comment-draft": commentMarkStyle(true),
  ".cm-comment-range.cm-comment-flash": {
    ...commentMarkStyle(true),
    backgroundColor: "color-mix(in oklab, var(--comment-active-underline) 28%, var(--comment-active))",
  },
};
