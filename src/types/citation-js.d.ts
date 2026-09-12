declare module "@citation-js/core" {
  export interface CitationData {
    id?: string;
    type?: string;
    title?: string;
    author?: Array<{ family?: string; given?: string; literal?: string }>;
    issued?: { "date-parts"?: Array<Array<number | string>> };
    [key: string]: unknown;
  }

  export class Cite {
    constructor(data?: unknown, options?: Record<string, unknown>);
    data: CitationData[];
    format(
      kind: "bibliography" | "citation" | "bibtex",
      options?: Record<string, unknown>,
    ): unknown;
  }

  export const plugins: {
    config: {
      get(name: string): {
        styles: {
          add(name: string, xml: string): unknown;
          has(name: string): boolean;
        };
      };
    };
  };
}

declare module "@citation-js/plugin-bibtex";
declare module "@citation-js/plugin-csl";

