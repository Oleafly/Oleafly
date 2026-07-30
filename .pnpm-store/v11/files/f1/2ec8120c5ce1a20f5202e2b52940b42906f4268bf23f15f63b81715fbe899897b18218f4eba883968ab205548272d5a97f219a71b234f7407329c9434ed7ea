// src/placeholder/constants.ts
import { PluginKey } from "@tiptap/pm/state";
var DEFAULT_DATA_ATTRIBUTE = "placeholder";
var PLUGIN_KEY = new PluginKey("tiptap__placeholder");

// src/placeholder/placeholder.ts
import { Extension } from "@tiptap/core";

// src/placeholder/plugins/PlaceholderPlugin.ts
import { Plugin } from "@tiptap/pm/state";
import { DecorationSet as DecorationSet3 } from "@tiptap/pm/view";

// src/placeholder/utils/buildPlaceholderDecorations.ts
import { isNodeEmpty } from "@tiptap/core";
import { DecorationSet } from "@tiptap/pm/view";

// src/placeholder/utils/createPlaceholderDecoration.ts
import { Decoration } from "@tiptap/pm/view";
function createPlaceholderDecoration(options) {
  const {
    editor,
    placeholder,
    dataAttribute,
    pos,
    node,
    isEmptyDoc,
    hasAnchor,
    classes: { emptyNode, emptyEditor }
  } = options;
  const classes = [emptyNode];
  if (isEmptyDoc) {
    classes.push(emptyEditor);
  }
  return Decoration.node(pos, pos + node.nodeSize, {
    class: classes.join(" "),
    [dataAttribute]: typeof placeholder === "function" ? placeholder({
      editor,
      node,
      pos,
      hasAnchor
    }) : placeholder
  });
}

// src/placeholder/utils/buildPlaceholderDecorations.ts
function resolveEmptyNodeClass(emptyNodeClass, props) {
  return typeof emptyNodeClass === "function" ? emptyNodeClass(props) : emptyNodeClass;
}
function scanRangeForDecorations({
  editor,
  options,
  dataAttribute,
  doc,
  selection,
  from,
  to
}) {
  const { anchor } = selection;
  const decorations = [];
  const isEmptyDoc = editor.isEmpty;
  doc.nodesBetween(from, to, (node, pos) => {
    const hasAnchor = anchor >= pos && anchor <= pos + node.nodeSize;
    const isEmpty = !node.isLeaf && isNodeEmpty(node);
    if (!node.type.isTextblock) {
      return options.includeChildren;
    }
    if ((hasAnchor || !options.showOnlyCurrent) && isEmpty) {
      decorations.push(
        createPlaceholderDecoration({
          editor,
          isEmptyDoc,
          dataAttribute,
          hasAnchor,
          placeholder: options.placeholder,
          classes: {
            emptyEditor: options.emptyEditorClass,
            emptyNode: resolveEmptyNodeClass(options.emptyNodeClass, {
              editor,
              node,
              pos,
              hasAnchor
            })
          },
          node,
          pos
        })
      );
    }
    return options.includeChildren;
  });
  return decorations;
}
function buildPlaceholderDecorations({
  editor,
  options,
  dataAttribute,
  doc,
  selection
}) {
  const active = editor.isEditable || !options.showOnlyWhenEditable;
  if (!active) {
    return null;
  }
  const { anchor } = selection;
  const decorations = [];
  const isEmptyDoc = editor.isEmpty;
  const useResolvedPath = options.showOnlyCurrent && !options.includeChildren;
  if (useResolvedPath) {
    const resolved = doc.resolve(anchor);
    const node = resolved.depth > 0 ? resolved.node(1) : resolved.nodeAfter;
    const nodeStart = resolved.depth > 0 ? resolved.before(1) : anchor;
    if (node && node.type.isTextblock && isNodeEmpty(node)) {
      const hasAnchor = anchor >= nodeStart && anchor <= nodeStart + node.nodeSize;
      decorations.push(
        createPlaceholderDecoration({
          editor,
          isEmptyDoc,
          dataAttribute,
          hasAnchor,
          placeholder: options.placeholder,
          classes: {
            emptyEditor: options.emptyEditorClass,
            emptyNode: resolveEmptyNodeClass(options.emptyNodeClass, {
              editor,
              node,
              pos: nodeStart,
              hasAnchor
            })
          },
          node,
          pos: nodeStart
        })
      );
    }
  } else {
    decorations.push(
      ...scanRangeForDecorations({
        editor,
        options,
        dataAttribute,
        doc,
        selection,
        from: 0,
        to: doc.content.size
      })
    );
  }
  return DecorationSet.create(doc, decorations);
}

// src/placeholder/utils/placeholderStateField.ts
import { getChangedRanges } from "@tiptap/core";
import { DecorationSet as DecorationSet2 } from "@tiptap/pm/view";

