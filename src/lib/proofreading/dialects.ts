import type { Dialect } from "harper.js";
import type { ProofreadingDialect } from "@oleafly/editor";

export function harperDialectFor(
  values: typeof import("harper.js").Dialect,
  dialect: ProofreadingDialect,
): Dialect {
  const dialects: Record<ProofreadingDialect, Dialect> = {
    american: values.American,
    british: values.British,
    australian: values.Australian,
    canadian: values.Canadian,
    indian: values.Indian,
  };
  return dialects[dialect];
}
