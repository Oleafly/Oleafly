"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _dateFns = require("date-fns");
var locales = _interopRequireWildcard(require("date-fns/locale"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const getLocale = locale => {
  return locales[locale] || locales[locale.replace(/_/g, '')] || locales[locale.replace(/_.*$/g, '')];
};
const localeParse = format => {
  return format.replace(/Y/g, 'y').replace(/D/g, 'd').replace(/gggg/, 'yyyy').replace(/g/g, 'G').replace(/([Ww])o/g, 'wo').replace(/A/g, 'a');
};
const parse = (text, format, locale) => {
  return (0, _dateFns.parse)(text, localeParse(format), new Date(), {
    locale: getLocale(locale)
  });
};

/**
 * Check if the text is a valid date considering the format and locale
 *
 * This is a strict check, the date string must match the format exactly.
 * Date-fns allows some flexibility in parsing dates, for example, it will parse "30/01/2" as "30/01/002".
 * This behavior is not desirable in our case, so we need to check if the date string matches the format exactly.
 *
 * @param text the date string
 * @param format the date format to use
 * @param locale the locale to use
 */
const isStrictValidDate = (text, format, locale) => {
  const date = parse(text, format, locale);
  if (!(0, _dateFns.isValid)(date)) {
    return false;
  }
  const formattedDate = (0, _dateFns.format)(date, format, {
    locale: getLocale(locale)
  });
  return text === formattedDate;
};
const generateConfig = {
  // get
  getNow: () => new Date(),
  getFixedDate: string => new Date(string),
  getEndDate: date => (0, _dateFns.endOfMonth)(date),
  getWeekDay: date => (0, _dateFns.getDay)(date),
  getYear: date => (0, _dateFns.getYear)(date),
  getMonth: date => (0, _dateFns.getMonth)(date),
  getDate: date => (0, _dateFns.getDate)(date),
  getHour: date => (0, _dateFns.getHours)(date),
  getMinute: date => (0, _dateFns.getMinutes)(date),
  getSecond: date => (0, _dateFns.getSeconds)(date),
  getMillisecond: date => (0, _dateFns.getMilliseconds)(date),
  // set
  addYear: (date, diff) => (0, _dateFns.addYears)(date, diff),
  addMonth: (date, diff) => (0, _dateFns.addMonths)(date, diff),
  addDate: (date, diff) => (0, _dateFns.addDays)(date, diff),
  setYear: (date, year) => (0, _dateFns.setYear)(date, year),
  setMonth: (date, month) => (0, _dateFns.setMonth)(date, month),
  setDate: (date, num) => (0, _dateFns.setDate)(date, num),
  setHour: (date, hour) => (0, _dateFns.setHours)(date, hour),
  setMinute: (date, minute) => (0, _dateFns.setMinutes)(date, minute),
  setSecond: (date, second) => (0, _dateFns.setSeconds)(date, second),
  setMillisecond: (date, millisecond) => (0, _dateFns.setMilliseconds)(date, millisecond),
  // Compare
  isAfter: (date1, date2) => (0, _dateFns.isAfter)(date1, date2),
  isValidate: date => (0, _dateFns.isValid)(date),
  locale: {
    getWeekFirstDay: locale => {
      const clone = getLocale(locale);
      return clone.options.weekStartsOn;
    },
    getWeekFirstDate: (locale, date) => {
      return (0, _dateFns.startOfWeek)(date, {
        locale: getLocale(locale)
      });
    },
    getWeek: (locale, date) => {
      return (0, _dateFns.getWeek)(date, {
        locale: getLocale(locale)
      });
    },
    getShortWeekDays: locale => {
      const clone = getLocale(locale);
      return Array.from({
        length: 7
      }).map((_, i) => clone.localize.day(i, {
        width: 'short'
      }));
    },
    getShortMonths: locale => {
      const clone = getLocale(locale);
      return Array.from({
        length: 12
      }).map((_, i) => clone.localize.month(i, {
        width: 'abbreviated'
      }));
    },
    format: (locale, date, format) => {
      if (!(0, _dateFns.isValid)(date)) {
        return null;
      }
      return (0, _dateFns.format)(date, localeParse(format), {
        locale: getLocale(locale)
      });
    },
    parse: (locale, text, formats) => {
      for (let i = 0; i < formats.length; i += 1) {
        const format = localeParse(formats[i]);
        if (isStrictValidDate(text, format, locale)) {
          return parse(text, format, locale);
        }
      }
      return null;
    }
  }
};
var _default = exports.default = generateConfig;