"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fillObjectBySchema = void 0;
/**
 * Fill object structure by schema, initialize empty objects for keys with `_default` property.
 */
const fillObjectBySchema = (obj, schema) => {
  const newObj = {
    ...obj
  };
  Object.keys(schema).forEach(key => {
    if (schema[key]._default) {
      newObj[key] || (newObj[key] = {});
    } else {
      newObj[key] = fillObjectBySchema(newObj[key], schema[key]);
    }
  });
  return newObj;
};
exports.fillObjectBySchema = fillObjectBySchema;