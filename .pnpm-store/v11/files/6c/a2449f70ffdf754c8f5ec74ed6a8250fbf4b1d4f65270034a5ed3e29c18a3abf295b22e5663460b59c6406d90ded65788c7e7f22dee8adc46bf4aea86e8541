function getViewAnimations() {
    return document.getAnimations().filter((animation) => {
        const { effect } = animation;
        return (!!effect &&
            effect.target === document.documentElement &&
            effect.pseudoElement?.startsWith("::view-transition"));
    });
}

export { getViewAnimations };
//# sourceMappingURL=get-view-animations.mjs.map
