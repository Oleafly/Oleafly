declare module "jsdom" {
  interface ConstructorOptions {
    url?: string;
  }

  class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }

  export { JSDOM };
}
