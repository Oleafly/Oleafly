type LinkMode = "protocol" | "text-only";

declare const isWordChar: (char: string) => boolean;
declare const isWithinCodeBlock: (text: string, position: number) => boolean;
declare const isWithinMathBlock: (text: string, position: number) => boolean;
declare const isWithinLinkOrImageUrl: (text: string, position: number) => boolean;

/**
 * Handler function that transforms text during streaming.
 */
interface RemendHandler {
    /** Handler function: takes text, returns modified text */
    handle: (text: string) => string;
    /** Unique identifier for this handler */
    name: string;
    /** Priority (lower runs first). Built-in priorities: 0-100. Default: 100 */
    priority?: number;
}
/**
 * Configuration options for the remend function.
 * Options default to `true` unless noted otherwise.
 * Set an option to `false` to disable that specific completion.
 */
interface RemendOptions {
    /** Complete bold formatting (e.g., `**text` → `**text**`) */
    bold?: boolean;
    /** Complete bold-italic formatting (e.g., `***text` → `***text***`) */
    boldItalic?: boolean;
    /** Escape > as comparison operators in list items (e.g., `- > 25` → `- \> 25`) */
    comparisonOperators?: boolean;
    /** Custom handlers to extend remend */
    handlers?: RemendHandler[];
    /** Strip incomplete HTML tags at end of streaming text (e.g., `text <custom` → `text`) */
    htmlTags?: boolean;
    /** Complete images (e.g., `![alt](url` → removed) */
    images?: boolean;
    /** Complete inline code formatting (e.g., `` `code `` → `` `code` ``) */
    inlineCode?: boolean;
    /**
     * Complete inline KaTeX math (e.g., `$equation` → `$equation$`).
     * Defaults to `false` — single `$` is ambiguous with currency symbols.
     */
    inlineKatex?: boolean;
    /** Complete italic formatting (e.g., `*text` → `*text*` or `_text` → `_text_`) */
    italic?: boolean;
    /** Complete block KaTeX math (e.g., `$$equation` → `$$equation$$`) */
    katex?: boolean;
    /**
     * How to handle incomplete links:
     * - `'protocol'`: Use `streamdown:incomplete-link` placeholder URL (default)
     * - `'text-only'`: Display only the link text without any link markup
     */
    linkMode?: "protocol" | "text-only";
    /** Complete links and images (e.g., `[text](url` → `[text](streamdown:incomplete-link)`) */
    links?: boolean;
    /** Handle incomplete setext headings to prevent misinterpretation */
    setextHeadings?: boolean;
    /** Escape single ~ between word characters to prevent false strikethrough (e.g., `20~25` → `20\~25`) */
    singleTilde?: boolean;
    /** Complete strikethrough formatting (e.g., `~~text` → `~~text~~`) */
    strikethrough?: boolean;
}
declare const remend: (text: string, options?: RemendOptions) => string;

export { type LinkMode, type RemendHandler, type RemendOptions, remend as default, isWithinCodeBlock, isWithinLinkOrImageUrl, isWithinMathBlock, isWordChar };
