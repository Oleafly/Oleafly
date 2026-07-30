//#region ../../node_modules/.pnpm/@types+unist@3.0.3/node_modules/@types/unist/index.d.ts
// ## Interfaces
/**
 * Info associated with nodes by the ecosystem.
 *
 * This space is guaranteed to never be specified by unist or specifications
 * implementing unist.
 * But you can use it in utilities and plugins to store data.
 *
 * This type can be augmented to register custom data.
 * For example:
 *
 * ```ts
 * declare module 'unist' {
 *   interface Data {
 *     // `someNode.data.myId` is typed as `number | undefined`
 *     myId?: number | undefined
 *   }
 * }
 * ```
 */
interface Data {}
/**
 * One place in a source file.
 */
interface Point {
  /**
   * Line in a source file (1-indexed integer).
   */
  line: number;
  /**
   * Column in a source file (1-indexed integer).
   */
  column: number;
  /**
   * Character in a source file (0-indexed integer).
   */
  offset?: number | undefined;
}
/**
 * Position of a node in a source document.
 *
 * A position is a range between two points.
 */
interface Position {
  /**
   * Place of the first character of the parsed source region.
   */
  start: Point;
  /**
   * Place of the first character after the parsed source region.
   */
  end: Point;
}
/**
 * Abstract unist node.
 *
 * The syntactic unit in unist syntax trees are called nodes.
 *
 * This interface is supposed to be extended.
 * If you can use {@link Literal} or {@link Parent}, you should.
 * But for example in markdown, a `thematicBreak` (`***`), is neither literal
 * nor parent, but still a node.
 */
interface Node {
  /**
   * Node type.
   */
  type: string;
  /**
   * Info from the ecosystem.
   */
  data?: Data | undefined;
  /**
   * Position of a node in a source document.
   *
   * Nodes that are generated (not in the original source document) must not
   * have a position.
   */
  position?: Position | undefined;
}
//#endregion
export { Data, Node, Point, Position };
//# sourceMappingURL=index.d.ts.map