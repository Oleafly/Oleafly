import { noop } from 'motion-utils';
import { addToQueue } from './queue.mjs';

class ViewTransitionBuilder {
    constructor(update, options = {}) {
        this.currentSubject = "root";
        this.targets = new Map();
        /**
         * Definitions that must be resolved to elements (and assigned a
         * `view-transition-name`) rather than treated as pre-named layers.
         */
        this.resolveDefs = new Set();
        /**
         * Per-subject crop override: `true` forces the crop (clip + object-fit:
         * cover + animated corner radii) on, `false` forces it off. A subject with
         * no entry uses the default - crop only a genuine morph (a layer present in
         * both snapshots), so a fade-only enter/exit isn't clipped to nothing.
         */
        this.cropOverride = new Map();
        /**
         * Subjects paired with a different new-snapshot target (the second `.add()`
         * argument), so two distinct elements share one name and morph into each
         * other - a shared-element transition.
         */
        this.pairs = new Map();
        /**
         * A `view-transition-class` to apply to each subject's resolved elements,
         * so authors can target the generated layers from CSS by class rather than
         * the opaque generated name.
         */
        this.classNames = new Map();
        /**
         * Subjects opted out of automatic group nesting via `.group(false)`. Their
         * layer stays a flat top-level group (`view-transition-group: none`) instead
         * of nesting under its DOM-ancestor layer - so it animates independently and
         * escapes an ancestor's clip/transform (e.g. an element that lifts out of a
         * card and flies across, which nesting would clip to the card).
         */
        this.flatGroups = new Set();
        this.notifyReady = noop;
        this.notifyReject = noop;
        this.readyPromise = new Promise((resolve, reject) => {
            this.notifyReady = resolve;
            this.notifyReject = reject;
        });
        this.update = update;
        this.options = {
            interrupt: "wait",
            ...options,
        };
        // Avoid an unhandled rejection when a failed transition has no
        // `.then(_, reject)` handler attached (e.g. fire-and-forget).
        this.readyPromise.catch(noop);
        addToQueue(this);
    }
    /**
     * Target elements resolved from a selector or Element, each assigned a
     * `view-transition-name` automatically.
     *
     * Passing a second target pairs them: the first is resolved in the old
     * snapshot and the second in the new, sharing one name so two *different*
     * elements morph into each other (e.g. `.add(card, ".modal")`). Symmetric -
     * pass them the other way round to morph back.
     */
    add(subject, newSubject) {
        this.currentSubject = subject;
        this.resolveDefs.add(subject);
        if (newSubject !== undefined)
            this.pairs.set(subject, newSubject);
        // Register the subject so it participates (and gets an automatic
        // layout/morph animation) even without an explicit enter/exit/layout.
        if (!this.targets.has(subject))
            this.targets.set(subject, {});
        return this;
    }
    /**
     * Control this subject's crop (clip + `object-fit: cover` + animated
     * corners). By default a subject auto-crops only when it actually morphs -
     * present in both snapshots (a survivor, or an `.add(a, b)` pair). A
     * fade-only enter/exit has no second box to crop against, so it's left to
     * the browser default; in particular the `overflow: clip` a crop adds would
     * otherwise clip a mis-sized enter/exit layer to nothing.
     *
     * `.crop(false)` forces the crop off (e.g. a text morph, where
     * `object-fit: cover` clips glyphs as the box grows); `.crop(true)` forces
     * it on for a non-morph the default wouldn't otherwise crop.
     */
    crop(enabled = true) {
        this.cropOverride.set(this.currentSubject, enabled);
        return this;
    }
    /**
     * By default a subject's layer nests under its nearest DOM-ancestor layer
     * (`view-transition-group: contain`), so the ancestor's clip/transform/opacity
     * apply to it through the transition - mirroring how the DOM actually paints,
     * and letting a wrapper crop its child for the whole morph rather than only
     * once the live DOM takes back over. (Needs a browser that supports nested
     * view-transition groups; elsewhere it degrades to the flat default.)
     *
     * Call `.group(false)` to opt out: the layer stays flat and top-level, so it
     * animates independently and escapes an ancestor's clip - e.g. an element
     * that should lift out of a card and fly across, which nesting would clip.
     */
    group(enabled = true) {
        enabled
            ? this.flatGroups.delete(this.currentSubject)
            : this.flatGroups.add(this.currentSubject);
        return this;
    }
    /**
     * Tag this subject's generated layers with a `view-transition-class`, so
     * they can be targeted from CSS - `::view-transition-group(.name)`,
     * `::view-transition-old/new(.name)`, `::view-transition-image-pair(.name)`
     * - without the opaque generated `view-transition-name`. Because `.add()`
     * can match many elements, a shared class targets them all at once (and,
     * for a pair, both ends). The escape hatch for z-index / custom keyframes
     * on a morph layer.
     */
    class(name) {
        this.classNames.set(this.currentSubject, name);
        return this;
    }
    /**
     * Set the transition for this subject's morph. The morph is enabled
     * automatically by `.add()`; this just customises its timing (duration,
     * easing, a `delay`/`stagger`, …). On the implicit `root` subject it also
     * opts the page into the transition (the root crossfade).
     */
    layout(options = {}) {
        this.updateTarget("layout", {}, options);
        return this;
    }
    enter(keyframes, options) {
        this.updateTarget("enter", keyframes, options);
        return this;
    }
    exit(keyframes, options) {
        this.updateTarget("exit", keyframes, options);
        return this;
    }
    /**
     * Animate the new view directly, whether the element is appearing or
     * persisting (unlike `.enter()`, which only fires for a pure newcomer).
     * Pair with `.old()` for a crossfade or slide-through.
     */
    new(keyframes, options) {
        this.updateTarget("new", keyframes, options);
        return this;
    }
    /**
     * Animate the old view directly, whether the element is leaving or
     * persisting (unlike `.exit()`, which only fires for a pure leaver).
     */
    old(keyframes, options) {
        this.updateTarget("old", keyframes, options);
        return this;
    }
    updateTarget(target, keyframes, options = {}) {
        const { currentSubject, targets } = this;
        if (!targets.has(currentSubject)) {
            targets.set(currentSubject, {});
        }
        const targetData = targets.get(currentSubject);
        targetData[target] = { keyframes, options };
    }
    then(resolve, reject) {
        return this.readyPromise.then(resolve, reject);
    }
}
function animateView(update, options = {}) {
    return new ViewTransitionBuilder(update, options);
}

export { ViewTransitionBuilder, animateView };
//# sourceMappingURL=index.mjs.map
