type Attributes = Record<string, any>;
type DOMOutputSpecElement = 0 | Attributes | DOMOutputSpecArray;
/**
 * Better describes the output of a `renderHTML` function in prosemirror
 * @see https://prosemirror.net/docs/ref/#model.DOMOutputSpec
 */
type DOMOutputSpecArray = [string] | [string, Attributes] | [string, 0] | [string, Attributes, 0] | [string, Attributes, DOMOutputSpecArray | 0] | [string, DOMOutputSpecArray];
declare namespace JSX {
    type Element = DOMOutputSpecArray;
    interface IntrinsicElements {
        [key: string]: any;
    }
    interface ElementChildrenAttribute {
        children: unknown;
    }
}
type JSXRenderer = (tag: 'slot' | string | ((props?: Attributes) => DOMOutputSpecArray | DOMOutputSpecElement), props?: Attributes, ...children: JSXRenderer[]) => DOMOutputSpecArray | DOMOutputSpecElement;
declare function Fragment(props: {
    children: JSXRenderer[];
}): JSXRenderer[];
declare const h: JSXRenderer;

export { type Attributes, type DOMOutputSpecArray, type DOMOutputSpecElement, Fragment, JSX, type JSXRenderer, h as createElement, h, h as jsx, h as jsxDEV, h as jsxs };
