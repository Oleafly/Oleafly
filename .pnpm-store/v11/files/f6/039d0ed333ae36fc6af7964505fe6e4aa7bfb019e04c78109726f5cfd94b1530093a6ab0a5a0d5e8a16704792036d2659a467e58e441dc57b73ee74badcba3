import * as LatexAst from "@unified-latex/unified-latex-types";
export type Ast = Node | Node[];
export type Node = Column | BasicAlignment | ParboxAlignment | Code | Divider;
export type TabularColumn = Column;
interface AstNode {
    type: string;
}
interface Column extends AstNode {
    type: "column";
    pre_dividers: Divider[];
    post_dividers: Divider[];
    before_start_code: Code | null;
    before_end_code: Code | null;
    alignment: BasicAlignment | ParboxAlignment;
}
interface BasicAlignment extends AstNode {
    type: "alignment";
    alignment: "left" | "right" | "center" | "X";
}
interface ParboxAlignment extends AstNode {
    type: "alignment";
    alignment: "parbox";
    baseline: LatexAst.Node[] | "top" | "default" | "bottom";
    size: LatexAst.Node[];
}
interface Code extends AstNode {
    type: "decl_code";
    code: LatexAst.Node[];
}
type Divider = {
    type: "vert_divider";
} | {
    type: "bang_divider";
    content: LatexAst.Node[];
} | {
    type: "at_divider";
    content: LatexAst.Node[];
};
export {};
//# sourceMappingURL=types.d.ts.map