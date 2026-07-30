import { SKIP, visit } from "unist-util-visit";
import { isElement } from "hast-util-is-element";
import { fromHtml } from "hast-util-from-html";
import octicons from "@primer/octicons";
let internalOptions;
const rehypeGithubAlerts = (options) => {
  const defaultOptions = {
    supportLegacy: false,
    // octicons docs: https://github.com/primer/octicons/tree/main/lib/octicons_node
    alerts: [
      {
        keyword: "NOTE",
        icon: `<svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">${String(octicons["info"].heights[16]?.path)}</svg>`,
        title: "Note"
      },
      {
        keyword: "IMPORTANT",
        icon: `<svg class="octicon octicon-report mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">${String(octicons["report"].heights[16]?.path)}</svg>`,
        title: "Important"
      },
      {
        keyword: "WARNING",
        icon: `<svg class="octicon octicon-alert mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">${String(octicons["alert"].heights[16]?.path)}</svg>`,
        title: "Warning"
      },
      {
        keyword: "TIP",
        icon: `<svg class="octicon octicon-light-bulb mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">${String(octicons["light-bulb"].heights[16]?.path)}</svg>`,
        title: "Tip"
      },
      {
        keyword: "CAUTION",
        icon: `<svg class="octicon octicon-stop mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">${String(octicons["stop"].heights[16]?.path)}</svg>`,
        title: "Caution"
      }
    ]
  };
  internalOptions = Object.assign({}, defaultOptions, options);
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      create(node, index, parent);
    });
  };
};
const create = (node, index, parent) => {
  if (node.tagName !== "blockquote") {
    return [SKIP];
  }
  if (node.children.length < 1) {
    return [SKIP];
  }
  const firstParagraph = node.children.find((child) => {
    return child.type === "element" && child.tagName === "p";
  });
  if (!isElement(firstParagraph)) {
    return [SKIP];
  }
  const headerData = extractHeaderData(firstParagraph);
  if (headerData === null) {
    return [SKIP];
  }
  if (headerData.rest.trim() !== "") {
    if (!headerData.rest.startsWith("\n") && !headerData.rest.startsWith("\r")) {
      return [SKIP];
    }
  }
  const alertOptions = getAlertOptions(headerData.alertType);
  if (alertOptions === null) {
    return [SKIP];
  }
  if (!parent || typeof index !== "number") {
    return [SKIP];
  }
  const build = internalOptions.build ?? defaultBuild;
  const alertBodyChildren = [];
  const remainingFirstParagraphChildren = firstParagraph.children.slice(1, firstParagraph.children.length);
  const newFirstParagraphChildren = [];
  const rest = headerData.rest.replace(/^(\r\n|\r|\n)/, "");
  if (rest === "" && remainingFirstParagraphChildren.length === 0 && node.children.length < 4) {
    return [SKIP];
  }
  if (remainingFirstParagraphChildren.length > 0) {
    if (remainingFirstParagraphChildren[0].type === "element" && remainingFirstParagraphChildren[0].tagName === "br") {
      const remainingChildrenWithoutLineBreak = remainingFirstParagraphChildren.slice(2, firstParagraph.children.length);
      newFirstParagraphChildren.push(...remainingChildrenWithoutLineBreak);
    } else {
      if (rest !== "") {
        const restAsTextNode = {
          type: "text",
          value: rest
        };
        remainingFirstParagraphChildren.unshift(restAsTextNode);
      }
      newFirstParagraphChildren.push(...remainingFirstParagraphChildren);
    }
  } else {
    if (rest !== "") {
      const restAsTextNode = {
        type: "text",
        value: rest
      };
      newFirstParagraphChildren.push(restAsTextNode);
    }
  }
  if (newFirstParagraphChildren.length > 0) {
    const paragraphElement = {
      type: "element",
      tagName: "p",
      properties: {},
      children: newFirstParagraphChildren
    };
    alertBodyChildren.push(paragraphElement);
  }
  if (node.children.length > 2) {
    alertBodyChildren.push(...node.children.slice(2, node.children.length));
  }
  const alertElement = build(alertOptions, alertBodyChildren);
  if (alertElement !== null) {
    parent.children[index] = alertElement;
  }
  return [SKIP];
};
const defaultBuild = (alertOptions, originalChildren) => {
  let alertIconElement;
  if (isElement(alertOptions.icon)) {
    alertIconElement = alertOptions.icon;
  } else {
    const alertIcon = fromHtml(
      alertOptions.icon,
      { fragment: true }
    ).children[0];
    if (isElement(alertIcon)) {
      alertIconElement = alertIcon;
    }
  }
  if (typeof alertIconElement === "undefined") {
    return null;
  }
  const titleElementContent = {
    type: "text",
    value: alertOptions.title
  };
  const alert = {
    type: "element",
    tagName: "div",
    properties: {
      className: [
        "markdown-alert",
        `markdown-alert-${alertOptions.keyword.toLowerCase()}`
      ]
    },
    children: [
      {
        type: "element",
        tagName: "p",
        properties: {
          className: [
            "markdown-alert-title"
          ]
        },
        children: [
          alertIconElement,
          titleElementContent
        ]
      },
      ...originalChildren
    ]
  };
  return alert;
};
const extractHeaderData = (paragraph) => {
  const header = paragraph.children[0];
  let alertType;
  let rest = "";
  if (internalOptions.supportLegacy) {
    if (header.type === "element" && header.tagName === "strong") {
      if (header.children[0].type === "text") {
        alertType = header.children[0].value;
      }
    }
  }
  if (header.type === "text") {
    const match = /\[!(.*?)\]/.exec(header.value);
    if (!match?.input) {
      return null;
    }
    if (match.input.length > match[0].length) {
      rest = match.input.replace(match[0], "");
    }
    alertType = match[1];
  }
  if (typeof alertType === "undefined") {
    return null;
  }
  return { alertType, rest };
};
const getAlertOptions = (alertType) => {
  const alertOptions = internalOptions.alerts.find((alert) => {
    return alertType.toUpperCase() === alert.keyword.toUpperCase();
  });
  return alertOptions ?? null;
};
export {
  defaultBuild,
  rehypeGithubAlerts
};
