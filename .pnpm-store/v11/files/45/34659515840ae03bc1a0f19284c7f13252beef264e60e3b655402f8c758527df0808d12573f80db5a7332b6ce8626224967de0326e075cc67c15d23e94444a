# @gilbarbara/types

[![npm version](https://badge.fury.io/js/%40gilbarbara%2Ftypes.svg)](https://badge.fury.io/js/%40gilbarbara%2Ftypes) [![CI](https://github.com/gilbarbara/types/actions/workflows/main.yml/badge.svg)](https://github.com/gilbarbara/types/actions/workflows/main.yml)

Reusable typescript typings.

## Setup

```sh
npm i @gilbarbara/types
```

For convenience, the `type-fest` package is re-exported.

## Types

### Aliases

```typescript
type NumberOrNull = number | null;
type StringOrNull = string | null;
type StringOrNumber = string | number;

type PlainObject<T = unknown> = Record<string, T>;

type GenericFunction<T = unknown> = (...arguments_: any[]) => T;
type VoidFunction = () => void;
```


### Common

```typescript
type AsyncStatus = 'IDLE' | 'PENDING' | 'SUCCESS' | 'ERROR';

interface AsyncFlow {
  message: string;
  status: AsyncStatus;
}

interface AsyncFlowWithCache extends AsyncFlow {
  updatedAt: number;
}

interface AsyncFlowWithData<T = any> extends AsyncFlow {
  data: T;
}

interface AsyncFlowWithDataAndCache<T = any> extends AsyncFlowWithData<T> {
  updatedAt: number;
}

type HttpMethods =
  | 'CONNECT'
  | 'DELETE'
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'PATCH'
  | 'POST'
  | 'PUT';

interface IdName {
  id: string;
  name: string;
}

interface LabelValue {
  label: string;
  value: string;
}
```

### Utilities

```typescript
/**
 * Narrow down a Record to a plain object.
 */
type NarrowPlainObject<T extends Record<string, any>> = Exclude<
  T,
  Array<unknown> | Function | Map<unknown, unknown> | Set<unknown>
>;
```

```typescript
/**
 * An object without excluded types.
 */
type RemoveType<TObject, TExclude = undefined> = {
  [Key in keyof TObject as TObject[Key] extends TExclude ? never : Key]: TObject[Key];
};
```

```typescript
/**
 * A strict plain object with a specific set of keys.
 */
type StrictObject<TObject extends Record<PropertyKey, unknown>, TExpected> = TExpected & {
  [Key in keyof TObject]: Key extends keyof TExpected ? TExpected[Key] : never;
};
```

