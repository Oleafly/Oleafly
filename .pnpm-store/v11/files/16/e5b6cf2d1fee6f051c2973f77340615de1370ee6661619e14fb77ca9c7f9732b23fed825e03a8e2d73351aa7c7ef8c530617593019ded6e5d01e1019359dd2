/** A version of the Harper WebAssembly binary stored inline as a data URL. */
export declare const binaryInlined: BinaryModuleImpl;

/** A wrapper around the underlying WebAssembly module that contains Harper's core code. Used to construct a `Linter`, as well as access some miscellaneous other functions. */
declare class BinaryModuleImpl {
    url: string | URL;
    glueFlavor: WasmGlueFlavor;
    private inner;
    /** Load a binary from a specified URL. This is the only recommended way to construct this type. */
    static create(url: string | URL, glueFlavor?: WasmGlueFlavor): BinaryModuleImpl;
    getDefaultLintConfigAsJSON(): Promise<string>;
    getDefaultLintConfig(): Promise<LintConfig>;
    toTitleCase(text: string): Promise<string>;
    setup(): Promise<void>;
}

/** A linting rule configuration dependent on upstream Harper's available rules.
 * This is a record, since you shouldn't hard-code the existence of any particular rules and should generalize based on this struct. */
declare type LintConfig = Record<string, boolean | null>;

declare type WasmGlueFlavor = 'full' | 'slim';

export { }
