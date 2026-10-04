import { describe, expect, it } from "vitest";
import * as analysis from "./index";
import { ProjectAnalysisCoordinator } from "./coordinator";
import { LanguageServiceController } from "./language-service-controller";
import { normalizeAnalysisFailure } from "./project-snapshot";

describe("analysis entry point", () => {
  it("re-exports the coordinator, controller and snapshot helpers", () => {
    expect(analysis.ProjectAnalysisCoordinator).toBe(ProjectAnalysisCoordinator);
    expect(analysis.LanguageServiceController).toBe(LanguageServiceController);
    expect(analysis.normalizeAnalysisFailure).toBe(normalizeAnalysisFailure);
  });
});
