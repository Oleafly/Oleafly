import type { Resources } from "./resources-types";
import "i18next";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    enableSelector: "strict";
    strictKeyChecks: true;
    resources: Resources;
  }
}
