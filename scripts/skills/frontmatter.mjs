const MAX_NAME_CHARS = 100;
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_SKILL_FILE_BYTES = 4 * 1024 * 1024;

export class YamlSubsetError extends Error {}

export function findFrontmatterBounds(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return null;
  const firstBreak = text.indexOf("\n") + 1;
  const closeMarkerIndex = text.indexOf("\n---", firstBreak);
  if (closeMarkerIndex === -1) return null;
  const afterClose = closeMarkerIndex + 4;
  const lineEnd = text.indexOf("\n", afterClose);
  const closeEnd = lineEnd === -1 ? text.length : lineEnd + 1;
  return { bodyStart: firstBreak, closeStart: closeMarkerIndex + 1, closeEnd };
}

export function frontmatterText(text) {
  const bounds = findFrontmatterBounds(text);
  if (!bounds) return null;
  return text.slice(bounds.bodyStart, bounds.closeStart);
}

function toLines(text) {
  return text.split("\n").map((raw, index) => {
    const stripped = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const trimmedStart = stripped.replace(/^[ ]*/, "");
    return {
      lineNo: index + 1,
      raw: stripped,
      indent: stripped.length - trimmedStart.length,
      content: trimmedStart,
      blank: trimmedStart.trim() === "",
      comment: trimmedStart.startsWith("#"),
    };
  });
}

function skipIgnorable(state) {
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.blank || line.comment) {
      state.index++;
      continue;
    }
    return;
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const KEY_RE = /^("[^"]*"|'[^']*'|[^:#][^:]*):(?:[ \t](.*))?$/;

function matchKey(content) {
  if (content.endsWith(":")) {
    const key = content.slice(0, -1);
    if (key.length > 0 && !key.includes(":")) return { key, rest: "" };
  }
  const match = KEY_RE.exec(content);
  if (!match) return null;
  return { key: match[1], rest: (match[2] ?? "").trim() };
}

function looksLikeKey(content) {
  return matchKey(content) !== null;
}

function parseBlockScalar(state, indicator, parentIndent) {
  const style = indicator[0];
  const chomp = indicator.includes("-") ? "strip" : indicator.includes("+") ? "keep" : "clip";
  const collected = [];
  let blockIndent = null;
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.blank) {
      collected.push("");
      state.index++;
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (blockIndent === null) blockIndent = line.indent;
    collected.push(line.raw.slice(Math.min(blockIndent, line.indent)));
    state.index++;
  }
  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
  let value;
  if (style === "|") {
    value = collected.join("\n");
  } else {
    value = "";
    for (let i = 0; i < collected.length; i++) {
      const current = collected[i];
      if (current === "") {
        value += "\n";
        continue;
      }
      if (i > 0 && collected[i - 1] !== "" && !value.endsWith("\n")) value += " ";
      value += current;
    }
  }
  if (chomp === "clip" || chomp === "keep") value += "\n";
  return value;
}

function parsePlainScalar(state, rest, parentIndent) {
  let value = rest;
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.blank) {
      const next = state.lines[state.index + 1];
      if (!next || next.blank || next.indent <= parentIndent) break;
      value += "\n";
      state.index++;
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (looksLikeKey(line.content)) {
      throw new YamlSubsetError(
        `mapping values are not allowed here (line ${line.lineNo}: ${line.raw.trim()})`,
      );
    }
    if (line.content.startsWith("- ")) {
      throw new YamlSubsetError(
        `sequence entries are not allowed in a plain scalar (line ${line.lineNo})`,
      );
    }
    value = value.endsWith("\n") ? value + line.content : `${value} ${line.content}`;
    state.index++;
  }
  return value;
}

const DOUBLE_QUOTE_ESCAPES = {
  "0": "\0",
  a: "",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
};

