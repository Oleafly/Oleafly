import { useEffect, useRef, type RefObject } from "react";

const DEFAULT_MAX_HEIGHT = 128;

// WebKit leaves part of a wrapped placeholder out of scrollHeight (two lines
// measure about one and a half), so an empty box is measured with its
// placeholder typed in, then emptied again before anything paints.
function contentHeight(textarea: HTMLTextAreaElement, placeholder: string): number {
  if (textarea.value !== "" || placeholder === "") return textarea.scrollHeight;
  textarea.value = placeholder;
  const height = textarea.scrollHeight;
  textarea.value = "";
  return height;
}

function fitTextareaToContent(
  textarea: HTMLTextAreaElement,
  maxHeight: number,
  placeholder: string,
  minHeight: number,
) {
  textarea.style.height = "auto";
  const height = Math.min(contentHeight(textarea, placeholder), maxHeight);
  textarea.style.height = `${Math.max(height, Math.min(minHeight, maxHeight))}px`;
}

export function useAutoSizeTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  shellRef: RefObject<HTMLElement | null>,
  value: string,
  placeholder: string,
  maxHeight = DEFAULT_MAX_HEIGHT,
  minHeight = 0,
) {
  const latestPlaceholder = useRef(placeholder);
  latestPlaceholder.current = placeholder;

  useEffect(() => {
    void value;
    const textarea = textareaRef.current;
    if (!textarea) return;
    fitTextareaToContent(textarea, maxHeight, placeholder, minHeight);
  }, [maxHeight, minHeight, placeholder, textareaRef, value]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;

    let previousWidth = shell.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth === undefined || nextWidth === previousWidth) return;
      previousWidth = nextWidth;

      const textarea = textareaRef.current;
      if (textarea) fitTextareaToContent(textarea, maxHeight, latestPlaceholder.current, minHeight);
    });

    observer.observe(shell);
    return () => observer.disconnect();
  }, [maxHeight, minHeight, shellRef, textareaRef]);
}
