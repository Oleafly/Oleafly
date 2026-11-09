import { CodeXml } from "lucide-react";
import { i18n } from "@/i18n";
import { prepareHtml } from "./artifact-runtime/frame-document";
import type { NoteBlockKind } from "./note-blocks";
import { paintScripted } from "./scripted-paint";

export const HTML_TEMPLATE = `<div class="dose">
  <h3>Dose response</h3>
  <label>Dose <input id="dose" type="range" min="0" max="100" value="40"></label>
  <p>Response: <strong id="response"></strong></p>
</div>
<style>
  .dose { font-family: system-ui, sans-serif; }
  .dose h3 { margin: 0 0 8px; }
</style>
<script>
  const dose = document.getElementById("dose");
  const response = document.getElementById("response");
  const update = () => {
    const value = Number(dose.value);
    response.textContent = ((100 * value ** 2) / (value ** 2 + 50 ** 2)).toFixed(1) + "%";
  };
  dose.addEventListener("input", update);
  update();
</script>`;

export function htmlRunsScripts(source: string): boolean {
  return prepareHtml(source).scripts;
}

export const htmlBlock: NoteBlockKind = {
  name: "html",
  label: () => "HTML",
  icon: CodeXml,
  paint: (preview, source, context) =>
    paintScripted(preview, source, context, {
      kind: "html",
      label: "HTML",
      scripted: htmlRunsScripts(source),
      loadingText: i18n.t(($) => $.notes.blocks.artifact.loading),
      failedText: i18n.t(($) => $.notes.blocks.artifact.loadFailed),
    }),
  still: "card",
  interactive: true,
  scripted: true,
  template: () => ({ info: "html", source: HTML_TEMPLATE }),
};
