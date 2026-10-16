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
) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(contentHeight(textarea, placeholder), maxHeight)}px`;
}

export function useAutoSizeTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  shellRef: RefObject<HTMLElement | null>,
  value: string,
  placeholder: string,
  maxHeight = DEFAULT_MAX_HEIGHT,
) {
  const latestPlaceholder = useRef(placeholder);
  latestPlaceholder.current = placeholder;

  useEffect(() => {
    // Reading the controlled value keeps resizing coupled to typing, even
    // though its pixels are measured from the DOM.
    void value;
    const textarea = textareaRef.current;
    if (!textarea) return;
    fitTextareaToContent(textarea, maxHeight, placeholder);
  }, [maxHeight, placeholder, textareaRef, value]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;

    let previousWidth = shell.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth === undefined || nextWidth === previousWidth) return;
      previousWidth = nextWidth;

      const textarea = textareaRef.current;
      if (textarea) fitTextareaToContent(textarea, maxHeight, latestPlaceholder.current);
    });

    observer.observe(shell);
    return () => observer.disconnect();
  }, [maxHeight, shellRef, textareaRef]);
}
