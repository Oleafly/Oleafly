import { parseSnippetFile, type ParsedSnippetFile, type SnippetProblem } from "@oleafly/snippets";
import { describeError } from "@/lib/app-error";
import { collectionOf } from "./store";

const WHOLE_FILE_CODES: ReadonlySet<string> = new Set(["json", "not-object", "unreadable"]);

export function unreadableProblem(collection: string, name: string, reason: string | null): SnippetProblem {
  const detail = reason ? ` ${reason}` : "";
  return { collection, line: 1, code: "unreadable", message: `${name} could not be read.${detail}`, severity: "error" };
}

export function parseUserFile(name: string, text: string): ParsedSnippetFile {
  const collection = collectionOf(name);
  try {
    return parseSnippetFile(text, collection, "user");
  } catch (error) {
    return { collection, records: [], problems: [unreadableProblem(collection, name, describeError(error))] };
  }
}

export function wholeFileProblem(parsed: ParsedSnippetFile): SnippetProblem | undefined {
  if (parsed.records.length > 0) return undefined;
  return parsed.problems.find((problem) => WHOLE_FILE_CODES.has(problem.code));
}
