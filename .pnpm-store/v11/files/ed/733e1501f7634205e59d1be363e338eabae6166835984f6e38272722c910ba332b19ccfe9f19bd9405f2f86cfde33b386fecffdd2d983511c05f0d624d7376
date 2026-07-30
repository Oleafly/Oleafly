import rules from "../rule";
import { isEmptyValue } from "../util";
const ENUM = 'enum';
const enumerable = (rule, value, callback, source, options) => {
  const errors = [];
  const validate = rule.required || !rule.required && source.hasOwnProperty(rule.field);
  if (validate) {
    if (isEmptyValue(value) && !rule.required) {
      return callback();
    }
    rules.required(rule, value, source, errors, options);
    if (value !== undefined) {
      rules[ENUM](rule, value, source, errors, options);
    }
  }
  callback(errors);
};
export default enumerable;