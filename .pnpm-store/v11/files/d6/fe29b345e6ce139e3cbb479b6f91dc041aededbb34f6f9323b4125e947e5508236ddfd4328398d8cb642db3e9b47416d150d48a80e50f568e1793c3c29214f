"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {};
exports.default = void 0;
var _messages = require("./messages");
var _util = require("./util");
var _index = _interopRequireDefault(require("./validator/index"));
var _interface = require("./interface");
Object.keys(_interface).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _interface[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _interface[key];
    }
  });
});
/**
 *  Encapsulates a validation schema.
 *
 *  @param descriptor An object declaring validation rules
 *  for this schema.
 */
class Schema {
  // ========================= Static =========================
  static register = function register(type, validator) {
    if (typeof validator !== 'function') {
      throw new Error('Cannot register a validator by type, validator is not a function');
    }
    _index.default[type] = validator;
  };
  static warning = _util.warning;
  static messages = _messages.messages;
  static validators = _index.default;

  // ======================== Instance ========================
  rules = null;
  _messages = _messages.messages;
  constructor(descriptor) {
    this.define(descriptor);
  }
  define(rules) {
    if (!rules) {
      throw new Error('Cannot configure a schema with no rules');
    }
    if (typeof rules !== 'object' || Array.isArray(rules)) {
      throw new Error('Rules must be an object');
    }
    this.rules = {};
    Object.keys(rules).forEach(name => {
      const item = rules[name];
      this.rules[name] = Array.isArray(item) ? item : [item];
    });
  }
  messages(messages) {
    if (messages) {
      this._messages = (0, _util.deepMerge)((0, _messages.newMessages)(), messages);
    }
    return this._messages;
  }

  // eslint-disable-next-line @typescript-eslint/unified-signatures

