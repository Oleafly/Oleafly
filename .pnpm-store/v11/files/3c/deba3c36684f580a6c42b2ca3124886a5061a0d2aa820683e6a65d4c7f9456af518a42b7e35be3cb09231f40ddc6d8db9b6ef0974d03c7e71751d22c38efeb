# prosemirror-dropcursor

[ [**WEBSITE**](https://prosemirror.net) | [**ISSUES**](https://code.haverbeke.berlin/prosemirror/prosemirror-dropcursor/issues) | [**FORUM**](https://discuss.prosemirror.net) | [**CHANGELOG**](https://code.haverbeke.berlin/prosemirror/prosemirror-dropcursor/src/branch/main/CHANGELOG.md) ]

This is a non-core example module for [ProseMirror](https://prosemirror.net).
ProseMirror is a well-behaved rich semantic content editor based on
contentEditable, with support for collaborative editing and custom
document schemas.

This module implements a plugin that shows a drop cursor for
ProseMirror.

The [project page](https://prosemirror.net) has more information, a
number of [examples](https://prosemirror.net/examples/) and the
[documentation](https://prosemirror.net/docs/).

This code is released under an
[MIT license](https://code.haverbeke.berlin/prosemirror/prosemirror/src/branch/main/LICENSE).
There's a [forum](http://discuss.prosemirror.net) for general
discussion and support requests, and the
[bug tracker](https://code.haverbeke.berlin/prosemirror/prosemirror/issues)
is the place to report issues.

We aim to be an inclusive, welcoming community. To make that explicit,
we have a [code of
conduct](http://contributor-covenant.org/version/1/1/0/) that applies
to communication around the project.

## Documentation

* **`dropCursor`**`(options?: interface = {}) → Plugin`\
   Create a plugin that, when added to a ProseMirror instance,
   causes a decoration to show up at the drop position when something
   is dragged over the editor.

   Nodes may add a `disableDropCursor` property to their spec to
   control the showing of a drop cursor inside them. This may be a
   boolean or a function, which will be called with a view, a
   position, and the DragEvent, and should return a boolean.

    * **`options`**

       * **`color`**`?: string`\
         The color of the cursor. Defaults to `black`.

       * **`width`**`?: number`\
         The precise width of the cursor in pixels. Defaults to 1.

       * **`class`**`?: string`\
         A CSS class name to add to the cursor element.