// src/placeholder/utils/resolveTopLevelRange.ts
function resolveTopLevelRange(doc, pos) {
  var _a;
  const resolved = doc.resolve(pos);
  if (resolved.depth === 0) {
    const node2 = (_a = resolved.nodeAfter) != null ? _a : resolved.nodeBefore;
    if (!node2) {
      return { from: pos, to: pos };
    }
    const nodePos = resolved.nodeAfter ? pos : pos - node2.nodeSize;
    return { from: nodePos, to: nodePos + node2.nodeSize };
  }
  const topLevelPos = resolved.before(1);
  const node = resolved.node(1);
  return { from: topLevelPos, to: topLevelPos + node.nodeSize };
}
function toContentRelativeRange(doc, range) {
  return {
    from: Math.max(0, range.from - 1),
    to: Math.min(doc.content.size, range.to - 1)
  };
}
function getTopLevelBlocksInRange(doc, from, to) {
  const ranges = [];
  doc.forEach((node, offset) => {
    const nodeStart = offset;
    const nodeEnd = nodeStart + node.nodeSize;
    const absNodeStart = nodeStart + 1;
    const absNodeEnd = nodeEnd + 1;
    if (absNodeStart < to && absNodeEnd > from) {
      ranges.push({ from: nodeStart, to: nodeEnd });
    }
  });
  return ranges;
}
function mergeRanges(ranges) {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.from <= last.to) {
      last.to = Math.max(last.to, current.to);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

// src/placeholder/utils/placeholderStateField.ts
function collectBlocksForChange(doc, change) {
  const ranges = getTopLevelBlocksInRange(doc, change.from, change.to);
  ranges.push(toContentRelativeRange(doc, resolveTopLevelRange(doc, change.from)));
  if (change.to > change.from) {
    ranges.push(
      toContentRelativeRange(
        doc,
        resolveTopLevelRange(doc, Math.min(change.to, doc.content.size + 1) - 1)
      )
    );
  } else if (change.from < doc.content.size + 1) {
    ranges.push(
      toContentRelativeRange(
        doc,
        resolveTopLevelRange(doc, Math.min(change.from + 1, doc.content.size))
      )
    );
  }
  return ranges;
}
function collectRescanRanges(tr, oldState, newState) {
  const ranges = [];
  if (tr.docChanged) {
    const changes = getChangedRanges(tr);
    for (const change of changes) {
      ranges.push(...collectBlocksForChange(newState.doc, change.newRange));
    }
  }
  if (tr.selectionSet) {
    ranges.push(
      toContentRelativeRange(
        newState.doc,
        resolveTopLevelRange(newState.doc, tr.mapping.map(oldState.selection.anchor))
      )
    );
    ranges.push(
      toContentRelativeRange(
        newState.doc,
        resolveTopLevelRange(newState.doc, newState.selection.anchor)
      )
    );
  }
  return mergeRanges(ranges);
}
function clampRange(from, to, doc) {
  const clampedFrom = Math.max(0, Math.min(from, doc.content.size));
  const clampedTo = Math.max(clampedFrom, Math.min(to, doc.content.size));
  return { from: clampedFrom, to: clampedTo };
}
function updateDecorationsInRanges({
  decorations,
  ranges,
  editor,
  options,
  dataAttribute,
  doc,
  selection
}) {
  let next = decorations;
  for (const range of ranges) {
    const { from, to } = clampRange(range.from, range.to, doc);
    const existing = next.find(from, to).filter((decoration) => decoration.from >= from && decoration.to <= to);
    if (existing.length) {
      next = next.remove(existing);
    }
    const newDecos = scanRangeForDecorations({
      editor,
      options,
      dataAttribute,
      doc,
      selection,
      from,
      to
    });
    if (newDecos.length) {
      next = next.add(doc, newDecos);
    }
  }
  return next;
}
function createPlaceholderStateField({
  editor,
  options,
  dataAttribute
}) {
  return {
    init(_config, state) {
      const decorations = buildPlaceholderDecorations({
        editor,
        options,
        dataAttribute,
        doc: state.doc,
        selection: state.selection
      });
      return decorations != null ? decorations : DecorationSet2.empty;
    },
    apply(tr, prev, oldState, newState) {
      if (!tr.docChanged && !tr.selectionSet) {
        return prev;
      }
      const mapped = prev.map(tr.mapping, tr.doc);
      const ranges = collectRescanRanges(tr, oldState, newState);
      return updateDecorationsInRanges({
        decorations: mapped,
        ranges,
        editor,
        options,
        dataAttribute,
        doc: newState.doc,
        selection: newState.selection
      });
    }
  };
}

// src/placeholder/utils/preparePlaceholderAttribute.ts
function preparePlaceholderAttribute(attr) {
  return attr.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").replace(/^[0-9-]+/, "").replace(/^-+/, "").toLowerCase();
}

// src/placeholder/plugins/PlaceholderPlugin.ts
function createPlaceholderPlugin({ editor, options }) {
  const dataAttribute = options.dataAttribute ? `data-${preparePlaceholderAttribute(options.dataAttribute)}` : `data-${DEFAULT_DATA_ATTRIBUTE}`;
  const useResolvedPath = options.showOnlyCurrent && !options.includeChildren;
  return new Plugin({
    key: PLUGIN_KEY,
    ...useResolvedPath ? {} : {
      state: createPlaceholderStateField({ editor, options, dataAttribute })
    },
    props: {
      decorations: useResolvedPath ? ({ doc, selection }) => buildPlaceholderDecorations({ editor, options, dataAttribute, doc, selection }) : (state) => {
        var _a;
        if (options.showOnlyWhenEditable && !editor.isEditable) {
          return DecorationSet3.empty;
        }
        return (_a = PLUGIN_KEY.getState(state)) != null ? _a : DecorationSet3.empty;
      }
    }
  });
}

// src/placeholder/placeholder.ts
var Placeholder = Extension.create({
  name: "placeholder",
  addOptions() {
    return {
      emptyEditorClass: "is-editor-empty",
      emptyNodeClass: "is-empty",
      dataAttribute: DEFAULT_DATA_ATTRIBUTE,
      placeholder: "Write something \u2026",
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false
    };
  },
  addProseMirrorPlugins() {
    return [createPlaceholderPlugin({ editor: this.editor, options: this.options })];
  }
});
export {
  DEFAULT_DATA_ATTRIBUTE,
  PLUGIN_KEY,
  Placeholder,
  preparePlaceholderAttribute
};
//# sourceMappingURL=index.js.map