  validate(source_, o = {}, oc = () => {}) {
    let source = source_;
    let options = o;
    let callback = oc;
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (!this.rules || Object.keys(this.rules).length === 0) {
      if (callback) {
        callback(null, source);
      }
      return Promise.resolve(source);
    }
    function complete(results) {
      let errors = [];
      let fields = {};
      function add(e) {
        if (Array.isArray(e)) {
          errors = errors.concat(...e);
        } else {
          errors.push(e);
        }
      }
      for (let i = 0; i < results.length; i++) {
        add(results[i]);
      }
      if (!errors.length) {
        callback(null, source);
      } else {
        fields = (0, _util.convertFieldsError)(errors);
        callback(errors, fields);
      }
    }
    if (options.messages) {
      let messages = this.messages();
      if (messages === _messages.messages) {
        messages = (0, _messages.newMessages)();
      }
      (0, _util.deepMerge)(messages, options.messages);
      options.messages = messages;
    } else {
      options.messages = this.messages();
    }
    const series = {};
    const keys = options.keys || Object.keys(this.rules);
    keys.forEach(z => {
      const arr = this.rules[z];
      let value = source[z];
      arr.forEach(r => {
        let rule = r;
        if (typeof rule.transform === 'function') {
          if (source === source_) {
            source = {
              ...source
            };
          }
          value = source[z] = rule.transform(value);
          if (value !== undefined && value !== null) {
            rule.type = rule.type || (Array.isArray(value) ? 'array' : typeof value);
          }
        }
        if (typeof rule === 'function') {
          rule = {
            validator: rule
          };
        } else {
          rule = {
            ...rule
          };
        }

        // Fill validator. Skip if nothing need to validate
        rule.validator = this.getValidationMethod(rule);
        if (!rule.validator) {
          return;
        }
        rule.field = z;
        rule.fullField = rule.fullField || z;
        rule.type = this.getType(rule);
        series[z] = series[z] || [];
        series[z].push({
          rule,
          value,
          source,
          field: z
        });
      });
    });
    const errorFields = {};
    return (0, _util.asyncMap)(series, options, (data, doIt) => {
      const rule = data.rule;
      let deep = (rule.type === 'object' || rule.type === 'array') && (typeof rule.fields === 'object' || typeof rule.defaultField === 'object');
      deep = deep && (rule.required || !rule.required && data.value);
      rule.field = data.field;
      function addFullField(key, schema) {
        return {
          ...schema,
          fullField: `${rule.fullField}.${key}`,
          fullFields: rule.fullFields ? [...rule.fullFields, key] : [key]
        };
      }
      function cb(e = []) {
        let errorList = Array.isArray(e) ? e : [e];
        if (!options.suppressWarning && errorList.length) {
          Schema.warning('async-validator:', errorList);
        }
        if (errorList.length && rule.message !== undefined && rule.message !== null) {
          errorList = [].concat(rule.message);
        }

        // Fill error info
        let filledErrors = errorList.map((0, _util.complementError)(rule, source));
        if (options.first && filledErrors.length) {
          errorFields[rule.field] = 1;
          return doIt(filledErrors);
        }
        if (!deep) {
          doIt(filledErrors);
        } else {
          // if rule is required but the target object
          // does not exist fail at the rule level and don't
          // go deeper
          if (rule.required && !data.value) {
            if (rule.message !== undefined) {
              filledErrors = [].concat(rule.message).map((0, _util.complementError)(rule, source));
            } else if (options.error) {
              filledErrors = [options.error(rule, (0, _util.format)(options.messages.required, rule.field))];
            }
            return doIt(filledErrors);
          }
          let fieldsSchema = {};
          if (rule.defaultField) {
            Object.keys(data.value).map(key => {
              fieldsSchema[key] = rule.defaultField;
            });
          }
          fieldsSchema = {
            ...fieldsSchema,
            ...data.rule.fields
          };
          const paredFieldsSchema = {};
          Object.keys(fieldsSchema).forEach(field => {
            const fieldSchema = fieldsSchema[field];
            const fieldSchemaList = Array.isArray(fieldSchema) ? fieldSchema : [fieldSchema];
            paredFieldsSchema[field] = fieldSchemaList.map(addFullField.bind(null, field));
          });
          const schema = new Schema(paredFieldsSchema);
          schema.messages(options.messages);
          if (data.rule.options) {
            data.rule.options.messages = options.messages;
            data.rule.options.error = options.error;
          }
          schema.validate(data.value, data.rule.options || options, errs => {
            const finalErrors = [];
            if (filledErrors && filledErrors.length) {
              finalErrors.push(...filledErrors);
            }
            if (errs && errs.length) {
              finalErrors.push(...errs);
            }
            doIt(finalErrors.length ? finalErrors : null);
          });
        }
      }
      let res;
      if (rule.asyncValidator) {
        res = rule.asyncValidator(rule, data.value, cb, data.source, options);
      } else if (rule.validator) {
        try {
          res = rule.validator(rule, data.value, cb, data.source, options);
        } catch (error) {
          console.error?.(error);
          // rethrow to report error
          if (!options.suppressValidatorError) {
            setTimeout(() => {
              throw error;
            }, 0);
          }
          cb(error.message);
        }
        if (res === true) {
          cb();
        } else if (res === false) {
          cb(typeof rule.message === 'function' ? rule.message(rule.fullField || rule.field) : rule.message || `${rule.fullField || rule.field} fails`);
        } else if (res instanceof Array) {
          cb(res);
        } else if (res instanceof Error) {
          cb(res.message);
        }
      }
      if (res && res.then) {
        res.then(() => cb(), e => cb(e));
      }
    }, results => {
      complete(results);
    }, source);
  }
  getType(rule) {
    if (rule.type === undefined && rule.pattern instanceof RegExp) {
      rule.type = 'pattern';
    }
    if (typeof rule.validator !== 'function' && rule.type && !_index.default.hasOwnProperty(rule.type)) {
      throw new Error((0, _util.format)('Unknown rule type %s', rule.type));
    }
    return rule.type || 'string';
  }
  getValidationMethod(rule) {
    if (typeof rule.validator === 'function') {
      return rule.validator;
    }
    const keys = Object.keys(rule);
    const messageIndex = keys.indexOf('message');
    if (messageIndex !== -1) {
      keys.splice(messageIndex, 1);
    }
    if (keys.length === 1 && keys[0] === 'required') {
      return _index.default.required;
    }
    return _index.default[this.getType(rule)] || undefined;
  }
}
var _default = exports.default = Schema;