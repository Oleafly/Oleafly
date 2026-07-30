type DeepMergeFn = <T1, T2>(target: T1, source: T2) => DeepMerge<T1, T2>
type DeepMergeAllFn = <T extends Array<any>>(...targets: T) => DeepMergeAll<{}, T>

/**
 * Merge function that preserves required properties from target when source may have undefined.
 * Used when onlyDefinedProperties: true - undefined values in source don't override target.
 */
type DeepMergeDefinedFn = <T1, T2>(target: T1, source: T2) => DeepMergeDefined<T1, T2>
type DeepMergeAllDefinedFn = <T extends Array<any>>(...targets: T) => DeepMergeAllDefined<{}, T>

type Primitive =
  | null
  | undefined
  | string
  | number
  | boolean
  | symbol
  | bigint

type BuiltIns = Primitive | Date | RegExp

type MergeArrays<T, U> = T extends readonly any[]
  ? U extends readonly any[]
    ? [...T, ...U]
    : never
  : never

type DifferenceKeys<
  T,
  U,
  T0 = Omit<T, keyof U> & Omit<U, keyof T>,
  T1 = { [K in keyof T0]: T0[K] }
  > = T1

type IntersectionKeys<T, U> = Omit<T | U, keyof DifferenceKeys<T, U>>

type DeepMergeHelper<
  T,
  U,
  T0 = DifferenceKeys<T, U>
  & { [K in keyof IntersectionKeys<T, U>]: DeepMerge<K extends keyof T ? T[K] : never, K extends keyof U ? U[K] : never> },
  T1 = { [K in keyof T0]: T0[K] }
  > = T1

type DeepMerge<T, U> =
  U extends BuiltIns
    ? U
    : [T, U] extends [readonly any[], readonly any[]]
        ? MergeArrays<T, U>
        : [T, U] extends [{ [key: string]: unknown }, { [key: string]: unknown }]
            ? DeepMergeHelper<T, U>
            : U

/**
 * For onlyDefinedProperties: true mode.
 * When merging, if source value could be undefined, preserve target's type.
 * This ensures that merging Partial<T> into T returns T, not Partial<T>.
 */
type ExcludeUndefined<T> = T extends undefined ? never : T

/**
 * Check if a type is a mergeable object (not array, not primitive, not builtin, not function)
 * Using 'object' check which works with Partial types (unlike index signatures)
 */
type IsMergeableObject<T> = T extends BuiltIns
  ? false
  : T extends readonly any[]
    ? false
    : T extends (...args: any[]) => any
      ? false
      : T extends object
        ? true
        : false

/**
 * Get keys that exist in both T and U
 */
type CommonKeys<T, U> = keyof T & keyof U

/**
 * Get keys only in T (not in U)
 */
type OnlyTKeys<T, U> = Exclude<keyof T, keyof U>

/**
 * Get keys only in U (not in T)
 */
type OnlyUKeys<T, U> = Exclude<keyof U, keyof T>

/**
 * Merge a single property with onlyDefinedProperties semantics:
 * - If source could be undefined, recursively merge but preserve target's definedness
 * - If source cannot be undefined, normal merge applies
 */
type DeepMergeDefinedProperty<T, U> =
  // If U could be undefined
  [undefined] extends [U]
    // Both T and ExcludeUndefined<U> are mergeable objects - merge them
    ? [IsMergeableObject<T>, IsMergeableObject<ExcludeUndefined<U>>] extends [true, true]
        ? DeepMergeDefinedHelper<T, ExcludeUndefined<U>>
      // Otherwise use target's type (preserving non-undefined)
        : T
    // U cannot be undefined - normal deep merge
    : DeepMergeDefined<T, U>

/**
 * Helper for onlyDefinedProperties mode.
 * For intersection keys: preserve required-ness from target when source may be undefined.
 */
type DeepMergeDefinedHelper<T, U> = {
  // Keys only in T: preserve from target
  [K in OnlyTKeys<T, U>]: T[K]
} & {
  // Keys in both: merge with defined-property semantics
  [K in CommonKeys<T, U>]: DeepMergeDefinedProperty<T[K], U[K]>
} & {
  // Keys only in U: include only if not potentially undefined
  [K in OnlyUKeys<T, U> as [undefined] extends [U[K]] ? never : K]: U[K]
} extends infer O ? { [K in keyof O]: O[K] } : never

type DeepMergeDefined<T, U> =
  U extends BuiltIns
    ? [undefined] extends [U]
        ? [undefined] extends [T] ? T : ExcludeUndefined<U> | T
        : U
    : [T, U] extends [readonly any[], readonly any[]]
        ? MergeArrays<T, U>
        : [IsMergeableObject<T>, IsMergeableObject<U>] extends [true, true]
            ? DeepMergeDefinedHelper<T, U>
            : [undefined] extends [U]
                ? [undefined] extends [T] ? T : ExcludeUndefined<U> | T
                : U

type DeepMergeAllDefined<R, T> = First<T> extends never
  ? R
  : DeepMergeAllDefined<DeepMergeDefined<R, First<T>>, Rest<T>>

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type First<T> = T extends [infer _I, ...infer _Rest] ? _I : never

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type Rest<T> = T extends [infer _I, ...infer _Rest] ? _Rest : never

type DeepMergeAll<R, T> = First<T> extends never
  ? R
  : DeepMergeAll<DeepMerge<R, First<T>>, Rest<T>>

type MergeArrayFnOptions = {
  clone: (value: any) => any;
  isMergeableObject: (value: any) => boolean;
  deepmerge: DeepMergeFn;
  getKeys: (value: object) => string[];
}

/**
 * A function responsible handling the cloning logic of the provided prototype object.
 *
 * @param value - The proto object to clone.
 * @returns the resulting clone (can also return the object itself if you do not want clone but replace).
 */
type CloneProtoObjectFn = (value: any) => any

type MergeArrayFn = (options: MergeArrayFnOptions) => (target: any[], source: any[]) => any[]

interface Options {
  cloneProtoObject?: CloneProtoObjectFn;
  mergeArray?: MergeArrayFn;
  isMergeableObject?: (value: any) => boolean;
  symbols?: boolean;
  all?: boolean;
  /**
   * If true, ignore undefined values from source and keep existing target values.
   * Defaults to false.
   */
  onlyDefinedProperties?: boolean;
}

type DeepmergeConstructor = typeof deepmerge

declare namespace deepmerge {
  export { Options, DeepMergeFn, DeepMergeAllFn, DeepMergeDefinedFn, DeepMergeAllDefinedFn }
  export const deepmerge: DeepmergeConstructor
  export { deepmerge as default }

  export const isMergeableObject: (value: any) => boolean
}

declare function deepmerge (options: Options & { all: true; onlyDefinedProperties: true }): DeepMergeAllDefinedFn

declare function deepmerge (options: Options & { onlyDefinedProperties: true }): DeepMergeDefinedFn

declare function deepmerge (options: Options & { all: true }): DeepMergeAllFn

declare function deepmerge (options?: Options): DeepMergeFn

export = deepmerge
