import type { resources } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["en"];
    enableSelector: "strict";
    strictKeyChecks: true;
  }
}
