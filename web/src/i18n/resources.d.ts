import type web from "./en.json";

declare module "@/i18n/resources-types" {
  interface Resources {
    web: typeof web;
  }
}
