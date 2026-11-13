import type { CollabNoteUpload, ProjectInfo } from "@oleafly/backend-port";
import { flushOpenNotes } from "@/lib/open-note-editors";
import { readFileContent } from "@/lib/tauri";
import { projectCitations } from "./note-citations";
import { convertNote, prepareNote } from "./note-export";
import { readNoteFacts } from "./note-file";

const CHECKED = "\u2611 ";
const UNCHECKED = "\u2610 ";

export function webPageBody(html: string): string {
  const page = new DOMParser().parseFromString(html, "text/html");
  page.getElementById("title-block-header")?.remove();
  for (const box of page.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    box.replaceWith(page.createTextNode(box.hasAttribute("checked") ? CHECKED : UNCHECKED));
  }
  for (const image of page.body.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    if (source.startsWith("data:image/")) continue;
    const link = page.createElement("a");
    link.setAttribute("href", source);
    link.textContent = image.getAttribute("alt") || source;
    image.replaceWith(link);
  }
  return page.body.innerHTML.trim();
}

export async function noteSourceId(project: ProjectInfo, text?: string): Promise<string> {
  const id = readNoteFacts(text ?? (await readFileContent(project.id, project.main_doc))).id;
  return id?.trim() || project.id;
}

export async function notePage(project: ProjectInfo): Promise<CollabNoteUpload> {
  await flushOpenNotes();
  const [text, citations] = await Promise.all([
    readFileContent(project.id, project.main_doc),
    project.related_project ? projectCitations(project.related_project).catch(() => []) : [],
  ]);
  const title = project.name;
  const prepared = await prepareNote({ noteId: project.id, shared: Boolean(project.shared), title, text, citations }, "html");
  const converted = await convertNote(prepared.text, "html");
  return { source: await noteSourceId(project, text), title, html: webPageBody(converted.text ?? "") };
}
