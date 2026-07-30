import * as Ast from '@unified-latex/unified-latex-types';
import { Plugin as Plugin_2 } from 'unified';
import { VisitInfo } from '@unified-latex/unified-latex-util-visit';

/**
 * Returns the first non-whitespace/non-comment node in `nodes`. If there is no such
 * node, `null` is returned.
 */
export declare function firstSignificantNode(nodes: Ast.Node[], parbreaksAreInsignificant?: boolean): Ast.Node | null;

/**
 * Returns the index of the first non-whitespace/non-comment node in `nodes`. If there is no such
 * node, `null` is returned.
 */
export declare function firstSignificantNodeIndex(nodes: Ast.Node[], parbreaksAreInsignificant?: boolean): number | undefined;

/**
 * Returns the last non-whitespace/non-comment node in `nodes`. If there is no such
 * node, `null` is returned.
 */
export declare function lastSignificantNode(nodes: Ast.Node[], parbreaksAreInsignificant?: boolean): Ast.Node | null;

/**
 * Returns the index of the last non-whitespace/non-comment node in `nodes`. If there is no such
 * node, `null` is returned.
 */
export declare function lastSignificantNodeIndex(nodes: Ast.Node[], parbreaksAreInsignificant?: boolean): number | undefined;

declare type PluginOptions = {
    replacers: Record<string, (content: Ast.Node[], streamingCommand: Ast.Macro) => Ast.Node | Ast.Node[]>;
};

/**
 * Recursively replace nodes in `ast`. The `visitor` function is called on each node. If
 * `visitor` returns a node or an array of nodes, those nodes replace the node passed to `visitor`.
 * If `null` is returned, the node is deleted. If `undefined` is returned, no replacement happens.
 */
export declare function replaceNode(ast: Ast.Ast, visitor: (node: Ast.Node | Ast.Argument, info: VisitInfo) => Ast.Node | Ast.Argument | (Ast.Node | Ast.Argument)[] | null | undefined | void): void;

/**
 * Replaces the current node with `replacement`. It is assumed that the current
 * node is in an array that is a child of a parent element. If this is not the case,
 * the function will error.
 */
export declare function replaceNodeDuringVisit(replacement: Ast.Node | Ast.Argument | (Ast.Node | Ast.Argument)[], info: VisitInfo): void;

/**
 * Given a group or a node array, look for streaming commands (e.g., `\bfseries`) and replace them
 * with the specified macro. The "arguments" of the streaming command are passed to `replacer` and the return
 * value of `replacer` is inserted into the stream.
 *
 * By default, this command will split at parbreaks (since commands like `\textbf{...} do not accept parbreaks in their
 * contents) and call `replacer` multiple times, once per paragraph.
 *
 * Commands are also split at environments and at any macros listed in `macrosThatBreakPars`.
 */
export declare function replaceStreamingCommand(ast: Ast.Group | Ast.Node[], isStreamingCommand: (node: any) => node is Ast.Macro, replacer: (content: Ast.Node[], streamingCommand: Ast.Macro) => Ast.Node | Ast.Node[], options?: {
    macrosThatBreakPars?: string[];
    environmentsThatDontBreakPars?: string[];
}): Ast.Node[];

/**
 * Process streaming commands in a group. If needed, "escape" the group.
 * For example, `{\bfseries xx}` -> `\textbf{xx}`, but `{foo \bfseries xx}` -> `{foo \textbf{xx}}`.
 */
export declare function replaceStreamingCommandInGroup(group: Ast.Group, isStreamingCommand: (node: any) => node is Ast.Macro, replacer: (content: Ast.Node[], streamingCommand: Ast.Macro) => Ast.Node | Ast.Node[], options?: {
    macrosThatBreakPars?: string[];
    environmentsThatDontBreakPars?: string[];
}): Ast.Node[];

/**
 * Unified plugin to replace all found streaming commands with their argument-style equivalents.
 * This only applies to sections of the tree with no math ancestor.
 *
 * @param options.replacer A record of macro names and replacer functions. A replacer function accepts content and the original streaming command and is expected to return the argument-style command. It may be called multiple times per streaming command.
 */
export declare const unifiedLatexReplaceStreamingCommands: Plugin_2<PluginOptions[], Ast.Root, Ast.Root>;

export { }
