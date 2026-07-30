import { stringifyLocale } from "./stringifyLocale.mjs";
export const cache = new Map();
export function getFormatter(locale, options) {
  const optionsString = JSON.stringify({
    locale: stringifyLocale(locale),
    options
  });
  const cachedFormatter = cache.get(optionsString);
  if (cachedFormatter) {
    return cachedFormatter;
  }
  const formatter = new Intl.NumberFormat(locale, options);
  cache.set(optionsString, formatter);
  return formatter;
}
export function formatNumber(value, locale, options) {
  if (value == null) {
    return '';
  }
  return getFormatter(locale, options).format(value);
}
export function formatNumberValue(value, locale, format) {
  if (value == null) {
    return '';
  }
  if (!format) {
    return formatNumber(value / 100, locale, {
      style: 'percent'
    });
  }
  return formatNumber(value, locale, format);
}