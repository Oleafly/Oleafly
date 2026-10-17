import { HighlightStyle } from "@codemirror/language";
import { Tag, tagHighlighter, tags as t, type Highlighter } from "@lezer/highlight";
import { SYNTAX_ROLES, editorColor, type SyntaxRole } from "./color-roles";

export const syntaxTags = {
  formatting: Tag.define("formatting", t.tagName),
  environment: Tag.define("environment", t.tagName),
  reference: Tag.define("reference", t.labelName),
  math: Tag.define("math", t.string),
} as const;

const ROLE_TAGS: Readonly<Record<SyntaxRole, readonly Tag[]>> = {
  command: [t.keyword, t.tagName, t.function(t.variableName)],
  structure: [t.definitionKeyword, t.moduleKeyword, t.typeName],
  heading: [t.heading],
  formatting: [syntaxTags.formatting],
  environment: [syntaxTags.environment],
  reference: [syntaxTags.reference, t.labelName],
  math: [syntaxTags.math],
  value: [t.string, t.number, t.bool, t.atom, t.literal, t.null, t.escape, t.attributeValue, t.meta],
  name: [t.variableName, t.propertyName, t.attributeName],
  link: [t.link, t.url],
  symbol: [t.bracket, t.punctuation, t.operator, t.separator],
  comment: [t.comment],
};

const ROLE_STYLE: Partial<Record<SyntaxRole, Readonly<Record<string, string>>>> = {
  comment: { fontStyle: "italic" },
  link: { textDecoration: "underline" },
};

export const editorHighlightStyle = HighlightStyle.define(
  SYNTAX_ROLES.map((role) => ({
    tag: [...ROLE_TAGS[role]],
    color: editorColor(role),
    ...ROLE_STYLE[role],
  })),
);

export const syntaxRoleHighlighter: Highlighter = tagHighlighter(
  SYNTAX_ROLES.flatMap((role) => ROLE_TAGS[role].map((tag) => ({ tag, class: role }))),
);