function parseQuoted(rest) {
  const quote = rest[0];
  let index = 1;
  let out = "";
  while (index < rest.length) {
    const char = rest[index];
    if (quote === "'") {
      if (char === "'") {
        if (rest[index + 1] === "'") {
          out += "'";
          index += 2;
          continue;
        }
        return out;
      }
      out += char;
      index++;
      continue;
    }
    if (char === "\\") {
      const escape = rest[index + 1];
      if (escape === "u" || escape === "x" || escape === "U") {
        const width = escape === "x" ? 2 : escape === "u" ? 4 : 8;
        const digits = rest.slice(index + 2, index + 2 + width);
        out += String.fromCodePoint(Number.parseInt(digits, 16));
        index += 2 + width;
        continue;
      }
      if (escape in DOUBLE_QUOTE_ESCAPES) {
        out += DOUBLE_QUOTE_ESCAPES[escape];
        index += 2;
        continue;
      }
      throw new YamlSubsetError(`unsupported escape \\${escape} in a double-quoted scalar`);
    }
    if (char === '"') return out;
    out += char;
    index++;
  }
  throw new YamlSubsetError("unterminated quoted scalar");
}

function parseScalarValue(state, rest, parentIndent) {
  if (/^[|>][-+]?[0-9]*$/.test(rest)) {
    return parseBlockScalar(state, rest, parentIndent);
  }
  if (rest.startsWith('"') || rest.startsWith("'")) {
    return parseQuoted(rest);
  }
  if (rest.startsWith("[") || rest.startsWith("{")) return rest;
  return parsePlainScalar(state, rest, parentIndent);
}

function parseNode(state, minIndent) {
  skipIgnorable(state);
  if (state.index >= state.lines.length) return null;
  const line = state.lines[state.index];
  if (line.indent < minIndent) return null;
  if (line.content === "-" || line.content.startsWith("- ")) {
    return parseSequence(state, line.indent);
  }
  return parseMapping(state, line.indent);
}

function parseNestedNode(state, parentIndent) {
  const probe = { lines: state.lines, index: state.index };
  skipIgnorable(probe);
  const line = probe.lines[probe.index];
  if (line && line.indent === parentIndent && (line.content === "-" || line.content.startsWith("- "))) {
    state.index = probe.index;
    return parseSequence(state, parentIndent);
  }
  return parseNode(state, parentIndent + 1);
}

function parseSequence(state, indent) {
  const items = [];
  while (true) {
    skipIgnorable(state);
    if (state.index >= state.lines.length) break;
    const line = state.lines[state.index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlSubsetError(`bad indentation of a sequence entry (line ${line.lineNo})`);
    }
    if (line.content !== "-" && !line.content.startsWith("- ")) break;
    const rest = line.content === "-" ? "" : line.content.slice(2).trim();
    if (rest === "") {
      state.index++;
      items.push(parseNode(state, indent + 1));
      continue;
    }
    if (looksLikeKey(rest)) {
      const column = line.raw.indexOf(rest, indent);
      state.lines[state.index] = {
        ...line,
        raw: " ".repeat(column) + rest,
        indent: column,
        content: rest,
      };
      items.push(parseMapping(state, column));
      continue;
    }
    state.index++;
    items.push(parseScalarValue(state, rest, indent));
  }
  return items;
}

function parseMapping(state, indent) {
  const mapping = {};
  while (true) {
    skipIgnorable(state);
    if (state.index >= state.lines.length) break;
    const line = state.lines[state.index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlSubsetError(`bad indentation of a mapping entry (line ${line.lineNo})`);
    }
    if (line.content === "-" || line.content.startsWith("- ")) break;
    const entry = matchKey(line.content);
    if (!entry) {
      throw new YamlSubsetError(`could not find expected ":" (line ${line.lineNo})`);
    }
    const key = unquote(entry.key);
    state.index++;
    if (entry.rest === "") {
      mapping[key] = parseNestedNode(state, indent);
      continue;
    }
    mapping[key] = parseScalarValue(state, entry.rest, indent);
  }
  return mapping;
}

