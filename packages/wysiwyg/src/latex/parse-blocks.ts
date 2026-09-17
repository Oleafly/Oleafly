import { parse as parseLatexAst } from "@unified-latex/unified-latex-util-parse";
import type { JSONContent } from "@tiptap/core";
import type { Environment, Macro, Node as LatexNode } from "@unified-latex/unified-latex-types";
import { MATH_DISPLAY_ENVIRONMENTS } from "../math/source";
import { splitEnvironmentSource } from "./arguments";
import { parseFigureEnvironment } from "./parse-figure";
import {
  exactSource,
  inlineNodesToJSON,
  macroArgContent,
  macroArguments,
  printRawNode,
  type ParseContext,
} from "./parse-inline";
import { parseTableEnvironment } from "./parse-table";
import { headingLevelForCommand, isSectioningCommand } from "./sectioning";

const BLOCK_MACROS = new Set([
  "appendix",
  "author",
  "bibliography",
  "bibliographystyle",
  "date",
  "keywords",
  "maketitle",
  "tableofcontents",
  "title",
]);

const LIST_ENVIRONMENTS: Record<string, string> = {
  itemize: "bulletList",
  enumerate: "orderedList",
};

const DISPLAY_MATH_ENVIRONMENTS = new Set<string>(MATH_DISPLAY_ENVIRONMENTS);

function environmentName(env: Environment): string {
  const name: unknown = env.env;
  return typeof name === "string" ? name : printRawNode(name as LatexNode);
}

function rawBlock(source: string): JSONContent {
  return { type: "rawBlock", attrs: { source } };
}

function mathDisplayBlock(source: string): JSONContent {
  return { type: "mathDisplay", attrs: { source } };
}

function itemsOf(env: Environment): LatexNode[][] {
  const items: LatexNode[][] = [];
  let current: LatexNode[] | null = null;
  for (const node of env.content) {
    if (node.type === "whitespace" || node.type === "parbreak") continue;
    if (node.type === "macro" && node.content === "item") {
      current = [];
      items.push(current);
      const lastArg = node.args?.[node.args.length - 1];
      if (lastArg?.type === "argument") {
        const start = lastArg.content.findIndex((n) => n.type !== "whitespace");
        if (start !== -1) current.push(...lastArg.content.slice(start));
      }
      continue;
    }
    current?.push(node);
  }
  return items;
}

function isListEnvironment(node: LatexNode): node is Environment {
  return node.type === "environment" && Object.hasOwn(LIST_ENVIRONMENTS, environmentName(node));
}

function listItemBlocks(itemNodes: LatexNode[], context: ParseContext): JSONContent[] {
  const blocks: JSONContent[] = [];
  let inline: LatexNode[] = [];
  const flush = () => {
    while (inline.at(-1)?.type === "whitespace") inline.pop();
    if (inline.length) blocks.push({ type: "paragraph", content: inlineNodesToJSON(inline, context) });
    inline = [];
  };
  for (const node of itemNodes) {
    if (isListEnvironment(node)) {
      flush();
      blocks.push(listEnvironment(node, context));
      continue;
    }
    if (node.type === "parbreak") {
      flush();
      continue;
    }
    if (inline.length > 0 || node.type !== "whitespace") inline.push(node);
  }
  flush();
  if (blocks[0]?.type !== "paragraph") blocks.unshift({ type: "paragraph" });
  return blocks;
}

function listEnvironment(env: Environment, context: ParseContext): JSONContent {
  return {
    type: LIST_ENVIRONMENTS[environmentName(env)],
    content: itemsOf(env).map((itemNodes) => ({
      type: "listItem",
      content: listItemBlocks(itemNodes, context),
    })),
  };
}

function theoremBlock(env: Environment, context: ParseContext): JSONContent {
  const source = exactSource(env, context);
  const parts = splitEnvironmentSource(source);
  if (!parts) return rawBlock(source);
  const bodyContext: ParseContext = { ...context, source: parts.body };
  const blocks = blocksFromNodes(parseLatexAst(parts.body).content, bodyContext);
  return {
    type: "theorem",
    attrs: { environment: environmentName(env), title: parts.optional },
    content: blocks.length ? blocks : [{ type: "paragraph" }],
  };
}

function environmentToJSON(env: Environment, context: ParseContext): JSONContent | null {
  const name = environmentName(env);
  if (name === "quote") {
    return {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: inlineNodesToJSON(
            env.content.filter((n) => n.type !== "parbreak"),
            context,
          ),
        },
      ],
    };
  }
  if (Object.hasOwn(LIST_ENVIRONMENTS, name)) return listEnvironment(env, context);
  if (DISPLAY_MATH_ENVIRONMENTS.has(name)) return mathDisplayBlock(exactSource(env, context));
  if (name === "figure") return parseFigureEnvironment(exactSource(env, context), context);
  if (name === "table" || name === "tabular") return parseTableEnvironment(exactSource(env, context), context);
  if (context.theoremEnvironments.has(name)) return theoremBlock(env, context);
  return null;
}

function headingBlock(node: Macro, context: ParseContext): JSONContent {
  const command = node.content;
  const args = macroArguments(node, context);
  const titleNodes = macroArgContent(node, (node.args?.length ?? 1) - 1);
  const content = inlineNodesToJSON(titleNodes, context);
  return {
    type: "heading",
    attrs: {
      level: isSectioningCommand(command) ? headingLevelForCommand(command) : 1,
      command,
      starred: args.starred,
      shortTitle: args.optional,
    },
    ...(content.length ? { content } : {}),
  };
}

function macroBlock(node: Macro, context: ParseContext): JSONContent | null {
  if (isSectioningCommand(node.content)) return headingBlock(node, context);
  if (BLOCK_MACROS.has(node.content)) return rawBlock(printRawNode(node));
  return null;
}

function blockNode(node: LatexNode, context: ParseContext): JSONContent | null {
  if (node.type === "comment") return rawBlock(printRawNode(node));
  if (node.type === "macro") return macroBlock(node, context);
  if (node.type === "environment") return environmentToJSON(node, context) ?? rawBlock(printRawNode(node));
  if (node.type === "mathenv") {
    return DISPLAY_MATH_ENVIRONMENTS.has(environmentName(node))
      ? mathDisplayBlock(exactSource(node, context))
      : rawBlock(printRawNode(node));
  }
  return null;
}

export function blocksFromNodes(nodes: LatexNode[], context: ParseContext): JSONContent[] {
  const content: JSONContent[] = [];
  let paragraphBuffer: LatexNode[] = [];
  const flushParagraph = () => {
    while (paragraphBuffer.at(-1)?.type === "whitespace") paragraphBuffer.pop();
    if (paragraphBuffer.length === 0) return;
    content.push({ type: "paragraph", content: inlineNodesToJSON(paragraphBuffer, context) });
    paragraphBuffer = [];
  };
  for (const node of nodes) {
    if (node.type === "whitespace") {
      if (paragraphBuffer.length > 0) paragraphBuffer.push(node);
      continue;
    }
    if (node.type === "parbreak") {
      flushParagraph();
      continue;
    }
    const block = blockNode(node, context);
    if (block) {
      flushParagraph();
      content.push(block);
      continue;
    }
    paragraphBuffer.push(node);
  }
  flushParagraph();
  return content;
}
