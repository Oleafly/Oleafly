'use strict'

// based on https://github.com/TehShrike/deepmerge
// MIT License
// Copyright (c) 2012 - 2022 James Halliday, Josh Duff, and other contributors of deepmerge

const JSON_PROTO = Object.getPrototypeOf({})

function defaultIsMergeableObjectFactory () {
  return function defaultIsMergeableObject (value) {
    return typeof value === 'object' && value !== null && !(value instanceof RegExp) && !(value instanceof Date)
  }
}

function deepmergeConstructor (options) {
  function isNotPrototypeKey (value) {
    return (
      value !== 'constructor' &&
      value !== 'prototype' &&
      value !== '__proto__'
    )
  }

  function cloneArray (value) {
    let i = 0
    const il = value.length
    const result = new Array(il)
    for (i; i < il; ++i) {
      result[i] = clone(value[i])
    }
    return result
  }

  function cloneObject (target) {
    const result = {}

    if (cloneProtoObject && Object.getPrototypeOf(target) !== JSON_PROTO) {
      return cloneProtoObject(target)
    }

    const targetKeys = getKeys(target)
    let i, il, key
    for (i = 0, il = targetKeys.length; i < il; ++i) {
      isNotPrototypeKey(key = targetKeys[i]) &&
        (result[key] = clone(target[key]))
    }
    return result
  }

  function concatArrays (target, source) {
    const tl = target.length
    const sl = source.length
    let i = 0
    const result = new Array(tl + sl)
    for (i; i < tl; ++i) {
      result[i] = clone(target[i])
    }
    for (i = 0; i < sl; ++i) {
      result[i + tl] = clone(source[i])
    }
    return result
  }

  const propertyIsEnumerable = Object.prototype.propertyIsEnumerable
  function getSymbolsAndKeys (value) {
    const result = Object.keys(value)
    const keys = Object.getOwnPropertySymbols(value)
    for (let i = 0, il = keys.length; i < il; ++i) {
      propertyIsEnumerable.call(value, keys[i]) && result.push(keys[i])
    }
    return result
  }

  const getKeys = options?.symbols
    ? getSymbolsAndKeys
    : Object.keys

  const cloneProtoObject = typeof options?.cloneProtoObject === 'function'
    ? options.cloneProtoObject
    : undefined

  const isMergeableObject = typeof options?.isMergeableObject === 'function'
    ? options.isMergeableObject
    : defaultIsMergeableObjectFactory()

  const onlyDefinedProperties = options?.onlyDefinedProperties === true

  function isPrimitive (value) {
    return typeof value !== 'object' || value === null
  }

  const mergeArray = options && typeof options.mergeArray === 'function'
    ? options.mergeArray({ clone, deepmerge: _deepmerge, getKeys, isMergeableObject })
    : concatArrays

  function clone (entry) {
    return isMergeableObject(entry)
      ? Array.isArray(entry)
        ? cloneArray(entry)
        : cloneObject(entry)
      : entry
  }

  function mergeObject (target, source) {
    const result = {}
    const targetKeys = getKeys(target)
    const sourceKeys = getKeys(source)
    let i, il, key
    for (i = 0, il = targetKeys.length; i < il; ++i) {
      isNotPrototypeKey(key = targetKeys[i]) &&
      (sourceKeys.indexOf(key) === -1) &&
      (result[key] = clone(target[key]))
    }

    for (i = 0, il = sourceKeys.length; i < il; ++i) {
      if (!isNotPrototypeKey(key = sourceKeys[i])) {
        continue
      }

      if (key in target) {
        if (targetKeys.indexOf(key) !== -1) {
          if (cloneProtoObject && isMergeableObject(source[key]) && Object.getPrototypeOf(source[key]) !== JSON_PROTO) {
            result[key] = cloneProtoObject(source[key])
          } else {
            result[key] = _deepmerge(target[key], source[key])
          }
        }
      } else {
        if (onlyDefinedProperties && typeof source[key] === 'undefined') {
          continue
        }
        result[key] = clone(source[key])
      }
    }
    return result
  }

  function _deepmerge (target, source) {
    if (onlyDefinedProperties && typeof source === 'undefined') {
      return clone(target)
    }

    const sourceIsArray = Array.isArray(source)
    const targetIsArray = Array.isArray(target)

    if (isPrimitive(source)) {
      return source
    } else if (!isMergeableObject(target)) {
      return clone(source)
    } else if (sourceIsArray && targetIsArray) {
      return mergeArray(target, source)
    } else if (sourceIsArray !== targetIsArray) {
      return clone(source)
    } else {
      return mergeObject(target, source)
    }
  }

  function _deepmergeAll () {
    switch (arguments.length) {
      case 0:
        return {}
      case 1:
        return clone(arguments[0])
      case 2:
        return _deepmerge(arguments[0], arguments[1])
    }
    let result
    for (let i = 0, il = arguments.length; i < il; ++i) {
      result = _deepmerge(result, arguments[i])
    }
    return result
  }

  return options?.all
    ? _deepmergeAll
    : _deepmerge
}

module.exports = deepmergeConstructor
module.exports.default = deepmergeConstructor
module.exports.deepmerge = deepmergeConstructor

Object.defineProperty(module.exports, 'isMergeableObject', {
  get: defaultIsMergeableObjectFactory
})
