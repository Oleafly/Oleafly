import type { AliasToken } from 'antd/es/theme/interface';
/**
 * 将 camelCase 转换为 kebab-case
 * 处理连续大写字母和数字的情况：
 * - paddingLG → padding-lg
 * - screenXSMax → screen-xs-max
 * - yellow1 → yellow-1
 * - blue10 → blue-10
 */
export declare const toKebabCase: (str: string) => string;
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
export declare const generateCSSVarMap: (prefix?: string) => Record<keyof AliasToken, string>;
/**
 * 默认的 CSS 变量映射（使用 'ant' 前缀）
 */
export declare const cssVar: Record<keyof AliasToken, string>;
export type CSSVarMap = typeof cssVar;
