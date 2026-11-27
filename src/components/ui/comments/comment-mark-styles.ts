export function commentMarkStyle(active: boolean) {
  const [background, underline] = active
    ? ["--comment-active", "--comment-active-underline"]
    : ["--comment-highlight", "--comment-underline"];
  return {
    backgroundColor: `var(${background})`,
    borderRadius: "2px",
    textDecorationLine: "underline",
    textDecorationColor: `var(${underline})`,
    textDecorationThickness: "2px",
    textDecorationSkipInk: "none",
    textUnderlinePosition: "under",
    textUnderlineOffset: "0.2em",
  } as const;
}

export const COMMENT_RANGE_STYLES = {
  ".cm-comment-range": commentMarkStyle(false),
  ".cm-comment-range.cm-comment-active, .cm-comment-draft": commentMarkStyle(true),
  ".cm-comment-range.cm-comment-flash": {
    ...commentMarkStyle(true),
    backgroundColor: "color-mix(in oklab, var(--comment-active-underline) 28%, var(--comment-active))",
  },
};
