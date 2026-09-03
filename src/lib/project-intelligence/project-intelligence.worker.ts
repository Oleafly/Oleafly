import {
  installProjectIntelligenceWorker,
  type ProjectIntelligenceWorkerHost,
} from "./worker-core";

installProjectIntelligenceWorker(
  self as unknown as ProjectIntelligenceWorkerHost,
);
