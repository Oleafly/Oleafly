import * as Ast from '@unified-latex/unified-latex-types';

declare type Action = typeof CONTINUE | typeof SKIP | typeof EXIT;

declare type ActionTuple = [Action] | [typeof SKIP, Index] | [typeof CONTINUE, Index];

/**
 * Continue traversing as normal
 */
export declare const CONTINUE: unique symbol;

/**
 * Stop traversing immediately
 */
export declare const EXIT: unique symbol;

declare type GetGuard<T> = T extends (x: any, ...y: any[]) => x is infer R ? R : never;

/**
 * Extracts the guard type from the `test` function provided in a
 * `VisitOptions` argument.
 */
declare type GuardFromOptions<Opts extends VisitOptions, PossibleTypes = Ast.Ast> = Opts extends {
    test: infer R;
} ? R extends (x: any, ...y: any[]) => boolean ? Extract<PossibleTypes, GuardTypeOf<R>> : PossibleTypes : PossibleTypes;

/**
 * Gets the type that a type-guard function is guarding. If
 * the guard type cannot be determined, the input type is returned.
 */
declare type GuardTypeOf<T extends (x: any, ...y: any[]) => boolean> = GetGuard<T> extends never ? T extends (x: infer A) => any ? A : never : GetGuard<T>;

declare type Index = number;

/**
 * Narrow the type `T` based on the `VisitOptions` supplied. If `{includeArrays: false}`
 * is specified in the `VisitOptions`, then arrays are excluded from `T`.
 */
declare type NarrowArraysBasedOnOptions<T, Opts extends VisitOptions> = Opts extends {
    includeArrays: infer A;
} ? A extends true ? T : Exclude<T, any[]> : Exclude<T, any[]>;

/**
 * Do not traverse this node’s children
 */
export declare const SKIP: unique symbol;

/**
 * Visit children of tree which pass a test
 *
 * @param {Node} tree Abstract syntax tree to walk
 * @param {Visitor|Visitors} [visitor] Function to run for each node
 */
export declare function visit<Opts extends VisitOptions>(tree: Ast.Ast, visitor: Visitor<VisitorTypeFromOptions<Opts>> | Visitors<VisitorTypeFromOptions<Opts>>, options?: Opts): void;

export declare type VisitInfo = {
    /**
     * If the element was accessed via an attribute, the attribute key is specified.
     */
    readonly key: string | undefined;
    /**
     * If the element was accessed in an array, the index is specified.
     */
    readonly index: number | undefined;
    /**
     * A list of ancestor nodes, `[parent, grandparent, great-grandparent, ...]`
     */
    readonly parents: (Ast.Node | Ast.Argument)[];
    /**
     * If the element was accessed in an array, the array that it is part of.
     */
    readonly containingArray: (Ast.Node | Ast.Argument)[] | undefined;
    /**
     * The LaTeX context of the current match.
     */
    readonly context: VisitorContext;
};

declare type VisitOptions = {
    startingContext?: VisitorContext;
    /**
     * Type guard for types that are passed to the `visitor` function.
     */
    test?: (node: Ast.Ast, info: VisitInfo) => boolean;
    /**
     * Whether arrays will be sent to the `visitor` function. If falsy,
     * only nodes will be past to `visitor`.
     */
    includeArrays?: boolean;
};

/**
 * A visitor takes a `node`, `key`, `index`, and ...
 *
 * @param key - The key of the parent that we were accessed through.
 */
declare type Visitor<T> = (node: T, info: VisitInfo) => null | undefined | Action | Index | ActionTuple | void;

export declare type VisitorContext = {
    /**
     * Whether the node is being processed in math mode.
     *
     * This happens when the node is a director or indirect child
     * of a math environment (e.g. `$abc$`), but not when an environment
     * re-establishes text mode (e.g. `$\text{abc}$`)
     */
    inMathMode?: boolean;
    /**
     * Whether the node has any ancestor that is processed in math mode.
     */
    hasMathModeAncestor?: boolean;
};

declare type Visitors<T> = {
    enter?: Visitor<T>;
    leave?: Visitor<T>;
};

/**
 * Get the type of the parameter to the `Visitor` function based on the
 * `VisitOptions` that are supplied.
 */
declare type VisitorTypeFromOptions<Opts extends VisitOptions> = NarrowArraysBasedOnOptions<GuardFromOptions<Opts>, Opts>;

export { }
