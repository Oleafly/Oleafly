declare module "*.json?package-strings" {
  const catalog: { readonly package: Record<string, unknown> };
  export default catalog;
}
