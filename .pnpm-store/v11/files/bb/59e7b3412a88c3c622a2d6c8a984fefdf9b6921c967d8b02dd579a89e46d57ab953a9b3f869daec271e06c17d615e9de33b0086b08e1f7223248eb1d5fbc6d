declare interface Arg extends AstNode {
    openBrace: string;
    closeBrace: string;
}

declare namespace ArgSpecAst {
    export {
        Ast,
        Node_2 as Node,
        LeadingWhitespace,
        DefaultArgument,
        DefaultArguments,
        Embellishment,
        Group
    }
}
export { ArgSpecAst }

declare type Ast = Node_2[] | Node_2;

declare interface AstNode {
    type: string;
}

declare interface Body_2 extends AstNode {
    type: "body";
}

declare interface DefaultArgument {
    defaultArg?: string;
}

declare interface DefaultArguments {
    defaultArg?: string[];
}

declare interface Embellishment extends DefaultArguments, AstNode {
    type: "embellishment";
    embellishmentTokens: string[];
}

declare interface Group extends AstNode {
    type: "group";
    content: (Group | string)[];
}

declare interface LeadingWhitespace {
    noLeadingWhitespace: boolean | undefined;
}

declare interface Mandatory extends LeadingWhitespace, DefaultArgument, Arg {
    type: "mandatory";
}

declare type Node_2 = Optional | Mandatory | Verbatim | Body_2 | Group | Until;

declare type Optional = OptionalArg | OptionalStar | OptionalToken | Embellishment;

declare interface OptionalArg extends LeadingWhitespace, DefaultArgument, Arg {
    type: "optional";
}

declare interface OptionalStar extends LeadingWhitespace, AstNode {
    type: "optionalStar";
}

declare interface OptionalToken extends LeadingWhitespace, AstNode {
    type: "optionalToken";
    token: string;
}

/**
 * Parse an `xparse` argument specification string to an AST.
 * This function caches results. Don't mutate the returned AST!
 *
 * @param {string} [str=""] - LaTeX string input
 * @returns - AST for LaTeX string
 */
export declare function parse(str?: string): ArgSpecAst.Node[];

/**
 * Print an `xparse` argument specification AST
 * to a string.
 */
export declare function printRaw(node: ArgSpecAst.Node | string | (ArgSpecAst.Node | string)[], root?: boolean): string;

declare interface Until extends AstNode {
    type: "until";
    stopTokens: string[];
}

declare interface Verbatim extends Arg {
    type: "verbatim";
}

export { }
