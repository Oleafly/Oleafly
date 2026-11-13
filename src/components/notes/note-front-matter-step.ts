import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Step, StepMap, StepResult } from "@tiptap/pm/transform";

export class FrontMatterStep extends Step {
  constructor(
    readonly before: string,
    readonly after: string,
  ) {
    super();
  }

  apply(doc: ProseMirrorNode): StepResult {
    return StepResult.ok(doc);
  }

  getMap(): StepMap {
    return StepMap.empty;
  }

  invert(): FrontMatterStep {
    return new FrontMatterStep(this.after, this.before);
  }

  map(): this {
    return this;
  }

  toJSON() {
    return { stepType: "noteFrontMatter", before: this.before, after: this.after };
  }
}

export function frontMatterChange(tr: Transaction, before: string, after: string, undoable: boolean): Transaction {
  tr.step(new FrontMatterStep(before, after));
  return undoable ? tr : tr.setMeta("addToHistory", false);
}

export function frontMatterSteps(tr: Pick<Transaction, "steps">): FrontMatterStep[] {
  return tr.steps.filter((step): step is FrontMatterStep => step instanceof FrontMatterStep);
}
