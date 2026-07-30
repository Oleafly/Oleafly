# @fastify/deepmerge

[![CI](https://github.com/fastify/deepmerge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fastify/deepmerge/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/@fastify/deepmerge.svg?style=flat)](https://www.npmjs.com/package/@fastify/deepmerge)
[![neostandard javascript style](https://img.shields.io/badge/code_style-neostandard-brightgreen?style=flat)](https://github.com/neostandard/neostandard)

Merges the enumerable properties of two or more objects deeply. Fastest implementation of deepmerge, see section 'Benchmarks'.

### Install
```
npm i @fastify/deepmerge
```

### Usage

The module exports a function, which provides a function to deepmerge Objects.

`@fastify/deepmerge` does not mutate the input objects. It returns a new object, which is the result of the merge.

```
deepmerge(options)
```

`options` is optional and can contain the following values:

- `symbols` (`boolean`, optional) - should also merge object keys that are symbols, default is false
- `all` (`boolean`, optional) - makes deepmerge accept and merge any number of passed objects, default is false
- `mergeArray` (`function`, optional) - provide a function, which returns a function to add custom array merging function
- `cloneProtoObject` (`function`, optional) - provide a function, which must return a clone of the object with the prototype of the object
- `isMergeableObject` (`function`, optional) - provide a function, which must return true if the object should be merged, default is `isMergeableObject` from this module
- `onlyDefinedProperties` (`boolean`, optional) - if `true`, properties with `undefined` in the source will not overwrite existing values from the target, default is `false`

```js
const deepmerge = require('@fastify/deepmerge')()
const result = deepmerge({a: 'value'}, { b: 404 })
console.log(result) // {a: 'value',  b: 404 }
```

```js
const deepmerge = require('@fastify/deepmerge')({ all: true })
const result = deepmerge({a: 'value'}, { b: 404 }, { a: 404 })
console.log(result) // {a: 404,  b: 404 }
```

Example with `onlyDefinedProperties` option:

```js
const deepmerge = require('@fastify/deepmerge')({ onlyDefinedProperties: true })
const result = deepmerge({ a: 1, b: null }, { a: undefined, b: undefined })
console.log(result) // { a: 1, b: null }
```

#### mergeArray

The default mode to merge Arrays is to concat the source-Array to the target-Array.

```js
const target = [1, 2, 3]
const source = [4, 5, 6]
const deepmerge = require('@fastify/deepmerge')()
const result = deepmerge(target, source)
console.log(result) // [1, 2, 3, 4, 5, 6]
```

To overwrite the default behavior regarding merging Arrays, you can provide a function to the
`mergeArray` option of the deepmerge-function. The function provided to `mergeArray`
gets an options-parameter passed, which is an Object containing the following keys and values.

```typescript
clone: (value: any) => any;
isMergeableObject: (value: any) => any;
deepmerge: DeepMergeFn;
getKeys: (value: object) => string[];
```

The `mergeArray`-Function needs to return the actual Array merging function, which accepts two parameters of type
Array, and returns a value.

Example 1: Replace the target-Array with a clone of the source-Array.

```js
function replaceByClonedSource(options) {
  const clone = options.clone
  return function (target, source) {
    return clone(source)
  }
}

const deepmerge = require('@fastify/deepmerge')({ mergeArray: replaceByClonedSource })
const result = deepmerge([1, 2, 3], [4, 5, 6])
console.log(result) // [4, 5, 6]
```

Example 2: Merge each element of the source-Array with the element at the same index-position of the target-Array.

```js
function deepmergeArray(options) {
  const deepmerge = options.deepmerge
  const clone = options.clone
  return function (target, source) {
    let i = 0
    const tl = target.length
    const sl = source.length
    const il = Math.max(target.length, source.length)
    const result = new Array(il)
    for (i = 0; i < il; ++i) {
      if (i < sl) {
        result[i] = deepmerge(target[i], source[i])
      } else {
        result[i] = clone(target[i])
      }
    }
    return result
  }
}

// default behavior
const deepmergeConcatArray = require('@fastify/deepmerge')()
const resultConcatArray = deepmergeConcatArray([{ a: [1, 2, 3 ]}], [{b: [4, 5, 6]}])
console.log(resultConcatArray) // [ { a: [ 1, 2, 3 ]}, { b: [ 4, 5, 6 ] } ]

// modified behavior
const deepmergeDeepmergeArray = require('@fastify/deepmerge')({ mergeArray: deepmergeArray })
const resultDeepmergedArray = deepmergeDeepmergeArray([{ a: [1, 2, 3 ]}], [{b: [4, 5, 6]}])
console.log(resultDeepmergedArray) // [ { a: [ 1, 2, 3 ], b: [ 4, 5, 6 ] } ]
```

#### cloneProtoObject

Merging objects with prototypes, such as Streams or Buffers, are not supported by default.
You can provide a custom function to let this module deal with the object that has a `prototype` _(JSON object excluded)_.

```js
function cloneByReference (source) {
  return source
}

const deepmergeByReference = require('@fastify/deepmerge')({
  cloneProtoObject: cloneByReference
})

const result = deepmergeByReference({}, { stream: process.stdout })
console.log(result) // { stream: <ref *1> WriteStream }
```

#### isMergeableObject

By default, `@fastify/deepmerge` merges all objects except native `Date` and `RegExp` objects. To exclude certain objects from being merged, you can provide a custom function to the `isMergeableObject` option.

The default function is exported by this module as `isMergeableObject`.

The following example shows how to extend the default function to exclude globally defined `FormData` objects from being identified as mergeable objects.

```js
const { isMergeableObject: defaultIsMergeableObject } = require('@fastify/deepmerge')


function customIsMergeableObject (source) {
  return defaultIsMergeableObject(source) && !(source instanceof FormData)
}

const deepmergeWithCustomMergeableObject = require('@fastify/deepmerge')({
  isMergeableObject: customIsMergeableObject
})
```

## Benchmarks

The benchmarks are available in the benchmark folder.

`npm run bench` - benchmark various use cases of deepmerge:
```
@fastify/deepmerge: merge regex with date x 1,256,523,040 ops/sec ±0.16% (92 runs sampled)
@fastify/deepmerge: merge object with a primitive x 1,256,082,915 ops/sec ±0.25% (97 runs sampled)
@fastify/deepmerge: merge two arrays containing strings x 25,392,605 ops/sec ±0.22% (97 runs sampled)
@fastify/deepmerge: two merge arrays containing objects x 1,655,426 ops/sec ±0.65% (96 runs sampled)
@fastify/deepmerge: merge two flat objects x 15,571,029 ops/sec ±0.45% (96 runs sampled)
@fastify/deepmerge: merge nested objects x 7,601,328 ops/sec ±0.31% (96 runs sampled)
```

`npm run bench:compare` - comparison of @fastify/deepmerge with other popular deepmerge implementation:
```
@fastify/deepmerge x 605,343 ops/sec ±0.87% (96 runs sampled)
deepmerge x 20,312 ops/sec ±1.06% (92 runs sampled)
merge-deep x 83,167 ops/sec ±1.30% (94 runs sampled)
ts-deepmerge x 175,977 ops/sec ±0.57% (96 runs sampled)
deepmerge-ts x 174,973 ops/sec ±0.44% (93 runs sampled)
lodash.merge x 89,213 ops/sec ±0.70% (98 runs sampled)
```

## License

Licensed under [MIT](./LICENSE).
