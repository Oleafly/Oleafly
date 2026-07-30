import * as Ast from '@unified-latex/unified-latex-types';
import { EnvInfoRecord } from '@unified-latex/unified-latex-types';
import { FrozenProcessor } from 'unified';
import { MacroInfoRecord } from '@unified-latex/unified-latex-types';
import { Plugin as Plugin_2 } from 'unified';

/**
 * Returns the default `unified-latex` parser, or create a new one with the
 * provided `unifiedLatexFromString` options
 * @param options Plugin options of `unifiedLatexFromString` plugin.
 * @returns The default `unified-latex` parser if `options` is `undefined`, or a
 * newly created `unified-latex` parser with the provided `options`.
 */
export declare function getParser(options?: PluginOptions): FrozenProcessor<Ast.Root, Ast.Root, Ast.Root, void>;

/**
 * Parse the string into an AST.
 */
export declare function parse(str: string): Ast.Root;

/**
 * Parse `str` into an AST. Parsing starts in math mode and a list of
 * nodes is returned (instead of a "root" node).
 */
export declare function parseMath(str: string | Ast.Ast): Ast.Node[];

/**
 * Parse `str` to an AST with minimal processing. E.g., macro
 * arguments are not attached to macros, etc. when parsed with this
 * function.
 *
 * The parsing assumes a math-mode context, so, for example, `^` and `_` are
 * parsed as macros (even though arguments are not attached to them).
 */
export declare function parseMathMinimal(str: string): Ast.Node[];

/**
 * Parse `str` to an AST with minimal processing. E.g., macro
 * arguments are not attached to macros, etc. when parsed with this
 * function.
 */
export declare function parseMinimal(str: string): Ast.Root;

export declare type PluginOptions = {
    mode?: "math" | "regular";
    macros?: MacroInfoRecord;
    environments?: EnvInfoRecord;
    flags?: {
        /**
         * Whether to parse macros as if `\makeatletter` is set (i.e., parse `@` as a regular macro character)
         */
        atLetter?: boolean;
        /**
         * Whether to parse macros as if `\ExplSyntaxOn` is set (i.e., parse `_` and `:` as a regular macro character)
         */
        expl3?: boolean;
        /**
         * Attempt to autodetect whether there are macros that look like they should contain `@`, `_`, or `:`.
         * Defaults to `false`.
         */
        autodetectExpl3AndAtLetter?: boolean;
    };
} | undefined;

declare type PluginOptions_2 = {
    /**
     * Whether the text will be parsed assuming math mode or not.
     */
    mode: "math" | "regular";
} | void;

declare type PluginOptions_3 = {
    /**
     * Whether to parse macros as if `\makeatletter` is set (i.e., parse `@` as a regular macro character).
     * If this option is true, it disables autodetect.
     */
    atLetter?: boolean;
    /**
     * Whether to parse macros as if `\ExplSyntaxOn` is set (i.e., parse `_` and `:` as a regular macro character)
     * If this option is true, it disables autodetect.
     */
    expl3?: boolean;
    /**
     * Attempt to autodetect whether there are macros that look like they should contain `@`, `_`, or `:`.
     * Defaults to `true`.
     */
    autodetectExpl3AndAtLetter?: boolean;
} | undefined;

declare type PluginOptions_4 = {
    environments: EnvInfoRecord;
    macros: MacroInfoRecord;
} | undefined;

declare type PluginOptions_5 = {
    /**
     * List of environments whose body should be parsed in math mode
     */
    mathEnvs: string[];
    /**
     * List of macros whose bodies should be parsed in math mode
     */
    mathMacros: string[];
} | undefined;

/**
 * Unified complier plugin that passes through a LaTeX AST without modification.
 */
export declare const unifiedLatexAstComplier: Plugin_2<void[], Ast.Root, Ast.Root>;

/**
 * Parse a string to a LaTeX AST.
 */
export declare const unifiedLatexFromString: Plugin_2<PluginOptions[], string, Ast.Root>;

/**
 * Parse a string to a LaTeX AST with no post processing. For example,
 * no macro arguments will be attached, etc.
 */
export declare const unifiedLatexFromStringMinimal: Plugin_2<PluginOptions_2[], string, Ast.Root>;

/**
 * Unified plugin to reprocess macros names to possibly include `@`, `_`, or `:`.
 * This plugin detects the `\makeatletter` and `\ExplSyntaxOn` commands and reprocesses macro names
 * inside of those blocks to include those characters.
 */
export declare const unifiedLatexProcessAtLetterAndExplMacros: Plugin_2<PluginOptions_3[], Ast.Root, Ast.Root>;

/**
 * Unified plugin to process macros and environments. Any environments that contain math content
 * are reparsed (if needed) in math mode.
 */
export declare const unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse: Plugin_2<PluginOptions_4[], Ast.Root, Ast.Root>;

/**
 * Reparse math environments/macro contents that should have been parsed in math mode but weren't.
 */
export declare const unifiedLatexReparseMath: Plugin_2<PluginOptions_5[], Ast.Root, Ast.Root>;

/**
 * Construct the inner function for the `unifiedLatexReparseMath` plugin. This function should not be used by libraries.
 */
export declare function unifiedLatexReparseMathConstructPlugin({ mathEnvs, mathMacros, }: {
    mathEnvs: string[];
    mathMacros: string[];
}): (tree: Ast.Root) => void;

export { }
