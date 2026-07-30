// src/ordered-list/ordered-list.ts
import { Plugin } from "@tiptap/pm/state";
import { mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";

// src/ordered-list/roman.ts
var ROMAN_NUMERALS = [
  [1e3, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"]
];
var ALPHA_NUMERALS = "abcdefghijklmnopqrstuvwxyz";
var ORDERED_LIST_ALPHA_MARKER_PATTERN = "[a-zA-Z]{1,2}";
var ORDERED_LIST_MARKER_PATTERN = String.raw`\d+|[ivxlcdmIVXLCDM]+|${ORDERED_LIST_ALPHA_MARKER_PATTERN}`;
function toRoman(num) {
  let remaining = num;
  let result = "";
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
}
function toRomanUpper(num) {
  return toRoman(num).toUpperCase();
}
function fromRoman(roman) {
  const lower = roman.toLowerCase();
  let index = 0;
  let result = 0;
  while (index < lower.length) {
    let matched = false;
    for (const [value, numeral] of ROMAN_NUMERALS) {
      if (lower.startsWith(numeral, index)) {
        result += value;
        index += numeral.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      return 0;
    }
  }
  return result;
}
function isValidRoman(marker) {
  if (!/^[ivxlcdmIVXLCDM]+$/.test(marker)) {
    return false;
  }
  const value = fromRoman(marker);
  if (value <= 0) {
    return false;
  }
  const expected = marker === marker.toLowerCase() ? toRoman(value) : toRomanUpper(value);
  return expected === marker;
}
function fromAlpha(marker) {
  const lower = marker.toLowerCase();
  if (lower.length === 1) {
    return lower.charCodeAt(0) - "a".charCodeAt(0) + 1;
  }
  if (lower.length === 2) {
    const first = lower.charCodeAt(0) - "a".charCodeAt(0);
    const second = lower.charCodeAt(1) - "a".charCodeAt(0);
    return (first + 1) * 26 + second + 1;
  }
  return 0;
}
function toRomanAlpha(num) {
  if (num <= 26) {
    return ALPHA_NUMERALS[num - 1];
  }
  const first = Math.floor((num - 1) / 26) - 1;
  const second = (num - 1) % 26;
  if (first < 0) {
    return ALPHA_NUMERALS[second];
  }
  return ALPHA_NUMERALS[first] + ALPHA_NUMERALS[second];
}
function detectMarkerType(marker) {
  if (!marker || /^\d+$/.test(marker)) {
    return void 0;
  }
  if (isValidRoman(marker)) {
    return marker === marker.toLowerCase() ? "i" : "I";
  }
  if (/^[a-z]{1,2}$/.test(marker)) {
    return "a";
  }
  if (/^[A-Z]{1,2}$/.test(marker)) {
    return "A";
  }
  return void 0;
}
function markerToStart(marker) {
  if (/^\d+$/.test(marker)) {
    return parseInt(marker, 10);
  }
  const type = detectMarkerType(marker);
  if (type === "i" || type === "I") {
    return fromRoman(marker);
  }
  if (type === "a" || type === "A") {
    const start = fromAlpha(marker);
    return start > 0 ? start : 1;
  }
  const parsed = parseInt(marker, 10);
  return Number.isNaN(parsed) ? 1 : parsed;
}
function startToMarker(type, start) {
  if (type === "numeric") {
    return String(start);
  }
  switch (type) {
    case "a":
      return toRomanAlpha(start);
    case "A":
      return toRomanAlpha(start).toUpperCase();
    case "i":
      return toRoman(start);
    case "I":
      return toRomanUpper(start);
    default:
      return String(start);
  }
}
function areOrderedListMarkersSequential(markers) {
  var _a;
  if (markers.length === 0) {
    return false;
  }
  const firstType = (_a = detectMarkerType(markers[0])) != null ? _a : "numeric";
  const firstStart = markerToStart(markers[0]);
  if (firstStart < 1) {
    return false;
  }
  for (let i = 0; i < markers.length; i++) {
    const expected = startToMarker(firstType, firstStart + i);
    if (markers[i] !== expected) {
      return false;
    }
  }
  return true;
}
function parseListMarker(marker) {
  return {
    type: detectMarkerType(marker),
    start: markerToStart(marker)
  };
}
function buildOrderedListAttrsFromMarker(marker) {
  const { type, start } = parseListMarker(marker);
  const attrs = {};
  if (type) {
    attrs.type = type;
  }
  if (start !== 1) {
    attrs.start = start;
  }
  return attrs;
}
function getListMarker(type, index, separator = ". ") {
  const position = index + 1;
  if (!type || type === "1") {
    return `${position}${separator}`;
  }
  switch (type) {
    case "a":
      return `${toRomanAlpha(position)}${separator}`;
    case "A":
      return `${toRomanAlpha(position).toUpperCase()}${separator}`;
    case "i":
      return `${toRoman(position)}${separator}`;
    case "I":
      return `${toRomanUpper(position)}${separator}`;
    default:
      return `${position}${separator}`;
  }
}

// src/ordered-list/utils.ts
var ORDERED_LIST_ITEM_REGEX = new RegExp(
  `^(\\s*)(${ORDERED_LIST_MARKER_PATTERN})([.)])\\s+(.*)$`
);
var INDENTED_LINE_REGEX = /^\s/;
var PARAGRAPH_INTERRUPTERS = {
  heading: /^#{1,6}(?:\s|$)/,
  bulletItem: /^[-+*]\s+/,
  codeFence: /^(?:```|~~~)/,
  thematicBreak: /^(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/
};
function isOrderedListMarkerLine(line) {
  return ORDERED_LIST_ITEM_REGEX.test(line.trimStart());
}
function isBlockContentLine(line) {
  const trimmedLine = line.trimStart();
  return PARAGRAPH_INTERRUPTERS.bulletItem.test(trimmedLine) || isOrderedListMarkerLine(trimmedLine) || PARAGRAPH_INTERRUPTERS.heading.test(trimmedLine) || // dash breaks are excluded: "---" directly below paragraph text is a
  // setext heading underline, not a thematic break
  PARAGRAPH_INTERRUPTERS.thematicBreak.test(trimmedLine) && !trimmedLine.startsWith("-") || // oxlint-disable-next-line prefer-string-starts-ends-with
  /^>\s?/.test(trimmedLine) || PARAGRAPH_INTERRUPTERS.codeFence.test(trimmedLine);
}
function interruptsLazyContinuation(line) {
  return Object.values(PARAGRAPH_INTERRUPTERS).some((pattern) => pattern.test(line));
}
function splitItemContent(contentLines) {
  const paragraphLines = [];
  const blockLines = [];
  let reachedBlockBoundary = false;
  contentLines.forEach((line) => {
    if (reachedBlockBoundary) {
      blockLines.push(line);
      return;
    }
    if (line.trim() === "") {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }
    if (paragraphLines.length > 0 && isBlockContentLine(line)) {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }
    paragraphLines.push(line);
  });
  return {
    paragraphLines,
    blockLines
  };
}
function collectOrderedListItems(lines) {
  const listItems = [];
  let currentLineIndex = 0;
  let consumed = 0;
  while (currentLineIndex < lines.length) {
    const line = lines[currentLineIndex];
    const match = line.match(ORDERED_LIST_ITEM_REGEX);
    if (!match) {
      break;
    }
    const [, indent, marker, _separator, content] = match;
    const indentLevel = indent.length;
    const number = parseInt(marker, 10);
    const markerType = isNaN(number) ? detectMarkerType(marker) : void 0;
    const itemNumber = isNaN(number) ? markerToStart(marker) : number;
    const itemContentLines = [content];
    let nextLineIndex = currentLineIndex + 1;
    const itemLines = [line];
    let sawBlankLine = false;
    while (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex];
      const nextMatch = nextLine.match(ORDERED_LIST_ITEM_REGEX);
      if (nextMatch) {
        break;
      }
      if (nextLine.trim() === "") {
        itemLines.push(nextLine);
        itemContentLines.push("");
        sawBlankLine = true;
        nextLineIndex += 1;
      } else if (nextLine.match(INDENTED_LINE_REGEX)) {
        const leadingWhitespace = nextLine.length - nextLine.trimStart().length;
        const contentIndent = indentLevel + marker.length + 1;
        itemLines.push(nextLine);
        itemContentLines.push(nextLine.slice(Math.min(leadingWhitespace, contentIndent)));
        nextLineIndex += 1;
      } else {
        if (sawBlankLine || interruptsLazyContinuation(nextLine)) {
          break;
        }
        itemLines.push(nextLine);
        itemContentLines.push(nextLine);
        nextLineIndex += 1;
      }
    }
    listItems.push({
      indent: indentLevel,
      number: itemNumber,
      type: markerType,
      content: itemContentLines.join("\n").trim(),
      contentLines: itemContentLines,
      raw: itemLines.join("\n")
    });
    consumed = nextLineIndex;
    currentLineIndex = nextLineIndex;
  }
  return [listItems, consumed];
}
var PLAIN_TEXT_ORDERED_LIST_LINE_REGEX = new RegExp(
  `^(${ORDERED_LIST_MARKER_PATTERN})([.)])\\s+(.+)$`
);
function parsePlainTextOrderedListPaste(text) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }
  const parsedItems = [];
  for (const line of lines) {
    const match = line.trim().match(PLAIN_TEXT_ORDERED_LIST_LINE_REGEX);
    if (!match) {
      return null;
    }
    parsedItems.push({
      marker: match[1],
      content: match[3]
    });
  }
  const markers = parsedItems.map((item) => item.marker);
  if (!areOrderedListMarkersSequential(markers)) {
    return null;
  }
  const attrs = buildOrderedListAttrsFromMarker(parsedItems[0].marker);
  return {
    type: "orderedList",
    attrs,
    content: parsedItems.map((item) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: item.content }]
        }
      ]
    }))
  };
}
function buildNestedStructure(items, baseIndent, lexer) {
  const result = [];
  let currentIndex = 0;
  while (currentIndex < items.length) {
    const item = items[currentIndex];
    if (item.indent === baseIndent) {
      const { paragraphLines, blockLines } = splitItemContent(item.contentLines);
      const mainText = paragraphLines.join("\n").trim();
      const tokens = [];
      if (mainText) {
        tokens.push({
          type: "paragraph",
          raw: mainText,
          tokens: lexer.inlineTokens(mainText)
        });
      }
      const additionalContent = blockLines.join("\n").trim();
      if (additionalContent) {
        const blockTokens = lexer.blockTokens(additionalContent);
        tokens.push(...blockTokens);
      }
      let lookAheadIndex = currentIndex + 1;
      const nestedItems = [];
      while (lookAheadIndex < items.length && items[lookAheadIndex].indent > baseIndent) {
        nestedItems.push(items[lookAheadIndex]);
        lookAheadIndex += 1;
      }
      if (nestedItems.length > 0) {
        const nextIndent = Math.min(...nestedItems.map((nestedItem) => nestedItem.indent));
        const nestedListItems = buildNestedStructure(nestedItems, nextIndent, lexer);
        tokens.push({
          type: "list",
          ordered: true,
          start: nestedItems[0].number,
          typeMarker: nestedItems[0].type,
          items: nestedListItems,
          raw: nestedItems.map((nestedItem) => nestedItem.raw).join("\n")
        });
      }
      result.push({
        type: "list_item",
        raw: item.raw,
        tokens
      });
      currentIndex = lookAheadIndex;
    } else {
      currentIndex += 1;
    }
  }
  return result;
}
function parseListItems(items, helpers) {
  return items.map((item) => {
    if (item.type !== "list_item") {
      return helpers.parseChildren([item])[0];
    }
    const content = [];
    if (item.tokens && item.tokens.length > 0) {
      item.tokens.forEach((itemToken) => {
        if (itemToken.type === "paragraph" || itemToken.type === "list" || itemToken.type === "blockquote" || itemToken.type === "code") {
          content.push(...helpers.parseChildren([itemToken]));
        } else if (itemToken.type === "text" && itemToken.tokens) {
          const inlineContent = helpers.parseChildren([itemToken]);
          content.push({
            type: "paragraph",
            content: inlineContent
          });
        } else {
          const parsed = helpers.parseChildren([itemToken]);
          if (parsed.length > 0) {
            content.push(...parsed);
          }
        }
      });
    }
    return {
      type: "listItem",
      content
    };
  });
}

// src/ordered-list/ordered-list.ts
var ListItemName = "listItem";
var TextStyleName = "textStyle";
var orderedListInputRegex = /^(\d+)\.\s$/;
function cssListStyleTypeToHtmlType(style) {
  const match = style.match(/list-style-type\s*:\s*([^;]+)/i);
  if (!match) {
    return null;
  }
  const cssValue = match[1].trim().toLowerCase();
  switch (cssValue) {
    case "upper-roman":
      return "I";
    case "lower-roman":
      return "i";
    case "upper-alpha":
    case "upper-latin":
      return "A";
    case "lower-alpha":
    case "lower-latin":
      return "a";
    default:
      return null;
  }
}
var OrderedList = Node.create({
  name: "orderedList",
  addOptions() {
    return {
      itemTypeName: "listItem",
      HTMLAttributes: {},
      keepMarks: false,
      keepAttributes: false
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => {
          return element.hasAttribute("start") ? parseInt(element.getAttribute("start") || "", 10) : 1;
        }
      },
      type: {
        default: null,
        parseHTML: (element) => {
          const htmlType = element.getAttribute("type");
          if (htmlType) {
            return htmlType;
          }
          const style = element.getAttribute("style");
          if (style) {
            const mappedFromOl = cssListStyleTypeToHtmlType(style);
            if (mappedFromOl) {
              return mappedFromOl;
            }
          }
          const firstLi = element.querySelector("li");
          if (firstLi) {
            const liStyle = firstLi.getAttribute("style");
            if (liStyle) {
              const mappedFromLi = cssListStyleTypeToHtmlType(liStyle);
              if (mappedFromLi) {
                return mappedFromLi;
              }
            }
          }
          return null;
        }
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "ol"
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { start, type, ...attributesWithoutType } = HTMLAttributes;
    const attrs = mergeAttributes(this.options.HTMLAttributes, attributesWithoutType);
    if (start !== 1) {
      attrs.start = start;
    }
    if (type && type !== "1") {
      attrs.type = type;
    }
    return ["ol", attrs, 0];
  },
  markdownTokenName: "list",
  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || !token.ordered) {
      return [];
    }
    const startValue = token.start || 1;
    const typeValue = token.typeMarker;
    const content = token.items ? parseListItems(token.items, helpers) : [];
    const attrs = {};
    if (startValue !== 1) {
      attrs.start = startValue;
    }
    if (typeValue) {
      attrs.type = typeValue;
    }
    if (Object.keys(attrs).length > 0) {
      return {
        type: "orderedList",
        attrs,
        content
      };
    }
    return {
      type: "orderedList",
      content
    };
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownTokenizer: {
    name: "orderedList",
    level: "block",
    // marked already breaks paragraphs before a start-of-line list marker. It
    // probes this with `src.slice(1)`, so any marker it surfaces here is
    // mid-line (like the "216)" in "(216) 555-1234") and must not start a list.
    // We still define the callback so marked does not fall back to probing
    // `tokenize`, which would re-introduce the mid-line split.
    start: () => -1,
    tokenize: (src, _tokens, lexer) => {
      var _a, _b;
      const lines = src.split("\n");
      const [listItems, consumed] = collectOrderedListItems(lines);
      if (listItems.length === 0) {
        return void 0;
      }
      const items = buildNestedStructure(listItems, listItems[0].indent, lexer);
      if (items.length === 0) {
        return void 0;
      }
      const startValue = ((_a = listItems[0]) == null ? void 0 : _a.number) || 1;
      const typeMarker = (_b = listItems[0]) == null ? void 0 : _b.type;
      return {
        type: "list",
        ordered: true,
        start: startValue,
        typeMarker,
        items,
        raw: lines.slice(0, consumed).join("\n")
      };
    }
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleOrderedList: () => ({ commands, chain }) => {
        if (this.options.keepAttributes) {
          return chain().toggleList(this.name, this.options.itemTypeName, this.options.keepMarks).updateAttributes(ListItemName, this.editor.getAttributes(TextStyleName)).run();
        }
        return commands.toggleList(this.name, this.options.itemTypeName, this.options.keepMarks);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList()
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            var _a, _b;
            const html = (_a = event.clipboardData) == null ? void 0 : _a.getData("text/html");
            if (html == null ? void 0 : html.trim()) {
              return false;
            }
            const text = (_b = event.clipboardData) == null ? void 0 : _b.getData("text/plain");
            if (!text) {
              return false;
            }
            const orderedListContent = parsePlainTextOrderedListPaste(text);
            if (!orderedListContent) {
              return false;
            }
            try {
              const orderedListNode = view.state.schema.nodeFromJSON(orderedListContent);
              const tr = view.state.tr.replaceSelectionWith(orderedListNode);
              view.dispatch(tr);
              return true;
            } catch {
              return false;
            }
          }
        }
      })
    ];
  },
  addInputRules() {
    const joinPredicate = (match, node) => {
      const hasDefaultType = !node.attrs.type || node.attrs.type === "1";
      return hasDefaultType && node.childCount + node.attrs.start === +match[1];
    };
    let inputRule = wrappingInputRule({
      find: orderedListInputRegex,
      type: this.type,
      getAttributes: (match) => ({ start: +match[1] }),
      joinPredicate
    });
    if (this.options.keepMarks || this.options.keepAttributes) {
      inputRule = wrappingInputRule({
        find: orderedListInputRegex,
        type: this.type,
        keepMarks: this.options.keepMarks,
        keepAttributes: this.options.keepAttributes,
        getAttributes: (match) => ({ start: +match[1], ...this.editor.getAttributes(TextStyleName) }),
        joinPredicate,
        editor: this.editor
      });
    }
    return [inputRule];
  }
});
export {
  ORDERED_LIST_MARKER_PATTERN,
  OrderedList,
  areOrderedListMarkersSequential,
  buildOrderedListAttrsFromMarker,
  detectMarkerType,
  getListMarker,
  markerToStart,
  orderedListInputRegex,
  parseListMarker,
  parsePlainTextOrderedListPaste,
  toRoman,
  toRomanUpper
};
//# sourceMappingURL=index.js.map