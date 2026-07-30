import * as SystemeSpec from "./types";
import * as Ast from "@unified-latex/unified-latex-types";
/**
 * Extract the variables from a systeme system of equations.
 */
export declare function extractVariables(nodes: SystemeSpec.Node[]): Ast.Node[][];
/**
 * Lays out the contents of a \systeme{...} macro as an array. This function sorts the variables
 * in alphabetical order and lays out any annotations. An `\begin{array}...\end{array}` environment
 * is returned.
 *
 * If `properSpacing=true` then kerning information will be included in the array specification to space
 * the operators correctly. This kerning information will make the specification long (and may make it incompatible
 * with KaTeX).
 *
 * An optional whitelist of variables may be supplied. If supplied, only listed items will count as variables and
 * the order of variable appearance will be the same as the order of the whitelisted variables.
 */
export declare function systemeContentsToArray(nodes: Ast.Node[], options?: {
    properSpacing?: boolean;
    whitelistedVariables?: (string | Ast.String | Ast.Macro)[];
}): Ast.Environment;
/**
 * Find any systeme definitions, e.g. `\sysdelim{.}{.}`, and attach their information
 * to the renderInfo of of the systeme macros.
 *
 */
export declare function attachSystemeSettingsAsRenderInfo(ast: Ast.Ast): void;
//# sourceMappingURL=systeme.d.ts.map