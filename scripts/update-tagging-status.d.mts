export type TaggingStatusEntryRecord = Record<string, string>;

export interface TaggingStatusClassEntry {
  name: string;
  status: string;
  note?: string;
  updated?: string;
}

export interface TaggingStatusCatalog {
  source: string;
  raw: string;
  retrieved: string;
  license: string;
  counts: Record<string, number>;
  classes: TaggingStatusClassEntry[];
  packages: Record<string, string[]>;
}

export declare const KEPT_STATUSES: string[];
export declare const ALLOWED_TYPES: string[];
export declare function parseTaggingStatusYaml(text: string): TaggingStatusEntryRecord[];
export declare function validateEntries(entries: TaggingStatusEntryRecord[]): TaggingStatusEntryRecord[];
export declare function buildCatalog(
  entries: TaggingStatusEntryRecord[],
  retrieved: string,
): TaggingStatusCatalog;
export declare function validateCatalog(
  catalog: TaggingStatusCatalog,
  entries: TaggingStatusEntryRecord[],
): TaggingStatusCatalog;
export declare function serializeCatalog(catalog: TaggingStatusCatalog): string;
