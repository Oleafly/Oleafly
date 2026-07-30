import * as Ast from '@unified-latex/unified-latex-types';

/**
 * Find regions between `\ExplSyntaxOn...\ExplSyntaxOff` and `\makeatletter...\makeatother`.
 * Returns an object containing regions where one or both syntax's apply.
 */
export declare function findExpl3AndAtLetterRegionsInArray(tree: Ast.Node[]): {
    explOnly: Region[];
    atLetterOnly: Region[];
    both: Region[];
};

/**
 * Find all contiguous segments in the array that are between start and end blocks.
 * The `start` and `end` are functions that determine when a region starts and ends.
 */
export declare function findRegionInArray(tree: Ast.Node[], start: (node: Ast.Node) => boolean, end: (node: Ast.Node) => boolean): Region[];

/**
 * Checks whether `tree` has a macro that could be reparsed given the `allowedTokens` but
 * do not do any reparsing. This function can be used in auto-detection schemes to determine if
 * macro names should actually be reparsed.
 */
export declare function hasReparsableMacroNames(tree: Ast.Ast, allowedTokens: string | Set<string>): boolean;

/**
 * Checks whether the array has a macro that could be reparsed given the `allowedTokens` but
 * do not do any reparsing. This function can be used in auto-detection schemes to determine if
 * macro names should actually be reparsed.
 */
export declare function hasReparsableMacroNamesInArray(tree: Ast.Node[], allowedTokens: Set<string>): boolean;

declare type Region = {
    start: number;
    end: number;
};

/**
 * Find regions between `\ExplSyntaxOn...\ExplSyntaxOff` and `\makeatletter...\makeatother`
 * and reparse their contents so that the relevant characters (e.g., `@`, `_`, and `:`) become
 * part of the macro names.
 */
export declare function reparseExpl3AndAtLetterRegions(tree: Ast.Ast): void;

/**
 * Reparses all macro names so that they may optionally include characters listed in `allowedTokens`.
 * This is used, for example, when parsing expl3 syntax which allows `_` to be used in a macro name (even though
 * `_` is normally stops the parsing for a macro name). Thus, a macro `\foo_bar:Nn` would be parsed as having
 * the name `foo_bar:Nn` rather than as `foo` followed by the strings `_`, `bar`, `:`, `Nn`.
 */
export declare function reparseMacroNames(tree: Ast.Ast, allowedTokens: string | Set<string>): void;

/**
 * Reparses all macro names in the array so that they may optionally include characters listed in `allowedTokens`.
 * This is used, for example, when parsing expl3 syntax which allows `_` to be used in a macro name (even though
 * `_` is normally stops the parsing for a macro name).
 */
export declare function reparseMacroNamesInArray(tree: Ast.Node[], allowedTokens: Set<string>): void;

export { }
