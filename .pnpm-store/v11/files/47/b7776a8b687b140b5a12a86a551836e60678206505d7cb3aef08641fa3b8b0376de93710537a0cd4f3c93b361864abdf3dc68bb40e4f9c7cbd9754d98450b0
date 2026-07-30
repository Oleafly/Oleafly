export declare interface Argument extends ContentNode {
    type: "argument";
    openMark: string;
    closeMark: string;
}

export declare type ArgumentParser = (nodes: Ast_2.Node[], startPos: number) => {
    args: Ast_2.Argument[];
    nodesRemoved: number;
};

export declare type Ast = Node_2 | Argument | Node_2[];

declare namespace Ast_2 {
    export {
        GenericAst,
        GenericNode,
        Root,
        String_2 as String,
        Whitespace,
        Parbreak,
        Comment_2 as Comment,
        Macro,
        Environment,
        VerbatimEnvironment,
        DisplayMath,
        Group,
        InlineMath,
        Verb,
        Argument,
        Node_2 as Node,
        Ast
    }
}

declare interface BaseNode {
    type: string;
    _renderInfo?: (MacroInfo["renderInfo"] | EnvInfo["renderInfo"]) & {
        defaultArg?: string;
    } & Record<string, unknown>;
    position?: {
        start: {
            offset: number;
            line: number;
            column: number;
        };
        end: {
            offset: number;
            line: number;
            column: number;
        };
    };
}

declare interface Comment_2 extends BaseNode {
    type: "comment";
    content: string;
    sameline?: boolean;
    suffixParbreak?: boolean;
    leadingWhitespace?: boolean;
}
export { Comment_2 as Comment }

declare interface ContentNode extends BaseNode {
    content: Node_2[];
}

declare const _default: {};
export default _default;

export declare interface DisplayMath extends ContentNode {
    type: "displaymath";
}

export declare type EnvInfo = {
    renderInfo?: EnvRenderInfo;
    /**
     * Function to process the body of an environment. The return value of `processContent`
     * is treated as the new body.
     *
     */
    processContent?: (ast: Ast_2.Node[]) => Ast_2.Node[];
    /**
     * The environment signature as an xparse argument specification string.
     *
     * @type {string}
     */
    signature?: string;
};

export declare type EnvInfoRecord = Record<string, EnvInfo>;

export declare interface Environment extends ContentNode {
    type: "environment" | "mathenv";
    env: string;
    args?: Argument[];
}

export declare interface EnvRenderInfo {
    /**
     * Whether the body of the environment should be treated as math mode
     *
     * @type {boolean}
     */
    inMathMode?: boolean;
    /**
     * Whether to align the environment contents based on `&` and `\\` delimiters
     * (like a matrix or tabular environment).
     *
     * @type {boolean}
     */
    alignContent?: boolean;
    /**
     * Whether the arguments should be treated as pgfkeys-type arguments.
     *
     * @type {boolean}
     */
    pgfkeysArgs?: boolean;
    /**
     * A list of names to be given to each argument when processing. This list should
     * be the same length as the number of arguments. `null` can appear any number of times
     * for "un-named" arguments.
     *
     * This allows a consistent reference to macro arguments even if the macro signatures are redefined between
     * packages.
     *
     * @type {((string|null)[])}
     */
    namedArguments?: (string | null)[];
    /**
     * Whether the body is tikz-environment like (e.g., a `tikzpicture` or `scope`, etc.)
     *
     * @type {boolean}
     */
    tikzEnvironment?: boolean;
}

export declare type GenericAst = GenericNode | GenericNode[];

export declare interface GenericNode {
    [x: string]: any;
    type: string;
    _renderInfo?: object;
}

export declare interface Group extends ContentNode {
    type: "group";
}

export declare interface InlineMath extends ContentNode {
    type: "inlinemath";
}

export declare interface Macro extends BaseNode {
    type: "macro";
    content: string;
    escapeToken?: string;
    args?: Argument[];
}

