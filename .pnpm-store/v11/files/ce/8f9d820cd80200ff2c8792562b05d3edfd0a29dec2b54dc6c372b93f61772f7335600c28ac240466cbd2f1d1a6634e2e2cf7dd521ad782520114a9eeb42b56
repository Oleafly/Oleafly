import * as LatexAst from "@unified-latex/unified-latex-types";
export type Ast = Node | Node[];
export type Node = PathSpecNode | PathSpec;
export type PathSpecNode = SquareBraceGroup | Coordinate | CurveTo | LineTo | Foreach | Operation | Unknown | Svg | Animation | LatexAst.Comment;
interface AstNode {
    type: string;
}
export interface PathSpec extends AstNode {
    type: "path_spec";
    content: PathSpecNode[];
}
export interface SquareBraceGroup extends AstNode {
    type: "square_brace_group";
    content: LatexAst.Node[];
}
export interface Coordinate extends AstNode {
    type: "coordinate";
    content: LatexAst.Node[];
    prefix: LatexAst.String[];
}
export interface CurveTo extends AstNode {
    type: "curve_to";
    controls: [Coordinate] | [Coordinate, Coordinate];
    comments: LatexAst.Comment[];
}
export interface LineTo extends AstNode {
    type: "line_to";
    command: "--" | "|-" | "-|";
}
export interface Svg extends AstNode {
    type: "svg_operation";
    options: null | LatexAst.Node[];
    content: LatexAst.Group;
    comments: LatexAst.Comment[];
}
export interface ForeachBody extends AstNode {
    type: "foreach_body";
    variables: LatexAst.Node[];
    options: null | LatexAst.Node[];
    list: LatexAst.Group | LatexAst.Macro;
    command: LatexAst.Group | LatexAst.Macro | Foreach;
    comments: LatexAst.Comment[];
}
export interface Foreach extends Omit<ForeachBody, "type"> {
    type: "foreach";
    start: LatexAst.String | LatexAst.Macro;
}
export interface Operation extends AstNode {
    type: "operation";
    content: LatexAst.String;
}
export interface Unknown extends AstNode {
    type: "unknown";
    content: LatexAst.Node;
}
export interface Animation extends AstNode {
    type: "animation";
    content: LatexAst.Node[];
    comments: LatexAst.Comment[];
    attribute: string;
}
export {};
//# sourceMappingURL=types.d.ts.map