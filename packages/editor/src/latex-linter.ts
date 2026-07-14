import { linter, type Diagnostic } from "@codemirror/lint";

// Pure (text -> diagnostics) so it is unit-testable without a CodeMirror view.
export function lintLatexText(text: string): Diagnostic[] {
  const diags: Diagnostic[] = [];

  interface Tok {
    type: "begin" | "end";
    name: string;
    from: number;
    to: number;
  }
  const tokens: Tok[] = [];
  const re = /\\(begin|end)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    tokens.push({
      type: m[1] as "begin" | "end",
      name: m[2].trim(),
      from: m.index,
      to: m.index + m[0].length,
    });
  }
  const stack: Tok[] = [];
  for (const tok of tokens) {
    if (tok.type === "begin") {
      stack.push(tok);
    } else {
      const top = stack.pop();
      if (!top) {
        diags.push({
          from: tok.from,
          to: tok.to,
          severity: "error",
          message: `\\end{${tok.name}} without matching \\begin`,
        });
      } else if (top.name !== tok.name) {
        diags.push({
          from: tok.from,
          to: tok.to,
          severity: "error",
          message: `Mismatched: expected \\end{${top.name}}, got \\end{${tok.name}}`,
        });
        stack.push(top);
      }
    }
  }
  for (const open of stack) {
    diags.push({
      from: open.from,
      to: open.to,
      severity: "error",
      message: `Unclosed environment \\begin{${open.name}}`,
    });
  }

  const labelRe = /\\label\s*\{([^}]*)\}/g;
  const seen = new Map<string, number>();
  while ((m = labelRe.exec(text))) {
    const key = m[1].trim();
    if (seen.has(key)) {
      diags.push({
        from: m.index,
        to: m.index + m[0].length,
        severity: "warning",
        message: `Duplicate label: "${key}"`,
      });
    } else {
      seen.set(key, m.index);
    }
  }

  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    const clean = line.replace(/\\[$]/g, "").replace(/\$\$/g, "");
    const dollarCount = (clean.match(/\$/g) || []).length;
    if (dollarCount % 2 !== 0) {
      const idx = clean.indexOf("$");
      if (idx >= 0) {
        diags.push({
          from: offset + idx,
          to: offset + idx + 1,
          severity: "warning",
          message: "Unmatched $ on this line",
        });
      }
    }
    offset += line.length + 1; // +1 for \n
  }

  return diags;
}

export function createLatexLinter() {
  return linter((view): Diagnostic[] => lintLatexText(view.state.doc.toString()), {
    delay: 800,
  });
}
