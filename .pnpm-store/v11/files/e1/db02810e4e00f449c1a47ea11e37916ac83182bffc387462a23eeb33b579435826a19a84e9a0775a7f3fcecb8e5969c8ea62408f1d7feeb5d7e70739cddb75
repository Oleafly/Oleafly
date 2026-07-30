import { Mark } from '@tiptap/core';

/** @jsxImportSource @tiptap/core */

interface BoldOptions {
    /**
     * HTML attributes to add to the bold element.
     * @default {}
     * @example { class: 'foo' }
     */
    HTMLAttributes: Record<string, any>;
}
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        bold: {
            /**
             * Set a bold mark
             */
            setBold: () => ReturnType;
            /**
             * Toggle a bold mark
             */
            toggleBold: () => ReturnType;
            /**
             * Unset a bold mark
             */
            unsetBold: () => ReturnType;
        };
    }
}
/**
 * Matches bold text via `**` as input.
 */
declare const starInputRegex: RegExp;
/**
 * Matches bold text via `**` while pasting.
 */
declare const starPasteRegex: RegExp;
/**
 * Matches bold text via `__` as input.
 */
declare const underscoreInputRegex: RegExp;
/**
 * Matches bold text via `__` while pasting.
 */
declare const underscorePasteRegex: RegExp;
/**
 * This extension allows you to mark text as bold.
 * @see https://tiptap.dev/api/marks/bold
 */
declare const Bold: Mark<BoldOptions, any>;

export { Bold, type BoldOptions, Bold as default, starInputRegex, starPasteRegex, underscoreInputRegex, underscorePasteRegex };
