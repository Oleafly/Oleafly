import _toConsumableArray from "@babel/runtime/helpers/esm/toConsumableArray";
import * as React from 'react';
import { clsx } from 'clsx';
import { isFunction, isPlainObject } from '../../is';
import { fillObjectBySchema } from './utils';
// ========================= ClassNames =========================
export const mergeClassNames = (schema = {}, ...classNames) => {
  return classNames.filter(item => Boolean(item)).reduce((acc, cur) => {
    // Loop keys of the current classNames
    Object.keys(cur).forEach(key => {
      const keySchema = schema[key];
      const curVal = cur[key];
      if (keySchema) {
        if (isPlainObject(curVal)) {
          // Loop fill
          acc[key] = mergeClassNames(keySchema, acc[key], curVal);
        } else {
          // Covert string to object structure
          const {
            _default: defaultField
          } = keySchema;
          if (defaultField) {
            acc[key] = acc[key] || {};
            acc[key][defaultField] = clsx(acc[key][defaultField], curVal);
          }
        }
      } else {
        // Flatten fill
        acc[key] = clsx(acc[key], curVal);
      }
    });
    return acc;
  }, {});
};
const useSemanticClassNames = (schema, ...classNames) => {
  return React.useMemo(() => mergeClassNames.apply(void 0, [schema].concat(classNames)), [schema].concat(classNames));
};
// =========================== Styles ===========================
export const mergeStyles = (...styles) => {
  return styles.filter(item => Boolean(item)).reduce((acc, cur = {}) => {
    Object.keys(cur).forEach(key => {
      acc[key] = {
        ...acc[key],
        ...cur[key]
      };
    });
    return acc;
  }, {});
};
const useSemanticStyles = (...styles) => {
  return React.useMemo(() => mergeStyles.apply(void 0, styles), [].concat(styles));
};
export const useSemanticRootStyle = style => {
  return React.useMemo(() => style ? {
    root: style
  } : undefined, [style]);
};
// =========================== Export ===========================
export const resolveStyleOrClass = (value, info) => {
  return isFunction(value) ? value(info) : value;
};
/**
 * @desc Merge classNames and styles from multiple sources. When `schema` is provided, it **must** provide the nest object structure.
 * @descZH 合并来自多个来源的 classNames 和 styles，当提供了 `schema` 时，必须提供嵌套的对象结构。
 */
export const useMergeSemantic = (classNamesList, stylesList, info, schema) => {
  const resolvedClassNamesList = classNamesList.map(classNames => classNames ? resolveStyleOrClass(classNames, info) : undefined);
  const resolvedStylesList = stylesList.map(styles => styles ? resolveStyleOrClass(styles, info) : undefined);
  const mergedClassNames = useSemanticClassNames.apply(void 0, [schema].concat(_toConsumableArray(resolvedClassNamesList)));
  const mergedStyles = useSemanticStyles.apply(void 0, _toConsumableArray(resolvedStylesList));
  return React.useMemo(() => {
    if (!schema) {
      return [mergedClassNames, mergedStyles];
    }
    return [fillObjectBySchema(mergedClassNames, schema), fillObjectBySchema(mergedStyles, schema)];
  }, [mergedClassNames, mergedStyles, schema]);
};