export function parseYamlSubset(text) {
  const state = { lines: toLines(text), index: 0 };
  const value = parseNode(state, 0);
  skipIgnorable(state);
  if (state.index < state.lines.length) {
    const line = state.lines[state.index];
    throw new YamlSubsetError(`unexpected content (line ${line.lineNo}: ${line.raw.trim()})`);
  }
  return value;
}

export function parseFrontmatterMapping(text) {
  const frontmatter = frontmatterText(text);
  if (frontmatter === null) {
    throw new YamlSubsetError("SKILL.md must start with YAML front matter between --- markers");
  }
  const value = parseYamlSubset(frontmatter);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new YamlSubsetError("SKILL.md front matter must be a YAML mapping");
  }
  return value;
}

export function readFrontmatterField(text, field) {
  const mapping = parseFrontmatterMapping(text);
  const value = mapping[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim();
}

function findMetadataBlock(lines) {
  const start = lines.findIndex((line) => /^metadata:[ \t]*$/.test(line));
  if (start === -1) return null;
  let end = lines.length;
  let childIndent = null;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (/^\S/.test(lines[i])) {
      end = i;
      break;
    }
    if (childIndent === null) {
      childIndent = lines[i].length - lines[i].replace(/^[ ]*/, "").length;
    }
  }
  while (end > start + 1 && lines[end - 1].trim() === "") end--;
  return { start, end, childIndent: childIndent ?? 2 };
}

function renderBlock(value, indentWidth, depth) {
  const pad = " ".repeat(indentWidth * depth);
  const out = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry === "object") {
      out.push(`${pad}${key}:`);
      out.push(...renderBlock(entry, indentWidth, depth + 1));
    } else {
      out.push(`${pad}${key}: ${entry}`);
    }
  }
  return out;
}

export function injectOleaflyMetadata(text, oleafly) {
  const bounds = findFrontmatterBounds(text);
  if (!bounds) {
    throw new Error("SKILL.md has no YAML frontmatter block");
  }
  const frontmatter = text.slice(bounds.bodyStart, bounds.closeStart);
  const trailingNewline = frontmatter.endsWith("\n");
  const lines = (trailingNewline ? frontmatter.slice(0, -1) : frontmatter).split("\n");
  const block = findMetadataBlock(lines);
  let next;
  if (block) {
    const indentWidth = block.childIndent;
    const rendered = renderBlock({ oleafly }, indentWidth, 1);
    next = [...lines.slice(0, block.end), ...rendered, ...lines.slice(block.end)];
  } else {
    const rendered = renderBlock({ metadata: { oleafly } }, 2, 0);
    next = [...lines, ...rendered];
  }
  const rebuilt = next.join("\n") + (trailingNewline ? "\n" : "");
  return text.slice(0, bounds.bodyStart) + rebuilt + text.slice(bounds.closeStart);
}

export function validateSkillMarkdown(text, label = "SKILL.md") {
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_FILE_BYTES) {
    throw new Error(`${label}: exceeds the ${MAX_SKILL_FILE_BYTES}-byte limit`);
  }
  let mapping;
  try {
    mapping = parseFrontmatterMapping(text);
  } catch (error) {
    throw new Error(`${label}: front matter could not be parsed: ${error.message}`);
  }
  for (const [field, max] of [
    ["name", MAX_NAME_CHARS],
    ["description", MAX_DESCRIPTION_CHARS],
  ]) {
    const value = mapping[field];
    if (value === undefined) {
      throw new Error(`${label}: front matter is missing the field "${field}"`);
    }
    if (typeof value !== "string") {
      throw new Error(`${label}: front matter field "${field}" must be a non-empty string`);
    }
    const trimmed = value.trim();
    if (trimmed === "" || /[\r\n]/.test(trimmed) || [...trimmed].length > max) {
      throw new Error(
        `${label}: front matter field "${field}" must be a non-empty single line of at most ${max} characters`,
      );
    }
  }
  return mapping;
}

export const BLOCK_SCALAR_INDICATORS = [">", "|", ">-", "|-", ">+", "|+"];
