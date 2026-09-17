export interface DataAttributeSpec<T> {
  default: T;
  parseHTML: (element: HTMLElement) => T;
  renderHTML: (attributes: Record<string, unknown>) => Record<string, string | null>;
}

export function stringAttribute(
  key: string,
  fallback: string | null,
  dataName = key,
): DataAttributeSpec<string | null> {
  return {
    default: fallback,
    parseHTML: (element) => element.getAttribute(`data-${dataName}`) ?? fallback,
    renderHTML: (attributes) => {
      const value = attributes[key];
      return { [`data-${dataName}`]: typeof value === "string" ? value : null };
    },
  };
}

export function booleanAttribute(key: string, fallback: boolean, dataName = key): DataAttributeSpec<boolean> {
  return {
    default: fallback,
    parseHTML: (element) => {
      const value = element.getAttribute(`data-${dataName}`);
      return value === null ? fallback : value === "true";
    },
    renderHTML: (attributes) => ({ [`data-${dataName}`]: attributes[key] === true ? "true" : "false" }),
  };
}
