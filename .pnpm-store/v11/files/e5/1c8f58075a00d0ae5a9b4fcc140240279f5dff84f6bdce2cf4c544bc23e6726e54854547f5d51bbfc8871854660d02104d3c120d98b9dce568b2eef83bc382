import * as Ast from "@unified-latex/unified-latex-types";
import * as TikzSpec from "./types";
type TikzParseOptions = {
    startRule?: "path_spec" | "foreach_body";
};
/**
 * Parse the contents of the `\systeme{...}` macro
 */
export declare function parse<Options extends TikzParseOptions>(ast: Ast.Node[], options?: Options): Options extends {
    startRule: infer R;
} ? R extends "path_spec" ? TikzSpec.PathSpec : TikzSpec.ForeachBody : TikzSpec.PathSpec;
export {};
//# sourceMappingURL=parser.d.ts.map