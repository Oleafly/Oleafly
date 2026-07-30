import { Node } from '@tiptap/core';

interface HorizontalRuleOptions {
    /**
     * The HTML attributes for a horizontal rule node.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
    /**
     * The default type to insert after the horizontal rule.
     * @default "paragraph"
     * @example "heading"
     */
    nextNodeType: string;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        horizontalRule: {
            /**
             * Add a horizontal rule
             * @example editor.commands.setHorizontalRule()
             */
            setHorizontalRule: () => ReturnType;
        };
    }
}
/**
 * This extension allows you to insert horizontal rules.
 * @see https://www.tiptap.dev/api/nodes/horizontal-rule
 */
declare const HorizontalRule: Node<HorizontalRuleOptions, any>;

export { HorizontalRule, type HorizontalRuleOptions, HorizontalRule as default };
