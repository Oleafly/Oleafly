import { theme } from 'antd';
/**
 * 将 camelCase 转换为 kebab-case
 * 处理连续大写字母和数字的情况：
 * - paddingLG → padding-lg
 * - screenXSMax → screen-xs-max
 * - yellow1 → yellow-1
 * - blue10 → blue-10
 */
export var toKebabCase = function toKebabCase(str) {
  return str
  // 处理小写字母后面跟大写字母：colorPrimary → color-Primary
  .replace(/([a-z])([A-Z])/g, '$1-$2')
  // 处理小写字母后面跟数字：yellow1 → yellow-1
  .replace(/([a-z])(\d)/g, '$1-$2')
  // 处理数字后面跟大写字母：screen2XL → screen-2-XL
  .replace(/(\d)([A-Z])/g, '$1-$2')
  // 处理连续大写字母后面跟小写字母：screenXSMax → screenXS-Max → screen-xs-max
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').toLowerCase();
};

/**
 * 根据 token keys 生成 CSS 变量映射
 * @param prefix - CSS 变量前缀，默认为 'ant'
 * @returns CSS 变量映射对象
 *
 * @description
 * - 只保留 camelCase 的 key（如 yellow1），过滤掉 kebab-case 的 key（如 blue-1）
 * - 当 prefix 不是 'ant' 时，会自动添加 fallback 到 ant 前缀的变量。
 *   例如：prefix='site' 时，colorPrimary 会生成：
 *   `var(--site-color-primary, var(--ant-color-primary))`
 *   这样即使自定义前缀的变量不存在，也会回退到 ant 前缀的变量。
 */
export var generateCSSVarMap = function generateCSSVarMap() {
  var prefix = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'ant';
  var token = theme.getDesignToken();
  var cssVar = {};
  var needFallback = prefix !== 'ant';
  for (var _i = 0, _arr = Object.keys(token); _i < _arr.length; _i++) {
    var key = _arr[_i];
    // 过滤掉 kebab-case 的 key（antd token 中同时存在 yellow1 和 blue-1 两种形式）
    if (key.includes('-')) continue;
    var kebabKey = toKebabCase(key);
    if (needFallback) {
      // 添加 fallback 到 ant 前缀
      cssVar[key] = "var(--".concat(prefix, "-").concat(kebabKey, ", var(--ant-").concat(kebabKey, "))");
    } else {
      cssVar[key] = "var(--".concat(prefix, "-").concat(kebabKey, ")");
    }
  }
  return cssVar;
};

/**
 * 默认的 CSS 变量映射（使用 'ant' 前缀）
 */
export var cssVar = generateCSSVarMap();