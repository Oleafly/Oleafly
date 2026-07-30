import * as Ast from '@unified-latex/unified-latex-types';

/**
 * Joins an array of arrays with the item `sep`
 */
export declare function arrayJoin<T>(array: T[][], sep: T | T[]): T[];

/**
 * Split a list of nodes based on whether `splitFunc` returns `true`.
 * If `onlySplitOnFirstOccurrence` is set to true in the `options` object, then
 * there will be at most two segments returned.
 */
export declare function splitOnCondition(nodes: Ast.Node[], splitFunc?: (node: Ast.Node) => boolean, options?: {
    onlySplitOnFirstOccurrence?: boolean;
}): {
    segments: Ast.Node[][];
    separators: Ast.Node[];
};

/**
 * Split an array of AST nodes based on a macro. An object `{segments: [], macros: []}`
 * is returned. The original array is reconstructed as
 * `segments[0] + macros[0] + segments[1] + ...`.
 *
 * @param {[object]} ast
 * @param {(string|[string])} macroName
 * @returns {{segments: [object], macros: [object]}}
 */
export declare function splitOnMacro(ast: Ast.Node[], macroName: string | string[]): {
    segments: Ast.Node[][];
    macros: Ast.Macro[];
};

/**
 * Does the reverse of `splitOnMacro`
 */
export declare function unsplitOnMacro({ segments, macros, }: {
    segments: Ast.Node[][];
    macros: Ast.Node[] | Ast.Node[][];
}): Ast.Node[];

export { }
