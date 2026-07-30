import * as Ast from '@unified-latex/unified-latex-types';

export declare const anyEnvironment: (node: any) => node is Ast.Environment;

export declare const anyMacro: (node: any) => node is Ast.Macro;

export declare const anyString: (node: any) => node is Ast.String;

export declare const argument: (node: any) => node is Ast.Argument;

export declare const blankArgument: (node: any) => boolean;

export declare const comment: (node: any) => node is Ast.Comment;

/**
 * Creates a macro matching function that uses a `SpecialMacroSpec` or list of macros
 * and generates a hash for quick lookup.
 */
declare function createEnvironmentMatcher(macros: string[] | Record<string, unknown>): Ast.TypeGuard<Ast.Environment>;

/**
 * Creates a macro matching function that uses a `SpecialMacroSpec` or list of macros
 * and generates a hash for quick lookup.
 */
declare function createMacroMatcher<S extends string>(macros: Ast.Macro[] | S[] | Record<S, unknown>): Ast.TypeGuard<Ast.Macro & {
    content: S;
}>;

export declare const environment: (node: any, envName?: string) => node is Ast.Environment;

export declare const group: (node: any) => node is Ast.Group;

export declare const macro: (node: any, macroName?: string) => node is Ast.Macro;

/**
 * Functions to match different types of nodes.
 */
export declare const match: {
    macro(node: any, macroName?: string): node is Ast.Macro;
    anyMacro(node: any): node is Ast.Macro;
    environment(node: any, envName?: string): node is Ast.Environment;
    anyEnvironment(node: any): node is Ast.Environment;
    comment(node: any): node is Ast.Comment;
    parbreak(node: any): node is Ast.Parbreak;
    whitespace(node: any): node is Ast.Whitespace;
    /**
     * Matches whitespace or a comment with leading whitespace.
     */
    whitespaceLike(node: any): node is Ast.Whitespace | (Ast.Comment & {
        leadingWhitespace: true;
    });
    string(node: any, value?: string): node is Ast.String;
    anyString(node: any): node is Ast.String;
    group(node: any): node is Ast.Group;
    argument(node: any): node is Ast.Argument;
    blankArgument(node: any): boolean;
    math(node: any): node is Ast.DisplayMath | Ast.InlineMath;
    createMacroMatcher: typeof createMacroMatcher;
    createEnvironmentMatcher: typeof createEnvironmentMatcher;
};

export declare const math: (node: any) => node is Ast.DisplayMath | Ast.InlineMath;

export declare const parbreak: (node: any) => node is Ast.Parbreak;

export declare const string: (node: any, value?: string) => node is Ast.String;

export declare const whitespace: (node: any) => node is Ast.Whitespace;

export { }
