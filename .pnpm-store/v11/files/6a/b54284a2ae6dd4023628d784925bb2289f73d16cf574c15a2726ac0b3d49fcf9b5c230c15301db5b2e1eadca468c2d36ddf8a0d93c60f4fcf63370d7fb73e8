import * as LatexAst from "@unified-latex/unified-latex-types";
export type Ast = Node | Node[];
export type Node = Line | Equation | Item | Annotation;
export type SystemeNode = Node;
interface AstNode {
    type: string;
}
export interface Line extends AstNode {
    type: "line";
    equation?: Equation | null;
    annotation?: Annotation | null;
    sep?: LatexAst.Node[] | null;
    trailingComment: LatexAst.Comment | null;
}
interface Equation extends AstNode {
    type: "equation";
    left: Item[];
    right: LatexAst.Node[];
    equals?: LatexAst.Node | null;
}
export interface Item extends AstNode {
    type: "item";
    op: LatexAst.Node | null;
    variable: LatexAst.Node[] | null;
    content: LatexAst.Node[];
}
interface Annotation extends AstNode {
    type: "annotation";
    marker: LatexAst.Node;
    content: LatexAst.Node[];
}
export {};
//# sourceMappingURL=types.d.ts.map