export declare type MacroInfo = {
    renderInfo?: MacroRenderInfo;
    /**
     * The macro signature as an xparse argument specification string.
     *
     * @type {string}
     */
    signature?: string;
    /**
     * Some special macros like `^` and `_` don't use
     * an escape token. When matching against these macros,
     * care must be taken to match the macro contents and the macro's
     * escape token.
     */
    escapeToken?: string;
    /**
     * Custom argument parser. If present, function overrides the default argument
     * parsing of `signature`. An array of nodes is passed as well as the position
     * of the first node **after** the macro. This function is expected to _mutate_
     * the input array, removing any nodes that are part of the macro's argument.
     *
     * This function will only be called on a macro if it has no existing `args`.
     *
     * Note: for stability when printing/accessing a node's arguments, this function
     * should always return an argument array of the same length, regardless of
     * whether optional arguments are present. For example, if this function parses
     * a node with signature `o m`, it should ways return a length-two array of arguments.
     * A "blank" argument (one that does not show up during printing) can be created
     * with `args([], { openMark: "", closeMark: "" })`, using the `unified-latex-builder` package.
     */
    argumentParser?: ArgumentParser;
};

export declare type MacroInfoRecord = Record<string, MacroInfo>;

export declare interface MacroRenderInfo {
    /**
     * Whether the macro's contents wraps along with the current
     * paragraph or displays as it's own block.
     *
     * @type {boolean}
     */
    inParMode?: boolean;
    /**
     * Whether the arguments should be processed as pgfkeys-type arguments.
     *
     * @type {boolean}
     */
    pgfkeysArgs?: boolean;
    /**
     * Whether there should be line breaks after the macro
     * (e.g., like the `\\` command.)
     *
     * @type {boolean}
     */
    breakAfter?: boolean;
    /**
     * Whether there should be line breaks before and after the macro
     * (e.g., like the `\section{...}` command.)
     *
     * @type {boolean}
     */
    breakAround?: boolean;
    /**
     * Whether there should be line breaks before the macro.
     *
     * @type {boolean}
     */
    breakBefore?: boolean;
    /**
     * Whether the contents of the macro should be assumed to be in math mode.
     *
     * @type {boolean}
     */
    inMathMode?: boolean;
    /**
     * Whether the arguments should be rendered with a hanging indent when the wrap
     * (like the arguments to \item in an enumerate environment.)
     *
     * @type {boolean}
     */
    hangingIndent?: boolean;
    /**
     * A list of names to be given to each argument when processing. This list should
     * be the same length as the number of arguments. `null` can appear any number of times
     * for "un-named" arguments.
     *
     * This allows a consistent reference to macro arguments even if the macro signatures are redefined between
     * packages.
     *
     * @type {((string|null)[])}
     */
    namedArguments?: (string | null)[];
    /**
     * Whether the macro represents a tikz path command (e.g. `\draw (0,0) -- (1,1);`).
     *
     * @type {boolean}
     */
    tikzPathCommand?: boolean;
    /**
     * If `\sysdelims` is present, this contains the global information about the delimiters.
     */
    sysdelims?: (Ast_2.Node[] | null)[];
}

declare type Node_2 = Root | String_2 | Whitespace | Parbreak | Comment_2 | Macro | Environment | VerbatimEnvironment | InlineMath | DisplayMath | Group | Verb;
export { Node_2 as Node }

export declare interface Parbreak extends BaseNode {
    type: "parbreak";
}

export declare interface Root extends ContentNode {
    type: "root";
}

declare interface String_2 extends BaseNode {
    type: "string";
    content: string;
}
export { String_2 as String }

/**
 * Generic type of a type-guard function.
 */
export declare interface TypeGuard<T> {
    (node: any): node is T;
}

export declare interface Verb extends BaseNode {
    type: "verb";
    env: string;
    escape: string;
    content: string;
}

export declare interface VerbatimEnvironment extends BaseNode {
    type: "verbatim";
    env: string;
    content: string;
}

export declare interface Whitespace extends BaseNode {
    type: "whitespace";
}

export { }
