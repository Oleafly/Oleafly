import { Node } from '@tiptap/core';

interface ParagraphOptions {
    /**
     * The HTML attributes for a paragraph node.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        paragraph: {
            /**
             * Toggle a paragraph
             * @example editor.commands.toggleParagraph()
             */
            setParagraph: () => ReturnType;
        };
    }
}
/**
 * This extension allows you to create paragraphs.
 * @see https://www.tiptap.dev/api/nodes/paragraph
 */
declare const Paragraph: Node<ParagraphOptions, any>;

export { Paragraph, type ParagraphOptions, Paragraph as default };
