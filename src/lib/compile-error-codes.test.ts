import { describe, expect, it } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { explainCodedCompileErrors } from "./compile-error-codes";

const warning = (code: string | undefined) => ({
  line: null,
  file: null,
  message: "From the engine",
  kind: "warning",
  explanation: null,
  code,
});

describe("explainCodedCompileErrors", () => {
  it("explains why Quarto and Calepin did not run code", () => {
    const [skipped, stored, needed, plain] = explainCodedCompileErrors([
      warning("notebook.code_skipped"),
      warning("notebook.stored_results"),
      warning("notebook.code_needed"),
      warning(undefined),
    ]);
    expect(skipped.explanation).toBe(enShell.codeExecution.skipped);
    expect(stored.explanation).toBe(enShell.codeExecution.storedResults);
    expect(needed.explanation).toBe(enShell.codeExecution.needed);
    expect(plain.explanation).toBeNull();
    expect(skipped.message).toBe("From the engine");
  });
});
