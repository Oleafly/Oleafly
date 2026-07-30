import { createCSS, createEmotion, DEFAULT_CSS_PREFIX_KEY } from "../../core";
import { cssVar, generateCSSVarMap } from "./cssVar";
import { responsive } from "./responsive";

/**
 * createStaticStyles 的配置选项
 */

/**
 * 工厂函数返回类型
 */

// 创建默认的全局 emotion 实例，使用与默认 styleInstance 相同的 key
var defaultEmotion = createEmotion({
  key: DEFAULT_CSS_PREFIX_KEY,
  speedy: false
});

/**
 * 创建 createStaticStyles 工厂函数
 *
 * 用于创建带有自定义 prefix 的 createStaticStyles 实例
 *
 * @example
 * ```tsx
 * // 创建自定义 prefix 的实例
 * const { createStaticStyles, cssVar } = createStaticStylesFactory({ prefix: 'my-app' });
 *
 * const styles = createStaticStyles(({ css, cssVar }) => ({
 *   container: css`
 *     background: ${cssVar.colorBgContainer}; // => var(--my-app-color-bg-container)
 *   `
 * }));
 * ```
 */
export var createStaticStylesFactory = function createStaticStylesFactory() {
  var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var _options$prefix = options.prefix,
    prefix = _options$prefix === void 0 ? 'ant' : _options$prefix,
    _options$hashPriority = options.hashPriority,
    hashPriority = _options$hashPriority === void 0 ? 'high' : _options$hashPriority,
    cache = options.cache;

  // 根据 prefix 生成 cssVar
  var customCssVar = generateCSSVarMap(prefix);

  // 使用提供的 cache 或默认的全局 cache
  var emotionCache = cache !== null && cache !== void 0 ? cache : defaultEmotion.cache;

  // 创建 css 和 cx 函数
  var _createCSS = createCSS(emotionCache, {
      hashPriority: hashPriority
    }),
    css = _createCSS.css,
    cx = _createCSS.cx;
  var createStaticStyles = function createStaticStyles(stylesFn) {
    var utils = {
      css: css,
      cx: cx,
      cssVar: customCssVar,
      responsive: responsive
    };
    return stylesFn(utils);
  };
  return {
    createStaticStyles: createStaticStyles,
    cssVar: customCssVar,
    responsive: responsive
  };
};

// 默认实例（使用 'ant' 前缀）
var defaultInstance = createStaticStylesFactory();

/**
 * 创建静态样式
 *
 * 与 createStyles 不同，createStaticStyles 直接返回样式对象而非 hook。
 * 样式在模块导入时计算一次，组件内直接使用，无需调用 hook。
 *
 * 静态样式使用与 antd-style 默认实例相同的 emotion cache，
 * 因此可以使用从 antd-style 导出的 cx 来正确合并样式。
 *
 * @example
 * ```tsx
 * import { createStaticStyles, cx } from 'antd-style';
 *
 * // 模块级别定义
 * const styles = createStaticStyles(({ css, cssVar }) => ({
 *   container: css`
 *     background: ${cssVar.colorBgContainer};
 *     color: ${cssVar.colorText};
 *   `,
 *   text: css`
 *     color: ${cssVar.colorText};
 *   `,
 *   secondary: css`
 *     font-size: 12px;
 *   `
 * }));
 *
 * // 组件内直接使用
 * const Component = () => {
 *   // 使用 antd-style 导出的 cx 来合并样式
 *   return <div className={cx(styles.text, styles.secondary)}>Hello</div>;
 * };
 * ```
 *
 * @param stylesFn - 样式生成函数
 * @returns 样式对象
 */
export var createStaticStyles = defaultInstance.createStaticStyles;

// 导出类型和工具
export { cssVar, generateCSSVarMap, responsive };