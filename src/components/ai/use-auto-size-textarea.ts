import { useEffect, type RefObject } from "react";

const DEFAULT_MAX_HEIGHT = 128;

function fitTextareaToContent(
  textarea: HTMLTextAreaElement,
  maxHeight: number,
) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
}

export function useAutoSizeTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  shellRef: RefObject<HTMLElement | null>,
  value: string,
  placeholder: string,
  maxHeight = DEFAULT_MAX_HEIGHT,
) {
  useEffect(() => {
    // Reading both controlled strings keeps resizing coupled to text and
    // placeholder wrapping, even though their pixels are measured from the DOM.
    void value;
    void placeholder;
    const textarea = textareaRef.current;
    if (!textarea) return;
    fitTextareaToContent(textarea, maxHeight);
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
      if (textarea) fitTextareaToContent(textarea, maxHeight);
    });

    observer.observe(shell);
    return () => observer.disconnect();
  }, [maxHeight, shellRef, textareaRef]);
}
