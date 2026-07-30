import { Mark } from '@tiptap/core';

interface ItalicOptions {
    /**
     * HTML attributes to add to the italic element.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        italic: {
            /**
             * Set an italic mark
             * @example editor.commands.setItalic()
             */
            setItalic: () => ReturnType;
            /**
             * Toggle an italic mark
             * @example editor.commands.toggleItalic()
             */
            toggleItalic: () => ReturnType;
            /**
             * Unset an italic mark
             * @example editor.commands.unsetItalic()
             */
            unsetItalic: () => ReturnType;
        };
    }
}
/**
 * Matches an italic to a *italic* on input.
 */
declare const starInputRegex: RegExp;
/**
 * Matches an italic to a *italic* on paste.
 */
declare const starPasteRegex: RegExp;
/**
 * Matches an italic to a _italic_ on input.
 */
declare const underscoreInputRegex: RegExp;
/**
 * Matches an italic to a _italic_ on paste.
 */
declare const underscorePasteRegex: RegExp;
/**
 * This extension allows you to create italic text.
 * @see https://www.tiptap.dev/api/marks/italic
 */
declare const Italic: Mark<ItalicOptions, any>;

export { Italic, type ItalicOptions, Italic as default, starInputRegex, starPasteRegex, underscoreInputRegex, underscorePasteRegex };
