import type * as Ast from '@unified-latex/unified-latex-types';

/**
 * Create an Argument. `special.braces` can optionally specify
 * the signature of the open/close marks that each argument uses. For example
 * ```
 * arg("a", { braces: "[]" });
 * ```
 * will result in arguments `[a]`. Valid braces are `*`, `[`, `{`, `<`, and `(`.
 *
 * `null` may be passed as the value of an empty optional argument. If `null` is passed,
 * the `openBrace` and `closeBrace` of the argument will be set to empty strings and the
 * contents will be set to an empty array. For example,
 * ```
 * args([null, "b"], { braces: "[]{}" });
 * ```
 * will produce the same structure as if the the first "optional argument" were omitted in regular parsing.
 */
export declare function arg(args: CoercibleArgument | Ast.Node[], special?: ArgumentSpecialOptions): Ast.Argument;

/**
 * Create an Argument list. `special.braces` can optionally specify
 * the signature of the open/close marks that each argument uses. For example
 * ```
 * args(["a", "b"], { braces: "[]{}" });
 * ```
 * will result in arguments `[a]{b}`. Valid braces are `*`, `[`, `{`, `(`, and `<`.
 *
 * `null` may be passed as the value of an empty optional argument. If `null` is passed,
 * the `openBrace` and `closeBrace` of the argument will be set to empty strings and the
 * contents will be set to an empty array. For example,
 * ```
 * args([null, "b"], { braces: "[]{}" });
 * ```
 * will produce the same structure as if the the first "optional argument" were omitted in regular parsing.
 */
export declare function args(args: CoercibleArgument | CoercibleArgument[], special?: ArgumentsSpecialOptions): Ast.Argument[];

declare type ArgumentSpecialOptions = {
    braces?: string;
    openMark?: string;
    closeMark?: string;
};

declare type ArgumentsSpecialOptions = {
    braces?: string;
    defaultOpenMark?: string;
    defaultCloseMark?: string;
};

declare type CoercibleArgument = null | CoercibleNode | Ast.Argument;

declare type CoercibleNode = string | Ast.Node;

/**
 * Create an Environment node.
 */
export declare function env(name: string, body: CoercibleNode | CoercibleNode[], envArgs?: CoercibleArgument | CoercibleArgument[], special?: unknown): Ast.Environment;

/**
 * Create a Macro with the given `name`. The macro
 * may be followed by any number of arguments.
 */
export declare function m(name: string, marcoArgs?: CoercibleArgument | CoercibleArgument[], special?: MacroSpecialOptions): Ast.Macro;

declare type MacroSpecialOptions = {
    escapeToken?: string;
};

/**
 * Create a String node from `value`
 */
export declare function s(value: string | Ast.String): Ast.String;

/**
 * Whitespace node.
 */
export declare const SP: Ast.Whitespace;

export { }
