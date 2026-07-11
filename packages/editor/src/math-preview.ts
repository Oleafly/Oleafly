import { hoverTooltip } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";

interface MathRange {
  from: number;
  to: number;
  inner: string;
  display: boolean;
}

/** Find the innermost math region containing `pos`. */
function findMath(text: string, pos: number): MathRange | null {
  // Inline $...$ - check if we're inside a $ pair on the current line.
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineBefore = before.slice(lineStart);

  // Count unescaped, un-doubled $ signs before pos on this line.
  let dollarOpen = -1;
  let inMath = false;
  for (let i = 0; i < lineBefore.length; i++) {
    if (lineBefore[i] === "$" && lineBefore[i - 1] !== "\\" && lineBefore[i + 1] !== "$") {
      inMath = !inMath;
      if (inMath) dollarOpen = lineStart + i;
    }
  }
  if (inMath) {
    const closeRel = after.indexOf("$");
    if (closeRel >= 0) {
      return {
        from: dollarOpen + 1,
        to: pos + closeRel,
        inner: text.slice(dollarOpen + 1, pos + closeRel).trim(),
        display: false,
      };
    }
  }

  // Display \[...\]
  const openDisp = before.lastIndexOf("\\[");
  const closeDisp = before.lastIndexOf("\\]");
  if (openDisp > closeDisp) {
    const closeRel = after.indexOf("\\]");
    if (closeRel >= 0) {
      return {
        from: openDisp + 2,
        to: pos + closeRel,
        inner: text.slice(openDisp + 2, pos + closeRel).trim(),
        display: true,
      };
    }
  }

  // Inline \(...\)
  const openIn = before.lastIndexOf("\\(");
  const closeIn = before.lastIndexOf("\\)");
  if (openIn > closeIn) {
    const closeRel = after.indexOf("\\)");
    if (closeRel >= 0) {
      return {
        from: openIn + 2,
        to: pos + closeRel,
        inner: text.slice(openIn + 2, pos + closeRel).trim(),
        display: false,
      };
    }
  }

  return null;
}

/** CM6 hover tooltip that renders math (KaTeX) when the cursor hovers over math. */
export function mathHover() {
  return hoverTooltip((view, pos) => {
    const text = view.state.doc.toString();
    const found = findMath(text, pos);
    if (!found || !found.inner) return null;
    try {
      const html = katex.renderToString(found.inner, {
        displayMode: found.display,
        throwOnError: false,
        errorColor: "var(--destructive)",
      });
      return {
        pos: found.from,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.style.cssText =
            "padding:8px 14px;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12);font-size:15px;max-width:400px;";
          dom.innerHTML = html;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });
}
