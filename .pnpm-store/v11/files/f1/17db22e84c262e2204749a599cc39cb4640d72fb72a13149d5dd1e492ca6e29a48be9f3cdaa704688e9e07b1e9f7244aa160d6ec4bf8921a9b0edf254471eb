"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AsyncValidationError = void 0;
exports.asyncMap = asyncMap;
exports.complementError = complementError;
exports.convertFieldsError = convertFieldsError;
exports.deepMerge = deepMerge;
exports.format = format;
exports.isEmptyObject = isEmptyObject;
exports.isEmptyValue = isEmptyValue;
exports.warning = void 0;
/* eslint no-console:0 */

const formatRegExp = /%[sdj%]/g;
let warning = () => {};

// don't print warning message when in production env or node runtime
exports.warning = warning;
if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && typeof document !== 'undefined') {
  exports.warning = warning = (type, errors) => {
    if (typeof console !== 'undefined' && console.warn && typeof ASYNC_VALIDATOR_NO_WARNING === 'undefined') {
      if (errors.every(e => typeof e === 'string')) {
        console.warn(type, errors);
      }
    }
  };
}
function convertFieldsError(errors) {
  if (!errors || !errors.length) return null;
  const fields = {};
  errors.forEach(error => {
    const field = error.field;
    fields[field] = fields[field] || [];
    fields[field].push(error);
  });
  return fields;
}
function format(template, ...args) {
  let i = 0;
  const len = args.length;
  if (typeof template === 'function') {
    // eslint-disable-next-line prefer-spread
    return template.apply(null, args);
  }
  if (typeof template === 'string') {
    const str = template.replace(formatRegExp, x => {
      if (x === '%%') {
        return '%';
      }
      if (i >= len) {
        return x;
      }
      switch (x) {
        case '%s':
          return String(args[i++]);
        case '%d':
          return Number(args[i++]);
        case '%j':
          try {
            return JSON.stringify(args[i++]);
          } catch (_) {
            return '[Circular]';
          }
          break;
        default:
          return x;
      }
    });
    return str;
  }
  return template;
}
function isNativeStringType(type) {
  return type === 'string' || type === 'url' || type === 'hex' || type === 'email' || type === 'date' || type === 'pattern' || type === 'tel';
}
function isEmptyValue(value, type) {
  if (value === undefined || value === null) {
    return true;
  }
  if (type === 'array' && Array.isArray(value) && !value.length) {
    return true;
  }
  if (isNativeStringType(type) && typeof value === 'string' && !value) {
    return true;
  }
  return false;
}
function isEmptyObject(obj) {
  return Object.keys(obj).length === 0;
}
function asyncParallelArray(arr, func, callback) {
  const results = [];
  let total = 0;
  const arrLength = arr.length;
  function count(errors) {
    results.push(...(errors || []));
    total++;
    if (total === arrLength) {
      callback(results);
    }
  }
  arr.forEach(a => {
    func(a, count);
  });
}
function asyncSerialArray(arr, func, callback) {
  let index = 0;
  const arrLength = arr.length;
  function next(errors) {
    if (errors && errors.length) {
      callback(errors);
      return;
    }
    const original = index;
    index = index + 1;
    if (original < arrLength) {
      func(arr[original], next);
    } else {
      callback([]);
    }
  }
  next([]);
}
function flattenObjArr(objArr) {
  const ret = [];
  Object.keys(objArr).forEach(k => {
    ret.push(...(objArr[k] || []));
  });
  return ret;
}
class AsyncValidationError extends Error {
  errors;
  fields;
  constructor(errors, fields) {
    super('Async Validation Error');
    this.errors = errors;
    this.fields = fields;
  }
}
exports.AsyncValidationError = AsyncValidationError;
function asyncMap(objArr, option, func, callback, source) {
  if (option.first) {
    const pending = new Promise((resolve, reject) => {
      const next = errors => {
        callback(errors);
        return errors.length ? reject(new AsyncValidationError(errors, convertFieldsError(errors))) : resolve(source);
      };
      const flattenArr = flattenObjArr(objArr);
      asyncSerialArray(flattenArr, func, next);
    });
    pending.catch(e => e);
    return pending;
  }
  const firstFields = option.firstFields === true ? Object.keys(objArr) : option.firstFields || [];
  const objArrKeys = Object.keys(objArr);
  const objArrLength = objArrKeys.length;
  let total = 0;
  const results = [];
  const pending = new Promise((resolve, reject) => {
    const next = errors => {
      // eslint-disable-next-line prefer-spread
      results.push.apply(results, errors);
      total++;
      if (total === objArrLength) {
        callback(results);
        return results.length ? reject(new AsyncValidationError(results, convertFieldsError(results))) : resolve(source);
      }
    };
    if (!objArrKeys.length) {
      callback(results);
      resolve(source);
    }
    objArrKeys.forEach(key => {
      const arr = objArr[key];
      if (firstFields.indexOf(key) !== -1) {
        asyncSerialArray(arr, func, next);
      } else {
        asyncParallelArray(arr, func, next);
      }
    });
  });
  pending.catch(e => e);
  return pending;
}
function isErrorObj(obj) {
  return !!(obj && obj.message !== undefined);
}
function getValue(value, path) {
  let v = value;
  for (let i = 0; i < path.length; i++) {
    if (v == undefined) {
      return v;
    }
    v = v[path[i]];
  }
  return v;
}
function complementError(rule, source) {
  return oe => {
    let fieldValue;
    if (rule.fullFields) {
      fieldValue = getValue(source, rule.fullFields);
    } else {
      fieldValue = source[oe.field || rule.fullField];
    }
    if (isErrorObj(oe)) {
      oe.field = oe.field || rule.fullField;
      oe.fieldValue = fieldValue;
      return oe;
    }
    return {
      message: typeof oe === 'function' ? oe() : oe,
      fieldValue,
      field: oe.field || rule.fullField
    };
  };
}
function deepMerge(target, source) {
  if (source) {
    for (const s in source) {
      if (source.hasOwnProperty(s)) {
        const value = source[s];
        if (typeof value === 'object' && typeof target[s] === 'object') {
          target[s] = {
            ...target[s],
            ...value
          };
        } else {
          target[s] = value;
        }
      }
    }
  }
  return target;
}