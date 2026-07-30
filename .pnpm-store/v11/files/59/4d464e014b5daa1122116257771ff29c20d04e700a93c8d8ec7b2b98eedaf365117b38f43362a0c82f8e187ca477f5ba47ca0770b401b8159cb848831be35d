"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useFieldsInvalidate;
var _miscUtil = require("../../utils/miscUtil");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Used to control each fields invalidate status
 */
function useFieldsInvalidate(calendarValue, isInvalidateDate, allowEmpty = []) {
  const [fieldsInvalidates, setFieldsInvalidates] = React.useState([false, false]);
  const onSelectorInvalid = (invalid, index) => {
    setFieldsInvalidates(ori => (0, _miscUtil.fillIndex)(ori, index, invalid));
  };

  /**
   * For the Selector Input to mark as `aria-disabled`
   */
  const submitInvalidates = React.useMemo(() => {
    return fieldsInvalidates.map((invalid, index) => {
      // If typing invalidate
      if (invalid) {
        return true;
      }
      const current = calendarValue[index];

      // Not check if all empty
      if (!current) {
        return false;
      }

      // Not allow empty
      if (!allowEmpty[index] && !current) {
        return true;
      }

      // Invalidate
      if (current && isInvalidateDate(current, {
        activeIndex: index
      })) {
        return true;
      }
      return false;
    });
  }, [calendarValue, fieldsInvalidates, isInvalidateDate, allowEmpty]);
  return [submitInvalidates, onSelectorInvalid];
}