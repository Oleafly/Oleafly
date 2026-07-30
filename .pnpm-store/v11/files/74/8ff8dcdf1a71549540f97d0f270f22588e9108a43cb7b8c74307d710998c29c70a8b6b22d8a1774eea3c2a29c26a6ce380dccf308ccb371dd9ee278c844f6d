import { ArgSpecAst } from '@unified-latex/unified-latex-util-argspec';
import { ArgumentParser } from '@unified-latex/unified-latex-types';
import * as Ast from '@unified-latex/unified-latex-types';
import { MacroInfoRecord } from '@unified-latex/unified-latex-types';
import { Plugin as Plugin_2 } from 'unified';

/**
 * Recursively search for and attach the arguments for a
 * particular macro to its AST node. `macros` should
 * contain a `signature` property which specifies the arguments
 * signature in xparse syntax.
 */
export declare function attachMacroArgs(tree: Ast.Ast, macros: MacroInfoRecord): void;

/**
 * Search (in a right-associative way) through the array for instances of
 * `macros` and attach arguments to the macro. Argument signatures are
 * specified by `macros[].signature`.
 *
 * Info stored in `macros[].renderInfo` will be attached to the node
 * with attribute `_renderInfo`.
 */
export declare function attachMacroArgsInArray(nodes: Ast.Node[], macros: MacroInfoRecord): void;

/**
 * Returns the content of `args` for a macro or environment as an array. If an argument
 * was omitted (e.g., because it was an optional arg that wasn't included), then `null` is returned.
 */
export declare function getArgsContent(node: Ast.Macro | Ast.Environment): (Ast.Node[] | null)[];

/**
 * Returns the content of `args` for a macro or environment as an object whose keys are the "names"
 * of each argument. These names of the arguments must be specified in the `_renderInfo` prop. If `_renderInfo`
 * does not contain a `namedArguments` array, then an empty object will be returned.
 *
 * @namedArgumentsFallback - If `_renderInfo.namedArguments` is not provided, `namedArgumentsFallback` is ued.
 */
export declare function getNamedArgsContent(node: Ast.Macro | Ast.Environment, namedArgumentsFallback?: readonly (string | null)[]): Record<string, Ast.Node[] | null>;

/**
 * Gobbles an argument of whose type is specified
 * by `argSpec` starting at the position `startPos`. If an argument couldn't be found,
 * `argument` will be `null`.
 */
export declare function gobbleArguments(nodes: Ast.Node[], argSpec: string | ArgSpecAst.Node[] | ArgumentParser, startPos?: number): {
    args: Ast.Argument[];
    nodesRemoved: number;
};

/**
 * Gobbles an argument of whose type is specified
 * by `argSpec` starting at the position `startPos`.
 * If an argument couldn't be found, `argument` will be `null`.
 */
export declare function gobbleSingleArgument(nodes: Ast.Node[], argSpec: ArgSpecAst.Node, startPos?: number): {
    argument: Ast.Argument | null;
    nodesRemoved: number;
};

declare type PluginOptions = {
    macros: MacroInfoRecord;
} | undefined;

/**
 * Unified plugin to attach macro arguments to the macros specified via the `macros`
 * option.
 *
 * @param macros An object whose keys are macro names and values contains information about the macro and its argument signature.
 */
export declare const unifiedLatexAttachMacroArguments: Plugin_2<PluginOptions[], Ast.Root, Ast.Root>;

export { }
