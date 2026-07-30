'use strict';

var React = require('react');
var jsxRuntime = require('react/jsx-runtime');

/**
 * Rounds number to given decimal
 * eg. roundNumber(2.34343, 1) => 2.3
 */
var roundNumber = function (num, decimal) {
    return Number(num.toFixed(decimal));
};
/**
 * Checks if value is number, if not it returns default value
 * 1# eg. checkIsNumber(2, 30) => 2
 * 2# eg. checkIsNumber(null, 30) => 30
 */
var checkIsNumber = function (num, defaultValue) {
    return typeof num === "number" ? num : defaultValue;
};

var handleCallback = function (context, event, callback) {
    if (callback && typeof callback === "function") {
        callback(context, event);
    }
};

/* eslint-disable no-plusplus */
/* eslint-disable no-param-reassign */
/**
 * Functions should return denominator of the target value, which is the next animation step.
 * t is a value from 0 to 1, reflecting the percentage of animation status.
 */
var easeOut = function (t) {
    return -Math.cos(t * Math.PI) / 2 + 0.5;
};
// linear
var linear = function (t) {
    return t;
};
// accelerating from zero velocity
var easeInQuad = function (t) {
    return t * t;
};
// decelerating to zero velocity
var easeOutQuad = function (t) {
    return t * (2 - t);
};
// acceleration until halfway, then deceleration
var easeInOutQuad = function (t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
};
// accelerating from zero velocity
var easeInCubic = function (t) {
    return t * t * t;
};
// decelerating to zero velocity
var easeOutCubic = function (t) {
    return --t * t * t + 1;
};
// acceleration until halfway, then deceleration
var easeInOutCubic = function (t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
};
// accelerating from zero velocity
var easeInQuart = function (t) {
    return t * t * t * t;
};
// decelerating to zero velocity
var easeOutQuart = function (t) {
    return 1 - --t * t * t * t;
};
// acceleration until halfway, then deceleration
var easeInOutQuart = function (t) {
    return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t;
};
// accelerating from zero velocity
var easeInQuint = function (t) {
    return t * t * t * t * t;
};
// decelerating to zero velocity
var easeOutQuint = function (t) {
    return 1 + --t * t * t * t * t;
};
// acceleration until halfway, then deceleration
var easeInOutQuint = function (t) {
    return t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t;
};
var animations = {
    easeOut: easeOut,
    linear: linear,
    easeInQuad: easeInQuad,
    easeOutQuad: easeOutQuad,
    easeInOutQuad: easeInOutQuad,
    easeInCubic: easeInCubic,
    easeOutCubic: easeOutCubic,
    easeInOutCubic: easeInOutCubic,
    easeInQuart: easeInQuart,
    easeOutQuart: easeOutQuart,
    easeInOutQuart: easeInOutQuart,
    easeInQuint: easeInQuint,
    easeOutQuint: easeOutQuint,
    easeInOutQuint: easeInOutQuint,
};

/* eslint-disable no-param-reassign */
var handleCancelAnimationFrame = function (animation) {
    if (typeof animation === "number") {
        cancelAnimationFrame(animation);
    }
};
var handleCancelAnimation = function (contextInstance) {
    if (!contextInstance.mounted)
        return;
    handleCancelAnimationFrame(contextInstance.animation);
    // Clear animation state
    contextInstance.isAnimating = false;
    contextInstance.animation = null;
    contextInstance.velocity = null;
};
function handleSetupAnimation(contextInstance, animationName, animationTime, callback) {
    if (!contextInstance.mounted)
        return;
    var startTime = new Date().getTime();
    var lastStep = 1;
    // if another animation is active
    handleCancelAnimation(contextInstance);
    // new animation
    contextInstance.animation = function () {
        if (!contextInstance.mounted) {
            return handleCancelAnimationFrame(contextInstance.animation);
        }
        var frameTime = new Date().getTime() - startTime;
        var animationProgress = frameTime / animationTime;
        var animationType = animations[animationName];
        var step = animationType(animationProgress);
        if (frameTime >= animationTime) {
            callback(lastStep);
            contextInstance.animation = null;
        }
        else if (contextInstance.animation) {
            callback(step);
            requestAnimationFrame(contextInstance.animation);
        }
    };
    requestAnimationFrame(contextInstance.animation);
}
function isValidTargetState(targetState) {
    var scale = targetState.scale, positionX = targetState.positionX, positionY = targetState.positionY;
    if (Number.isNaN(scale) ||
        Number.isNaN(positionX) ||
        Number.isNaN(positionY)) {
        return false;
    }
    return true;
}
function animate(contextInstance, targetState, animationTime, animationName) {
    var isValid = isValidTargetState(targetState);
    if (!contextInstance.mounted || !isValid)
        return;
    var setState = contextInstance.setState;
    var _a = contextInstance.state, scale = _a.scale, positionX = _a.positionX, positionY = _a.positionY;
    var scaleDiff = targetState.scale - scale;
    var positionXDiff = targetState.positionX - positionX;
    var positionYDiff = targetState.positionY - positionY;
    if (animationTime === 0) {
        setState(targetState.scale, targetState.positionX, targetState.positionY);
    }
    else {
        // animation start timestamp
        handleSetupAnimation(contextInstance, animationName, animationTime, function (step) {
            if (step !== 1) {
                contextInstance.isAnimating = true;
            }
            else {
                contextInstance.isAnimating = false;
            }
            var newScale = scale + scaleDiff * step;
            var newPositionX = positionX + positionXDiff * step;
            var newPositionY = positionY + positionYDiff * step;
            setState(newScale, newPositionX, newPositionY);
        });
    }
}

/* eslint-disable no-param-reassign */
function getComponentsSizes(wrapperComponent, contentComponent, newScale) {
    var wrapperWidth = wrapperComponent.offsetWidth;
    var wrapperHeight = wrapperComponent.offsetHeight;
    var contentWidth = contentComponent.offsetWidth;
    var contentHeight = contentComponent.offsetHeight;
    var newContentWidth = contentWidth * newScale;
    var newContentHeight = contentHeight * newScale;
    var newDiffWidth = wrapperWidth - newContentWidth;
    var newDiffHeight = wrapperHeight - newContentHeight;
    return {
        wrapperWidth: wrapperWidth,
        wrapperHeight: wrapperHeight,
        newContentWidth: newContentWidth,
        newDiffWidth: newDiffWidth,
        newContentHeight: newContentHeight,
        newDiffHeight: newDiffHeight,
    };
}
var getBounds = function (wrapperWidth, newContentWidth, diffWidth, wrapperHeight, newContentHeight, diffHeight, centerZoomedOut) {
    var scaleWidthFactor = wrapperWidth > newContentWidth
        ? diffWidth * (centerZoomedOut ? 0.5 : 1)
        : 0;
    var scaleHeightFactor = wrapperHeight > newContentHeight
        ? diffHeight * (centerZoomedOut ? 0.5 : 1)
        : 0;
    var minPositionX = wrapperWidth - newContentWidth - scaleWidthFactor;
    var maxPositionX = scaleWidthFactor;
    var minPositionY = wrapperHeight - newContentHeight - scaleHeightFactor;
    var maxPositionY = scaleHeightFactor;
    return {
        minPositionX: minPositionX,
        maxPositionX: maxPositionX,
        minPositionY: minPositionY,
        maxPositionY: maxPositionY,
        scaleWidthFactor: scaleWidthFactor,
        scaleHeightFactor: scaleHeightFactor,
    };
};
var calculateBounds = function (contextInstance, newScale) {
    var wrapperComponent = contextInstance.wrapperComponent, contentComponent = contextInstance.contentComponent;
    var _a = contextInstance.setup, centerZoomedOut = _a.centerZoomedOut, disablePadding = _a.disablePadding;
    if (!wrapperComponent || !contentComponent) {
        throw new Error("Components are not mounted");
    }
    var _b = getComponentsSizes(wrapperComponent, contentComponent, newScale), wrapperWidth = _b.wrapperWidth, wrapperHeight = _b.wrapperHeight, newContentWidth = _b.newContentWidth, newContentHeight = _b.newContentHeight, newDiffWidth = _b.newDiffWidth, newDiffHeight = _b.newDiffHeight;
    var bounds = getBounds(wrapperWidth, newContentWidth, newDiffWidth, wrapperHeight, newContentHeight, newDiffHeight, Boolean(centerZoomedOut));
    var contentFitsCompletely = wrapperWidth >= newContentWidth && wrapperHeight >= newContentHeight;
    if (disablePadding && contentFitsCompletely && !centerZoomedOut) {
        bounds.minPositionX = 0;
        bounds.maxPositionX = 0;
        bounds.minPositionY = 0;
        bounds.maxPositionY = 0;
    }
    var _c = contextInstance.setup, propMinX = _c.minPositionX, propMaxX = _c.maxPositionX, propMinY = _c.minPositionY, propMaxY = _c.maxPositionY;
    // Explicit position props define content-space boundaries at scale=1.
    // Scale them so the same content region stays reachable at every zoom level.
    if (propMinX != null) {
        bounds.minPositionX = wrapperWidth * (1 - newScale) + propMinX * newScale;
    }
    if (propMaxX != null) {
        bounds.maxPositionX = propMaxX * newScale;
    }
    if (propMinY != null) {
        bounds.minPositionY = wrapperHeight * (1 - newScale) + propMinY * newScale;
    }
    if (propMaxY != null) {
        bounds.maxPositionY = propMaxY * newScale;
    }
    return bounds;
};
/**
 * Keeps value between given bounds, used for limiting view to given boundaries
 * 1# eg. boundLimiter(2, 0, 3, true) => 2
 * 2# eg. boundLimiter(4, 0, 3, true) => 3
 * 3# eg. boundLimiter(-2, 0, 3, true) => 0
 * 4# eg. boundLimiter(10, 0, 3, false) => 10
 */
var boundLimiter = function (value, minBound, maxBound, isActive) {
    if (!isActive)
        return roundNumber(value, 2);
    if (value < minBound)
        return roundNumber(minBound, 2);
    if (value > maxBound)
        return roundNumber(maxBound, 2);
    return roundNumber(value, 2);
};
var handleCalculateBounds = function (contextInstance, newScale) {
    var bounds = calculateBounds(contextInstance, newScale);
    // Save bounds
    contextInstance.bounds = bounds;
    return bounds;
};
function getMouseBoundedPosition(positionX, positionY, bounds, limitToBounds, paddingValueX, paddingValueY, wrapperComponent) {
    var minPositionX = bounds.minPositionX, minPositionY = bounds.minPositionY, maxPositionX = bounds.maxPositionX, maxPositionY = bounds.maxPositionY;
    var paddingX = 0;
    var paddingY = 0;
    if (wrapperComponent) {
        paddingX = paddingValueX;
        paddingY = paddingValueY;
    }
    var x = boundLimiter(positionX, minPositionX - paddingX, maxPositionX + paddingX, limitToBounds);
    var y = boundLimiter(positionY, minPositionY - paddingY, maxPositionY + paddingY, limitToBounds);
    return { x: x, y: y };
}

function handleCalculateZoomPositions(contextInstance, mouseX, mouseY, newScale, bounds, limitToBounds) {
    var _a = contextInstance.state, scale = _a.scale, positionX = _a.positionX, positionY = _a.positionY;
    var scaleDifference = newScale - scale;
    if (typeof mouseX !== "number" || typeof mouseY !== "number") {
        console.error("Mouse X and Y position were not provided!");
        return { x: positionX, y: positionY };
    }
    var calculatedPositionX = positionX - mouseX * scaleDifference;
    var calculatedPositionY = positionY - mouseY * scaleDifference;
    // do not limit to bounds when there is padding animation,
    // it causes animation strange behaviour
    var newPositions = getMouseBoundedPosition(calculatedPositionX, calculatedPositionY, bounds, limitToBounds, 0, 0, null);
    return newPositions;
}
var MIN_SAFE_SCALE = 1e-7;
function checkZoomBounds(zoom, minScale, maxScale, zoomPadding, enablePadding) {
    var scalePadding = enablePadding ? zoomPadding : 0;
    var minScaleWithPadding = Math.max(minScale - scalePadding, MIN_SAFE_SCALE);
    var maxScaleWithPadding = maxScale + scalePadding;
    if (!Number.isNaN(maxScale) && zoom >= maxScaleWithPadding)
        return maxScaleWithPadding;
    if (!Number.isNaN(minScale) && zoom <= minScaleWithPadding)
        return minScaleWithPadding;
    return Math.max(zoom, MIN_SAFE_SCALE);
}

var isPanningStartAllowed = function (contextInstance, event) {
    var excluded = contextInstance.setup.panning.excluded;
    var isInitialized = contextInstance.isInitialized, wrapperComponent = contextInstance.wrapperComponent;
    var target = event.target;
    var targetIsShadowDom = "shadowRoot" in target && "composedPath" in event;
    var isWrapperChild = targetIsShadowDom
        ? event.composedPath().some(function (el) {
            if (!(el instanceof Element)) {
                return false;
            }
            return wrapperComponent === null || wrapperComponent === void 0 ? void 0 : wrapperComponent.contains(el);
        })
        : wrapperComponent === null || wrapperComponent === void 0 ? void 0 : wrapperComponent.contains(target);
    var isAllowed = isInitialized && target && isWrapperChild;
    if (!isAllowed)
        return false;
    var isExcluded = isExcludedNode(target, excluded);
    if (isExcluded)
        return false;
    if (target.getAttribute("draggable") === "true" ||
        target.getAttribute("contenteditable") === "true" ||
        target.isContentEditable) {
        return false;
    }
    return true;
};
var isPanningAllowed = function (contextInstance) {
    var isInitialized = contextInstance.isInitialized, isPanning = contextInstance.isPanning, setup = contextInstance.setup;
    var disabled = setup.panning.disabled;
    var isAllowed = isInitialized && isPanning && !disabled;
    if (!isAllowed)
        return false;
    return true;
};
var handlePanningSetup = function (contextInstance, event) {
    var _a = contextInstance.state, positionX = _a.positionX, positionY = _a.positionY;
    contextInstance.isPanning = true;
    // Panning with mouse
    var x = event.clientX;
    var y = event.clientY;
    contextInstance.startCoords = { x: x - positionX, y: y - positionY };
};
var handleTouchPanningSetup = function (contextInstance, event) {
    var touches = event.touches;
    var _a = contextInstance.state, positionX = _a.positionX, positionY = _a.positionY;
    contextInstance.isPanning = true;
    // Panning with touch
    var oneFingerTouch = touches.length === 1;
    if (oneFingerTouch) {
        var x = touches[0].clientX;
        var y = touches[0].clientY;
        contextInstance.startCoords = { x: x - positionX, y: y - positionY };
    }
};
function handlePanToBounds(contextInstance) {
    var _a = contextInstance.state, positionX = _a.positionX, positionY = _a.positionY, scale = _a.scale;
    var _b = contextInstance.setup, disabled = _b.disabled, limitToBounds = _b.limitToBounds, centerZoomedOut = _b.centerZoomedOut;
    var wrapperComponent = contextInstance.wrapperComponent;
    if (disabled || !wrapperComponent || !contextInstance.bounds)
        return;
    var _c = contextInstance.bounds, maxPositionX = _c.maxPositionX, minPositionX = _c.minPositionX, maxPositionY = _c.maxPositionY, minPositionY = _c.minPositionY;
    var xChanged = positionX > maxPositionX || positionX < minPositionX;
    var yChanged = positionY > maxPositionY || positionY < minPositionY;
    var mousePosX = positionX > maxPositionX
        ? wrapperComponent.offsetWidth
        : contextInstance.setup.minPositionX || 0;
    var mousePosY = positionY > maxPositionY
        ? wrapperComponent.offsetHeight
        : contextInstance.setup.minPositionY || 0;
    var _d = handleCalculateZoomPositions(contextInstance, mousePosX, mousePosY, scale, contextInstance.bounds, limitToBounds || centerZoomedOut), x = _d.x, y = _d.y;
    return {
        scale: scale,
        positionX: xChanged ? x : positionX,
        positionY: yChanged ? y : positionY,
    };
}
function handleNewPosition(contextInstance, newPositionX, newPositionY, paddingValueX, paddingValueY) {
    var limitToBounds = contextInstance.setup.limitToBounds;
    var wrapperComponent = contextInstance.wrapperComponent, bounds = contextInstance.bounds;
    var _a = contextInstance.state, scale = _a.scale, positionX = _a.positionX, positionY = _a.positionY;
    if (wrapperComponent === null ||
        bounds === null ||
        (newPositionX === positionX && newPositionY === positionY)) {
        return;
    }
    var _b = getMouseBoundedPosition(newPositionX, newPositionY, bounds, limitToBounds, paddingValueX, paddingValueY, wrapperComponent), x = _b.x, y = _b.y;
    contextInstance.setState(scale, x, y);
}
var getPanningClientPosition = function (contextInstance, clientX, clientY) {
    var startCoords = contextInstance.startCoords, state = contextInstance.state;
    var panning = contextInstance.setup.panning;
    var lockAxisX = panning.lockAxisX, lockAxisY = panning.lockAxisY;
    var positionX = state.positionX, positionY = state.positionY;
    if (!startCoords) {
        return { x: positionX, y: positionY };
    }
    var mouseX = clientX - startCoords.x;
    var mouseY = clientY - startCoords.y;
    var newPositionX = lockAxisX ? positionX : mouseX;
    var newPositionY = lockAxisY ? positionY : mouseY;
    return { x: newPositionX, y: newPositionY };
};
var getPaddingValue = function (contextInstance, size, explicitScale) {
    var setup = contextInstance.setup, state = contextInstance.state;
    var minScale = setup.minScale, disablePadding = setup.disablePadding, centerZoomedOut = setup.centerZoomedOut;
    var scale = explicitScale !== null && explicitScale !== void 0 ? explicitScale : state.scale;
    if (size > 0 && scale >= minScale && !disablePadding && !centerZoomedOut) {
        return size;
    }
    return 0;
};

exports.DeviceType = void 0;
(function (DeviceType) {
    DeviceType["TRACK_PAD"] = "track_pad";
    DeviceType["MOUSE"] = "mouse";
    DeviceType["TOUCH"] = "touch";
})(exports.DeviceType || (exports.DeviceType = {}));

var isVelocityCalculationAllowed = function (contextInstance) {
    var mounted = contextInstance.mounted, wrapperComponent = contextInstance.wrapperComponent, contentComponent = contextInstance.contentComponent;
    var _a = contextInstance.setup, disabled = _a.disabled, velocityAnimation = _a.velocityAnimation, limitToBounds = _a.limitToBounds;
    var scale = contextInstance.state.scale;
    var disabledVelocity = velocityAnimation.disabled;
    if (disabledVelocity || disabled || !mounted)
        return false;
    if (!wrapperComponent || !contentComponent)
        return false;
    if (!limitToBounds)
        return true;
    var contentOverflows = wrapperComponent.offsetWidth < contentComponent.offsetWidth * scale ||
        wrapperComponent.offsetHeight < contentComponent.offsetHeight * scale;
    return contentOverflows;
};
var isVelocityAllowed = function (contextInstance) {
    var mounted = contextInstance.mounted, velocity = contextInstance.velocity, bounds = contextInstance.bounds;
    var _a = contextInstance.setup, disabled = _a.disabled, velocityAnimation = _a.velocityAnimation;
    var disabledVelocity = velocityAnimation.disabled;
    var isAllowed = !disabledVelocity && !disabled && mounted;
    if (!isAllowed)
        return false;
    if (!velocity || !bounds)
        return false;
    return true;
};
function getVelocityMoveTime(contextInstance, velocity) {
    var velocityAnimation = contextInstance.setup.velocityAnimation;
    var animationTime = velocityAnimation.animationTime, maxAnimationTime = velocityAnimation.maxAnimationTime, inertia = velocityAnimation.inertia;
    return Math.min(animationTime * Math.max(1, Math.abs(velocity / inertia)), maxAnimationTime);
}
function getVelocityPosition(newPosition, startPosition, currentPosition, isLocked, limitToBounds, minPosition, maxPosition, minTarget, maxTarget, step) {
    if (limitToBounds) {
        if (startPosition > maxPosition && currentPosition > maxPosition) {
            var calculatedPosition = maxPosition + (newPosition - maxPosition) * step;
            if (calculatedPosition > maxTarget)
                return maxTarget;
            if (calculatedPosition < maxPosition)
                return maxPosition;
            return calculatedPosition;
        }
        if (startPosition < minPosition && currentPosition < minPosition) {
            var calculatedPosition = minPosition + (newPosition - minPosition) * step;
            if (calculatedPosition < minTarget)
                return minTarget;
            if (calculatedPosition > minPosition)
                return minPosition;
            return calculatedPosition;
        }
    }
    if (isLocked)
        return startPosition;
    return boundLimiter(newPosition, minPosition, maxPosition, limitToBounds);
}

/* eslint-disable no-param-reassign */
function getSizeMultiplier(wrapperComponent) {
    var defaultMultiplier = 1;
    var value = wrapperComponent.offsetWidth / window.innerWidth;
    if (Number.isNaN(value)) {
        return defaultMultiplier;
    }
    return Math.min(defaultMultiplier, value);
}
var getMinMaxVelocity = function (velocity, maxStrength, sensitivity) {
    var defaultMultiplier = 0;
    var value = velocity * sensitivity;
    if (Number.isNaN(value)) {
        return defaultMultiplier;
    }
    if (velocity < 0) {
        return Math.max(value, -maxStrength);
    }
    return Math.min(value, maxStrength);
};
function handleCalculateVelocity(contextInstance, position, device) {
    var _a, _b;
    var isAllowed = isVelocityCalculationAllowed(contextInstance);
    if (!isAllowed) {
        return;
    }
    var lastMousePosition = contextInstance.lastMousePosition, velocityTime = contextInstance.velocityTime, setup = contextInstance.setup;
    var wrapperComponent = contextInstance.wrapperComponent;
    var _c = setup.velocityAnimation, maxStrengthMouse = _c.maxStrengthMouse, maxStrengthTouch = _c.maxStrengthTouch, sensitivityTouch = _c.sensitivityTouch, sensitivityMouse = _c.sensitivityMouse;
    var now = Date.now();
    if (lastMousePosition && velocityTime && wrapperComponent) {
        var sizeMultiplier = getSizeMultiplier(wrapperComponent);
        var sensitivity = (_a = {},
            _a[exports.DeviceType.TOUCH] = sensitivityTouch,
            _a[exports.DeviceType.MOUSE] = sensitivityMouse,
            _a)[device];
        var maxStrength = (_b = {},
            _b[exports.DeviceType.TOUCH] = maxStrengthTouch,
            _b[exports.DeviceType.MOUSE] = maxStrengthMouse,
            _b)[device];
        var distanceX = position.x - lastMousePosition.x;
        var distanceY = position.y - lastMousePosition.y;
        var velocityX = getMinMaxVelocity(distanceX / sizeMultiplier, maxStrength, sensitivity);
        var velocityY = getMinMaxVelocity(distanceY / sizeMultiplier, maxStrength, sensitivity);
        var interval = now - velocityTime;
        var speed = distanceX * distanceX + distanceY * distanceY;
        var velocity = getMinMaxVelocity(Math.sqrt(speed) / interval, maxStrength, sensitivity);
        contextInstance.velocity = { velocityX: velocityX, velocityY: velocityY, total: velocity };
    }
    contextInstance.lastMousePosition = position;
    contextInstance.velocityTime = now;
}
function handleVelocityPanning(contextInstance) {
    var velocity = contextInstance.velocity, bounds = contextInstance.bounds, setup = contextInstance.setup, wrapperComponent = contextInstance.wrapperComponent;
    var isAllowed = isVelocityAllowed(contextInstance);
    if (!isAllowed || !velocity || !bounds || !wrapperComponent) {
        return;
    }
    var velocityX = velocity.velocityX, velocityY = velocity.velocityY, total = velocity.total;
    var maxPositionX = bounds.maxPositionX, minPositionX = bounds.minPositionX, maxPositionY = bounds.maxPositionY, minPositionY = bounds.minPositionY;
    var limitToBounds = setup.limitToBounds, autoAlignment = setup.autoAlignment;
    var zoomAnimation = setup.zoomAnimation, panning = setup.panning;
    var lockAxisY = panning.lockAxisY, lockAxisX = panning.lockAxisX;
    var animationType = zoomAnimation.animationType;
    var sizeX = autoAlignment.sizeX, sizeY = autoAlignment.sizeY, velocityAlignmentTime = autoAlignment.velocityAlignmentTime;
    var alignAnimationTime = velocityAlignmentTime;
    var moveAnimationTime = getVelocityMoveTime(contextInstance, total);
    var finalAnimationTime = Math.max(moveAnimationTime, alignAnimationTime);
    var paddingValueX = getPaddingValue(contextInstance, sizeX);
    var paddingValueY = getPaddingValue(contextInstance, sizeY);
    var paddingX = (paddingValueX * wrapperComponent.offsetWidth) / 100;
    var paddingY = (paddingValueY * wrapperComponent.offsetHeight) / 100;
    var maxTargetX = maxPositionX + paddingX;
    var minTargetX = minPositionX - paddingX;
    var maxTargetY = maxPositionY + paddingY;
    var minTargetY = minPositionY - paddingY;
    var startState = contextInstance.state;
    var startTime = new Date().getTime();
    handleSetupAnimation(contextInstance, animationType, finalAnimationTime, function (step) {
        var _a = contextInstance.state, scale = _a.scale, positionX = _a.positionX, positionY = _a.positionY;
        var frameTime = new Date().getTime() - startTime;
        var animationProgress = frameTime / alignAnimationTime;
        var alignAnimation = animations[autoAlignment.animationType];
        var alignStep = 1 - alignAnimation(Math.min(1, animationProgress));
        var customStep = 1 - step;
        var newPositionX = positionX + velocityX * customStep;
        var newPositionY = positionY + velocityY * customStep;
        var currentPositionX = getVelocityPosition(newPositionX, startState.positionX, positionX, lockAxisX, limitToBounds, minPositionX, maxPositionX, minTargetX, maxTargetX, alignStep);
        var currentPositionY = getVelocityPosition(newPositionY, startState.positionY, positionY, lockAxisY, limitToBounds, minPositionY, maxPositionY, minTargetY, maxTargetY, alignStep);
        if (positionX !== newPositionX || positionY !== newPositionY) {
            contextInstance.setState(scale, currentPositionX, currentPositionY);
            var onPanning = contextInstance.props.onPanning;
            if (onPanning) {
                onPanning(getContext(contextInstance), {});
            }
        }
    });
}

function handlePanningStart(contextInstance, event) {
    var _a = contextInstance.state, scale = _a.scale, positionX = _a.positionX, positionY = _a.positionY;
    contextInstance.panStartPosition = { x: positionX, y: positionY };
    handleCancelAnimation(contextInstance);
    handleCalculateBounds(contextInstance, scale);
    if (window.TouchEvent !== undefined && event instanceof TouchEvent) {
        handleTouchPanningSetup(contextInstance, event);
    }
    else {
        handlePanningSetup(contextInstance, event);
    }
}
function handleAlignToBounds(contextInstance, customAnimationTime) {
    var scale = contextInstance.state.scale;
    var _a = contextInstance.setup, minScale = _a.minScale, autoAlignment = _a.autoAlignment;
    var disabled = autoAlignment.disabled, sizeX = autoAlignment.sizeX, sizeY = autoAlignment.sizeY, animationTime = autoAlignment.animationTime, animationType = autoAlignment.animationType;
    var isDisabled = disabled || scale < minScale || (!sizeX && !sizeY);
    if (isDisabled)
        return;
    var targetState = handlePanToBounds(contextInstance);
    if (targetState) {
        animate(contextInstance, targetState, customAnimationTime !== null && customAnimationTime !== void 0 ? customAnimationTime : animationTime, animationType);
    }
}
function handlePanning(contextInstance, clientX, clientY, device) {
    var startCoords = contextInstance.startCoords, setup = contextInstance.setup;
    var _a = setup.autoAlignment, sizeX = _a.sizeX, sizeY = _a.sizeY;
    if (!startCoords)
        return;
    var _b = getPanningClientPosition(contextInstance, clientX, clientY), x = _b.x, y = _b.y;
    var paddingValueX = getPaddingValue(contextInstance, sizeX);
    var paddingValueY = getPaddingValue(contextInstance, sizeY);
    handleCalculateVelocity(contextInstance, { x: x, y: y }, device);
    handleNewPosition(contextInstance, x, y, paddingValueX, paddingValueY);
}
function handlePanningEnd(contextInstance, velocityDisabled) {
    if (contextInstance.isPanning) {
        var velocity = contextInstance.velocity, wrapperComponent = contextInstance.wrapperComponent, contentComponent = contextInstance.contentComponent;
        contextInstance.isPanning = false;
        var _a = contextInstance.state, positionX = _a.positionX, positionY = _a.positionY, scale = _a.scale;
        var start = contextInstance.panStartPosition;
        contextInstance.panStartPosition = null;
        if (start) {
            var dx = positionX - start.x;
            var dy = positionY - start.y;
            if (dx * dx + dy * dy <= 25)
                return;
        }
        contextInstance.isAnimating = false;
        contextInstance.animation = null;
        var wrapperWidth = (wrapperComponent === null || wrapperComponent === void 0 ? void 0 : wrapperComponent.offsetWidth) || 0;
        var wrapperHeight = (wrapperComponent === null || wrapperComponent === void 0 ? void 0 : wrapperComponent.offsetHeight) || 0;
        var contentWidth = ((contentComponent === null || contentComponent === void 0 ? void 0 : contentComponent.offsetWidth) || 0) * scale;
        var contentHeight = ((contentComponent === null || contentComponent === void 0 ? void 0 : contentComponent.offsetHeight) || 0) * scale;
        var isContentOverflowing = !contextInstance.setup.limitToBounds ||
            wrapperWidth < contentWidth ||
            wrapperHeight < contentHeight;
        var shouldAnimate = !velocityDisabled &&
            velocity &&
            velocity.total > 0.1 &&
            isContentOverflowing;
        if (shouldAnimate) {
            handleVelocityPanning(contextInstance);
        }
        else {
            handleAlignToBounds(contextInstance);
        }
    }
}

function handleZoomToPoint(contextInstance, scale, mouseX, mouseY) {
    var _a = contextInstance.setup, minScale = _a.minScale, maxScale = _a.maxScale, limitToBounds = _a.limitToBounds;
    var newScale = checkZoomBounds(roundNumber(scale, 2), minScale, maxScale, 0, false);
    var bounds = handleCalculateBounds(contextInstance, newScale);
    var _b = handleCalculateZoomPositions(contextInstance, mouseX, mouseY, newScale, bounds, limitToBounds), x = _b.x, y = _b.y;
    return { scale: newScale, positionX: x, positionY: y };
}
function handleAlignToScaleBounds(contextInstance, mousePositionX, mousePositionY) {
    var scale = contextInstance.state.scale;
    var wrapperComponent = contextInstance.wrapperComponent;
    var _a = contextInstance.setup, minScale = _a.minScale, maxScale = _a.maxScale, limitToBounds = _a.limitToBounds, zoomAnimation = _a.zoomAnimation;
    var disabled = zoomAnimation.disabled, animationTime = zoomAnimation.animationTime, animationType = zoomAnimation.animationType;
    var isWithinBounds = scale >= minScale && scale <= maxScale;
    var isDisabled = disabled || isWithinBounds;
    if (scale >= 1 || limitToBounds) {
        handleAlignToBounds(contextInstance);
    }
    if (isDisabled || !wrapperComponent || !contextInstance.mounted)
        return;
    var mouseX = mousePositionX || wrapperComponent.offsetWidth / 2;
    var mouseY = mousePositionY || wrapperComponent.offsetHeight / 2;
    var targetScale = scale < minScale ? minScale : maxScale;
    var targetState = handleZoomToPoint(contextInstance, targetScale, mouseX, mouseY);
    if (targetState) {
        animate(contextInstance, targetState, animationTime, animationType);
    }
}

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol */


var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

function __rest(s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
}

function __spreadArray(to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

var initialState = {
    previousScale: 1,
    scale: 1,
    positionX: 0,
    positionY: 0,
};
var initialSetup = {
    disabled: false,
    minPositionX: null,
    maxPositionX: null,
    minPositionY: null,
    maxPositionY: null,
    minScale: 1,
    maxScale: 8,
    limitToBounds: true,
    centerZoomedOut: false,
    centerOnInit: false,
    disablePadding: false,
    smooth: true,
    detached: false,
    wheel: {
        step: 0.015,
        disabled: false,
        wheelDisabled: false,
        touchPadDisabled: false,
        activationKeys: [],
        excluded: [],
    },
    trackPadPanning: {
        disabled: true,
        velocityDisabled: false,
        lockAxisX: false,
        lockAxisY: false,
        activationKeys: [],
        excluded: [],
    },
    panning: {
        disabled: false,
        velocityDisabled: false,
        lockAxisX: false,
        lockAxisY: false,
        allowLeftClickPan: true,
        allowMiddleClickPan: true,
        allowRightClickPan: true,
        activationKeys: [],
        excluded: [],
    },
    pinch: {
        step: 5,
        disabled: false,
        allowPanning: true,
        excluded: [],
    },
    doubleClick: {
        disabled: false,
        step: 0.7,
        mode: "zoomIn",
        animationType: "easeOut",
        animationTime: 200,
        excluded: [],
    },
    zoomAnimation: {
        disabled: false,
        size: 0.4,
        animationTime: 200,
        animationType: "easeOut",
    },
    autoAlignment: {
        disabled: false,
        sizeX: 100,
        sizeY: 100,
        animationTime: 200,
        velocityAlignmentTime: 400,
        animationType: "easeOut",
    },
    velocityAnimation: {
        disabled: false,
        sensitivityMouse: 1,
        sensitivityTouch: 1.2,
        maxStrengthMouse: 20,
        maxStrengthTouch: 40,
        inertia: 1,
        animationTime: 300,
        maxAnimationTime: 800,
        animationType: "easeOut",
    },
};
var baseClasses = {
    wrapperClass: "react-transform-wrapper",
    contentClass: "react-transform-component",
};

var createState = function (props) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    var minScale = Math.max((_a = props.minScale) !== null && _a !== void 0 ? _a : initialSetup.minScale, 1e-7);
    var maxScale = (_b = props.maxScale) !== null && _b !== void 0 ? _b : initialSetup.maxScale;
    var rawScale = (_c = props.initialScale) !== null && _c !== void 0 ? _c : initialState.scale;
    var scale = Math.min(Math.max(rawScale, minScale), maxScale);
    var positionX = boundLimiter((_d = props.initialPositionX) !== null && _d !== void 0 ? _d : initialState.positionX, (_e = props.minPositionX) !== null && _e !== void 0 ? _e : -Infinity, (_f = props.maxPositionX) !== null && _f !== void 0 ? _f : Infinity, props.minPositionX != null || props.maxPositionX != null);
    var positionY = boundLimiter((_g = props.initialPositionY) !== null && _g !== void 0 ? _g : initialState.positionY, (_h = props.minPositionY) !== null && _h !== void 0 ? _h : -Infinity, (_j = props.maxPositionY) !== null && _j !== void 0 ? _j : Infinity, props.minPositionY != null || props.maxPositionY != null);
    return {
        previousScale: scale,
        scale: scale,
        positionX: positionX,
        positionY: positionY,
    };
};
var createSetup = function (props) {
    var newSetup = __assign({}, initialSetup);
    Object.keys(props).forEach(function (key) {
        var k = key;
        var validValue = typeof props[k] !== "undefined";
        var validParameter = typeof initialSetup[k] !== "undefined";
        if (validParameter && validValue) {
            var dataType = Object.prototype.toString.call(initialSetup[k]);
            var isObject = dataType === "[object Object]";
            var isArray = dataType === "[object Array]";
            if (isObject) {
                newSetup[k] = __assign(__assign({}, initialSetup[k]), props[k]);
            }
            else if (isArray) {
                newSetup[k] = __spreadArray(__spreadArray([], initialSetup[k], true), props[k], true);
            }
            else {
                newSetup[k] = props[k];
            }
        }
    });
    if (newSetup.minScale <= 0) {
        newSetup.minScale = 1e-7;
    }
    return newSetup;
};

var handleCalculateButtonZoom = function (contextInstance, delta, step) {
    var scale = contextInstance.state.scale;
    var wrapperComponent = contextInstance.wrapperComponent, setup = contextInstance.setup;
    var maxScale = setup.maxScale, minScale = setup.minScale, zoomAnimation = setup.zoomAnimation, smooth = setup.smooth;
    var size = zoomAnimation.size;
    if (!wrapperComponent) {
        throw new Error("Wrapper is not mounted");
    }
    var targetScale = smooth
        ? scale * Math.exp(delta * step)
        : scale + delta * step;
    var newScale = checkZoomBounds(roundNumber(targetScale, 3), minScale, maxScale, size, false);
    return newScale;
};
function handleZoomToViewCenter(contextInstance, delta, step, animationTime, animationType) {
    var _a, _b;
    var wrapperComponent = contextInstance.wrapperComponent;
    var _c = contextInstance.state, scale = _c.scale, positionX = _c.positionX, positionY = _c.positionY;
    var zoomAnimation = contextInstance.setup.zoomAnimation;
    if (!wrapperComponent)
        return console.error("No WrapperComponent found");
    var effectiveAnimationTime = zoomAnimation.disabled ? 0 : animationTime;
    var wrapperWidth = wrapperComponent.offsetWidth;
    var wrapperHeight = wrapperComponent.offsetHeight;
    var mouseX = (wrapperWidth / 2 - positionX) / scale;
    var mouseY = (wrapperHeight / 2 - positionY) / scale;
    var newScale = handleCalculateButtonZoom(contextInstance, delta, step);
    var targetState = handleZoomToPoint(contextInstance, newScale, mouseX, mouseY);
    if (!targetState) {
        return console.error("Error during zoom event. New transformation state was not calculated.");
    }
    var _d = contextInstance.props, onZoomStart = _d.onZoomStart, onZoom = _d.onZoom, onZoomStop = _d.onZoomStop;
    var event = new MouseEvent("mousemove", { bubbles: true });
    var ctx = getContext(contextInstance);
    handleCallback(ctx, event, onZoomStart);
    handleCallback(ctx, event, onZoom);
    animate(contextInstance, targetState, effectiveAnimationTime, animationType);
    var win = (_b = (_a = wrapperComponent.ownerDocument) === null || _a === void 0 ? void 0 : _a.defaultView) !== null && _b !== void 0 ? _b : (typeof window !== "undefined" ? window : null);
    if (win) {
        win.setTimeout(function () {
            if (!contextInstance.mounted)
                return;
            handleCallback(getContext(contextInstance), event, onZoomStop);
        }, effectiveAnimationTime);
    }
}
function resetTransformations(contextInstance, animationTime, animationType, onResetTransformation) {
    var _a, _b;
    var setup = contextInstance.setup, wrapperComponent = contextInstance.wrapperComponent, contentComponent = contextInstance.contentComponent;
    var limitToBounds = setup.limitToBounds, centerOnInit = setup.centerOnInit;
    var initialTransformation = createState(contextInstance.props);
    var _c = contextInstance.state, scale = _c.scale, positionX = _c.positionX, positionY = _c.positionY;
    if (!wrapperComponent)
        return;
    var targetPositionX = initialTransformation.positionX;
    var targetPositionY = initialTransformation.positionY;
    if (centerOnInit && contentComponent) {
        var centered = getCenterPosition(initialTransformation.scale, wrapperComponent, contentComponent);
        targetPositionX = centered.positionX;
        targetPositionY = centered.positionY;
    }
    var newBounds = calculateBounds(contextInstance, initialTransformation.scale);
    var boundedPositions = getMouseBoundedPosition(targetPositionX, targetPositionY, newBounds, limitToBounds, 0, 0, wrapperComponent);
    var newState = {
        scale: initialTransformation.scale,
        positionX: boundedPositions.x,
        positionY: boundedPositions.y,
    };
    if (scale === initialTransformation.scale &&
        positionX === initialTransformation.positionX &&
        positionY === initialTransformation.positionY) {
        return;
    }
    onResetTransformation === null || onResetTransformation === void 0 ? void 0 : onResetTransformation();
    var _d = contextInstance.props, onZoomStart = _d.onZoomStart, onZoom = _d.onZoom, onZoomStop = _d.onZoomStop;
    var event = new MouseEvent("mousemove", { bubbles: true });
    var ctx = getContext(contextInstance);
    handleCallback(ctx, event, onZoomStart);
    handleCallback(ctx, event, onZoom);
    animate(contextInstance, newState, animationTime, animationType);
    var win = (_b = (_a = wrapperComponent.ownerDocument) === null || _a === void 0 ? void 0 : _a.defaultView) !== null && _b !== void 0 ? _b : (typeof window !== "undefined" ? window : null);
    if (win) {
        win.setTimeout(function () {
            if (!contextInstance.mounted)
                return;
            handleCallback(getContext(contextInstance), event, onZoomStop);
        }, animationTime);
    }
}
function getOffset(element, wrapper, content, state) {
    var offset = element.getBoundingClientRect();
    var wrapperOffset = wrapper.getBoundingClientRect();
    var contentOffset = content.getBoundingClientRect();
    var xOff = wrapperOffset.x * state.scale;
    var yOff = wrapperOffset.y * state.scale;
    return {
        x: (offset.x - contentOffset.x + xOff) / state.scale,
        y: (offset.y - contentOffset.y + yOff) / state.scale,
    };
}
function calculateZoomToNode(contextInstance, node, customZoom, customOffsetX, customOffsetY) {
    if (customOffsetX === void 0) { customOffsetX = 0; }
    if (customOffsetY === void 0) { customOffsetY = 0; }
    var wrapperComponent = contextInstance.wrapperComponent, contentComponent = contextInstance.contentComponent, state = contextInstance.state;
    var _a = contextInstance.setup, limitToBounds = _a.limitToBounds, minScale = _a.minScale, maxScale = _a.maxScale;
    if (!wrapperComponent || !contentComponent)
        return state;
    var wrapperRect = wrapperComponent.getBoundingClientRect();
    var nodeRect = node.getBoundingClientRect();
    var nodeOffset = getOffset(node, wrapperComponent, contentComponent, state);
    var nodeLeft = nodeOffset.x;
    var nodeTop = nodeOffset.y;
    var nodeWidth = nodeRect.width / state.scale;
    var nodeHeight = nodeRect.height / state.scale;
    var scaleX = wrapperComponent.offsetWidth / nodeWidth;
    var scaleY = wrapperComponent.offsetHeight / nodeHeight;
    var newScale = checkZoomBounds(customZoom || Math.min(scaleX, scaleY), minScale, maxScale, 0, false);
    var offsetX = (wrapperRect.width - nodeWidth * newScale) / 2;
    var offsetY = (wrapperRect.height - nodeHeight * newScale) / 2;
    var newPositionX = (wrapperRect.left - nodeLeft) * newScale + offsetX + customOffsetX;
    var newPositionY = (wrapperRect.top - nodeTop) * newScale + offsetY + customOffsetY;
    var bounds = calculateBounds(contextInstance, newScale);
    var _b = getMouseBoundedPosition(newPositionX, newPositionY, bounds, limitToBounds, 0, 0, wrapperComponent), x = _b.x, y = _b.y;
    return { positionX: x, positionY: y, scale: newScale };
}

var zoomIn = function (contextInstance) {
    return function (step, animationTime, animationType) {
        if (step === void 0) { step = 0.5; }
        if (animationTime === void 0) { animationTime = 300; }
        if (animationType === void 0) { animationType = "easeOut"; }
        handleZoomToViewCenter(contextInstance, 1, step, animationTime, animationType);
    };
};
var zoomOut = function (contextInstance) {
    return function (step, animationTime, animationType) {
        if (step === void 0) { step = 0.5; }
        if (animationTime === void 0) { animationTime = 300; }
        if (animationType === void 0) { animationType = "easeOut"; }
        handleZoomToViewCenter(contextInstance, -1, step, animationTime, animationType);
    };
};
var setTransform = function (contextInstance) {
    return function (newPositionX, newPositionY, newScale, animationTime, animationType) {
        if (animationTime === void 0) { animationTime = 300; }
        if (animationType === void 0) { animationType = "easeOut"; }
        var _a = contextInstance.state, positionX = _a.positionX, positionY = _a.positionY, scale = _a.scale;
        var wrapperComponent = contextInstance.wrapperComponent, contentComponent = contextInstance.contentComponent;
        var disabled = contextInstance.setup.disabled;
        if (disabled || !wrapperComponent || !contentComponent)
            return;
        var targetState = {
            positionX: Number.isNaN(newPositionX) ? positionX : newPositionX,
            positionY: Number.isNaN(newPositionY) ? positionY : newPositionY,
            scale: Number.isNaN(newScale) ? scale : newScale,
        };
        animate(contextInstance, targetState, animationTime, animationType);
    };
};
var resetTransform = function (contextInstance) {
    return function (animationTime, animationType) {
        if (animationTime === void 0) { animationTime = 200; }
        if (animationType === void 0) { animationType = "easeOut"; }
        resetTransformations(contextInstance, animationTime, animationType);
    };
};
var centerView = function (contextInstance) {
    return function (scale, animationTime, animationType) {
        if (animationTime === void 0) { animationTime = 200; }
        if (animationType === void 0) { animationType = "easeOut"; }
        var state = contextInstance.state, wrapperComponent = contextInstance.wrapperComponent, contentComponent = contextInstance.contentComponent;
        if (wrapperComponent && contentComponent) {
            var targetState = getCenterPosition(scale || state.scale, wrapperComponent, contentComponent);
            animate(contextInstance, targetState, animationTime, animationType);
        }
    };
};
var zoomToElement = function (contextInstance) {
    return function (node, scale, animationTime, animationType, offsetX, offsetY) {
        if (animationTime === void 0) { animationTime = 600; }
        if (animationType === void 0) { animationType = "easeOut"; }
        if (offsetX === void 0) { offsetX = 0; }
        if (offsetY === void 0) { offsetY = 0; }
        handleCancelAnimation(contextInstance);
        var wrapperComponent = contextInstance.wrapperComponent;
        var target = typeof node === "string" ? document.getElementById(node) : node;
        if (wrapperComponent && target && wrapperComponent.contains(target)) {
            var targetState = calculateZoomToNode(contextInstance, target, scale, offsetX, offsetY);
            animate(contextInstance, targetState, animationTime, animationType);
        }
    };
};

var getControls = function (contextInstance) {
    return {
        instance: contextInstance,
        state: contextInstance.state,
        zoomIn: zoomIn(contextInstance),
        zoomOut: zoomOut(contextInstance),
        setTransform: setTransform(contextInstance),
        resetTransform: resetTransform(contextInstance),
        centerView: centerView(contextInstance),
        zoomToElement: zoomToElement(contextInstance),
    };
};
var getState = function (contextInstance) {
    return {
        instance: contextInstance,
        state: contextInstance.state,
    };
};
var getContext = function (contextInstance) {
    var ref = {};
    Object.assign(ref, getState(contextInstance));
    Object.assign(ref, getControls(contextInstance));
    return ref;
};

// We want to make event listeners non-passive, and to do so have to check
// that browsers support EventListenerOptions in the first place.
// https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Safely_detecting_option_support
var passiveSupported = false;
function makePassiveEventOption() {
    try {
        var options = {
            get passive() {
                // This function will be called when the browser
                //   attempts to access the passive property.
                passiveSupported = true;
                return false;
            },
        };
        return options;
    }
    catch (err) {
        passiveSupported = false;
        return passiveSupported;
    }
}

var matchPrefix = ".".concat(baseClasses.wrapperClass);
var isExcludedNode = function (node, excluded) {
    return excluded.some(function (exclude) {
        return node.matches("".concat(matchPrefix, " ").concat(exclude, ", ").concat(matchPrefix, " .").concat(exclude, ", ").concat(matchPrefix, " ").concat(exclude, " *, ").concat(matchPrefix, " .").concat(exclude, " *"));
    });
};
var cancelTimeout = function (timeout) {
    if (timeout) {
        clearTimeout(timeout);
    }
};

/** Drop binary float noise on scale (e.g. 1.5000000000000002) without clipping real zoom values. */
var roundScaleForTransform = function (scale) {
    return Number.parseFloat(scale.toFixed(8));
};
var getTransformStyles = function (x, y, scale) {
    // Standard translate prevents blurry svg on the safari
    var s = roundScaleForTransform(scale);
    return "translate(".concat(x, "px, ").concat(y, "px) scale(").concat(s, ")");
};
var getMatrixTransformStyles = function (x, y, scale) {
    // The shorthand for matrix does not work for Safari hence the need to explicitly use matrix3d
    // Refer to https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/matrix
    var a = scale;
    var b = 0;
    var c = 0;
    var d = scale;
    var tx = x;
    var ty = y;
    return "matrix3d(".concat(a, ", ").concat(b, ", 0, 0, ").concat(c, ", ").concat(d, ", 0, 0, 0, 0, 1, 0, ").concat(tx, ", ").concat(ty, ", 0, 1)");
};
var getCenterPosition = function (scale, wrapperComponent, contentComponent) {
    var contentWidth = contentComponent.offsetWidth * scale;
    var contentHeight = contentComponent.offsetHeight * scale;
    var centerPositionX = (wrapperComponent.offsetWidth - contentWidth) / 2;
    var centerPositionY = (wrapperComponent.offsetHeight - contentHeight) / 2;
    return {
        scale: scale,
        positionX: centerPositionX,
        positionY: centerPositionY,
    };
};

function assignRef(ref, value) {
    if (ref == null)
        return;
    if (typeof ref === "function") {
        ref(value);
    }
    else {
        ref.current = value;
    }
}
function mergeRefs(refs) {
    return function (value) {
        refs.forEach(function (ref) {
            if (typeof ref === "function") {
                ref(value);
            }
            else if (ref != null) {
                ref.current = value;
            }
        });
    };
}

var isWheelAllowed = function (contextInstance, event) {
    var _a = contextInstance.setup.wheel, disabled = _a.disabled, wheelDisabled = _a.wheelDisabled, touchPadDisabled = _a.touchPadDisabled, excluded = _a.excluded;
    var isInitialized = contextInstance.isInitialized, isPanning = contextInstance.isPanning;
    var target = event.target;
    var isAllowed = isInitialized && !isPanning && !disabled && target;
    if (!isAllowed)
        return false;
    // Event ctrlKey detects if touchpad action is executing wheel or pinch gesture
    if (wheelDisabled && !event.ctrlKey)
        return false;
    if (touchPadDisabled && event.ctrlKey)
        return false;
    var isExcluded = isExcludedNode(target, excluded);
    if (isExcluded)
        return false;
    var keysPressed = contextInstance.isPressingKeys(contextInstance.setup.wheel.activationKeys);
    if (!keysPressed)
        return false;
    return true;
};
var isWheelPanningAllowed = function (contextInstance, event) {
    var _a = contextInstance.setup, disabled = _a.disabled, trackPadPanning = _a.trackPadPanning;
    var activationKeys = trackPadPanning.activationKeys, excluded = trackPadPanning.excluded;
    if (!contextInstance.wrapperComponent || !contextInstance.contentComponent) {
        return false;
    }
    if (disabled || trackPadPanning.disabled || event.ctrlKey) {
        return false;
    }
    var isAllowed = isWheelAllowed(contextInstance, event);
    // Cannot execute at the same time as wheel zoom
    if (isAllowed)
        return false;
    var target = event.target;
    var isExcluded = isExcludedNode(target, excluded);
    if (isExcluded)
        return false;
    var keysPressed = contextInstance.isPressingKeys(activationKeys);
    if (!keysPressed)
        return false;
    return true;
};
var getDeltaY = function (event) {
    if (event) {
        return event.deltaY < 0 ? 1 : -1;
    }
    return 0;
};
function getDelta(event, customDelta) {
    var deltaY = getDeltaY(event);
    var delta = checkIsNumber(customDelta, deltaY);
    return delta;
}
function getMousePosition(event, contentComponent, scale) {
    var contentRect = contentComponent.getBoundingClientRect();
    var mouseX = 0;
    var mouseY = 0;
    if ("clientX" in event) {
        // mouse position x, y over wrapper component
        mouseX = (event.clientX - contentRect.left) / scale;
        mouseY = (event.clientY - contentRect.top) / scale;
    }
    else {
        var touch = event.touches[0];
        mouseX = (touch.clientX - contentRect.left) / scale;
        mouseY = (touch.clientY - contentRect.top) / scale;
    }
    if (Number.isNaN(mouseX) || Number.isNaN(mouseY))
        console.error("No mouse or touch offset found");
    return {
        x: mouseX,
        y: mouseY,
    };
}
var handleCalculateWheelZoom = function (contextInstance, delta, step, disable, getTarget) {
    var scale = contextInstance.state.scale;
    var wrapperComponent = contextInstance.wrapperComponent, setup = contextInstance.setup;
    var maxScale = setup.maxScale, minScale = setup.minScale, zoomAnimation = setup.zoomAnimation, disablePadding = setup.disablePadding;
    var size = zoomAnimation.size, disabled = zoomAnimation.disabled;
    if (!wrapperComponent) {
        throw new Error("Wrapper is not mounted");
    }
    var targetScale = scale + delta * step;
    if (getTarget)
        return targetScale;
    var paddingEnabled = disable ? false : !disabled;
    var newScale = checkZoomBounds(targetScale, minScale, maxScale, size, paddingEnabled && !disablePadding);
    return newScale;
};
var handleWheelZoomStop = function (contextInstance, event) {
    var previousWheelEvent = contextInstance.previousWheelEvent;
    var scale = contextInstance.state.scale;
    var _a = contextInstance.setup, maxScale = _a.maxScale, minScale = _a.minScale;
    if (!previousWheelEvent)
        return false;
    if (scale < maxScale || scale > minScale)
        return true;
    if (Math.sign(previousWheelEvent.deltaY) !== Math.sign(event.deltaY))
        return true;
    if (previousWheelEvent.deltaY > 0 && previousWheelEvent.deltaY < event.deltaY)
        return true;
    if (previousWheelEvent.deltaY < 0 && previousWheelEvent.deltaY > event.deltaY)
        return true;
    if (Math.sign(previousWheelEvent.deltaY) !== Math.sign(event.deltaY))
        return true;
    return false;
};

var isPinchStartAllowed = function (contextInstance, event) {
    var _a = contextInstance.setup.pinch, disabled = _a.disabled, excluded = _a.excluded;
    var isInitialized = contextInstance.isInitialized;
    var target = event.target;
    var isAllowed = isInitialized && !disabled && target;
    if (!isAllowed)
        return false;
    var isExcluded = isExcludedNode(target, excluded);
    if (isExcluded)
        return false;
    return true;
};
var isPinchAllowed = function (contextInstance) {
    var disabled = contextInstance.setup.pinch.disabled;
    var isInitialized = contextInstance.isInitialized, pinchStartDistance = contextInstance.pinchStartDistance;
    var isAllowed = isInitialized && !disabled && pinchStartDistance !== null;
    if (!isAllowed)
        return false;
    return true;
};
var calculateTouchMidPoint = function (event, scale, contentComponent) {
    var contentRect = contentComponent.getBoundingClientRect();
    var touches = event.touches;
    var firstPointX = touches[0].clientX - contentRect.left;
    var firstPointY = touches[0].clientY - contentRect.top;
    var secondPointX = touches[1].clientX - contentRect.left;
    var secondPointY = touches[1].clientY - contentRect.top;
    return {
        x: (firstPointX + secondPointX) / 2 / scale,
        y: (firstPointY + secondPointY) / 2 / scale,
    };
};
var getTouchDistance = function (event) {
    return Math.sqrt(Math.pow((event.touches[0].pageX - event.touches[1].pageX), 2) +
        Math.pow((event.touches[0].pageY - event.touches[1].pageY), 2));
};
var DEFAULT_PINCH_STEP = 5;
var calculatePinchZoom = function (contextInstance, currentDistance) {
    var pinchStartScale = contextInstance.pinchStartScale, pinchStartDistance = contextInstance.pinchStartDistance, setup = contextInstance.setup;
    var maxScale = setup.maxScale, minScale = setup.minScale, zoomAnimation = setup.zoomAnimation, disablePadding = setup.disablePadding, pinch = setup.pinch;
    var size = zoomAnimation.size, disabled = zoomAnimation.disabled;
    var step = pinch.step;
    if (!pinchStartScale || pinchStartDistance === null) {
        throw new Error("Pinch touches distance was not provided");
    }
    if (currentDistance < 0) {
        return contextInstance.state.scale;
    }
    var touchProportion = currentDistance / pinchStartDistance;
    var rawScale = touchProportion * pinchStartScale;
    var scaleDelta = (rawScale - pinchStartScale) * (step / DEFAULT_PINCH_STEP);
    var computed = pinchStartScale + scaleDelta;
    var scale = computed === Infinity ? 0 : roundNumber(computed, 10);
    return checkZoomBounds(scale, minScale, maxScale, size, !disabled && !disablePadding);
};

var wheelStopEventTime = 160;
var wheelAnimationTime = 100;
var handleWheelStart = function (contextInstance, event) {
    var _a = contextInstance.props, onWheelStart = _a.onWheelStart, onZoomStart = _a.onZoomStart;
    if (!contextInstance.wheelStopEventTimer) {
        handleCancelAnimation(contextInstance);
        handleCallback(getContext(contextInstance), event, onWheelStart);
        handleCallback(getContext(contextInstance), event, onZoomStart);
    }
};
var handleWheelZoom = function (contextInstance, event) {
    var _a = contextInstance.props, onWheel = _a.onWheel, onZoom = _a.onZoom;
    var contentComponent = contextInstance.contentComponent, setup = contextInstance.setup, state = contextInstance.state;
    var scale = state.scale;
    var limitToBounds = setup.limitToBounds, centerZoomedOut = setup.centerZoomedOut, zoomAnimation = setup.zoomAnimation, wheel = setup.wheel, disablePadding = setup.disablePadding, smooth = setup.smooth;
    var size = zoomAnimation.size, disabled = zoomAnimation.disabled;
    var step = wheel.step;
    if (!contentComponent) {
        throw new Error("Component not mounted");
    }
    event.preventDefault();
    event.stopPropagation();
    var delta = getDelta(event, null);
    var zoomStep = smooth ? step * Math.abs(event.deltaY) : step;
    var newScale = handleCalculateWheelZoom(contextInstance, delta, zoomStep, !event.ctrlKey);
    // if scale not change
    if (scale === newScale)
        return;
    var bounds = handleCalculateBounds(contextInstance, newScale);
    var mousePosition = getMousePosition(event, contentComponent, scale);
    var isPaddingDisabled = disabled || size === 0 || centerZoomedOut || disablePadding;
    var isLimitedToBounds = limitToBounds && isPaddingDisabled;
    var _b = handleCalculateZoomPositions(contextInstance, mousePosition.x, mousePosition.y, newScale, bounds, isLimitedToBounds), x = _b.x, y = _b.y;
    contextInstance.previousWheelEvent = event;
    contextInstance.setState(newScale, x, y);
    handleCallback(getContext(contextInstance), event, onWheel);
    handleCallback(getContext(contextInstance), event, onZoom);
};
var handleWheelStop = function (contextInstance, event) {
    var _a = contextInstance.props, onWheelStop = _a.onWheelStop, onZoomStop = _a.onZoomStop;
    // fire animation
    cancelTimeout(contextInstance.wheelAnimationTimer);
    contextInstance.wheelAnimationTimer = setTimeout(function () {
        if (!contextInstance.mounted)
            return;
        handleAlignToScaleBounds(contextInstance, event.x, event.y);
        contextInstance.wheelAnimationTimer = null;
    }, wheelAnimationTime);
    // Wheel stop event
    var hasStoppedZooming = handleWheelZoomStop(contextInstance, event);
    if (hasStoppedZooming) {
        cancelTimeout(contextInstance.wheelStopEventTimer);
        contextInstance.wheelStopEventTimer = setTimeout(function () {
            if (!contextInstance.mounted)
                return;
            contextInstance.wheelStopEventTimer = null;
            handleCallback(getContext(contextInstance), event, onWheelStop);
            handleCallback(getContext(contextInstance), event, onZoomStop);
        }, wheelStopEventTime);
    }
};
var handleWheelPanningStart = function (contextInstance, event) {
    var _a = contextInstance.props, onWheelStart = _a.onWheelStart, onPanningStart = _a.onPanningStart;
    if (!contextInstance.wheelStopEventTimer) {
        handleCancelAnimation(contextInstance);
        handleCallback(getContext(contextInstance), event, onWheelStart);
        handleCallback(getContext(contextInstance), event, onPanningStart);
    }
};
var handleWheelPanningStop = function (contextInstance, event) {
    var _a = contextInstance.props, onWheelStop = _a.onWheelStop, onPanningStop = _a.onPanningStop;
    // fire animation
    cancelTimeout(contextInstance.wheelAnimationTimer);
    contextInstance.wheelAnimationTimer = setTimeout(function () {
        if (!contextInstance.mounted)
            return;
        handleAlignToScaleBounds(contextInstance, event.x, event.y);
        contextInstance.wheelAnimationTimer = null;
    }, wheelAnimationTime);
    // Wheel stop event
    var hasStoppedZooming = handleWheelZoomStop(contextInstance, event);
    if (hasStoppedZooming) {
        cancelTimeout(contextInstance.wheelStopEventTimer);
        contextInstance.wheelStopEventTimer = setTimeout(function () {
            if (!contextInstance.mounted)
                return;
            contextInstance.wheelStopEventTimer = null;
            handleCallback(getContext(contextInstance), event, onWheelStop);
            handleCallback(getContext(contextInstance), event, onPanningStop);
        }, wheelStopEventTime);
    }
};

var getTouchCenter = function (event) {
    var totalX = 0;
    var totalY = 0;
    // Sum up the positions of all touches
    for (var i = 0; i < 2; i += 1) {
        totalX += event.touches[i].clientX;
        totalY += event.touches[i].clientY;
    }
    // Calculate the average position
    var x = totalX / 2;
    var y = totalY / 2;
    return { x: x, y: y };
};
var handlePinchStart = function (contextInstance, event) {
    var distance = getTouchDistance(event);
    contextInstance.pinchStartDistance = distance;
    contextInstance.lastDistance = distance;
    contextInstance.pinchStartScale = contextInstance.state.scale;
    contextInstance.isPanning = false;
    contextInstance.isPinching = true;
    contextInstance.pinchPreviousCenter = getTouchCenter(event);
    handleCancelAnimation(contextInstance);
};
var handlePinchZoom = function (contextInstance, event) {
    var contentComponent = contextInstance.contentComponent, pinchStartDistance = contextInstance.pinchStartDistance, wrapperComponent = contextInstance.wrapperComponent, pinchPreviousCenter = contextInstance.pinchPreviousCenter;
    var scale = contextInstance.state.scale;
    var _a = contextInstance.setup, limitToBounds = _a.limitToBounds, centerZoomedOut = _a.centerZoomedOut, zoomAnimation = _a.zoomAnimation, autoAlignment = _a.autoAlignment, pinch = _a.pinch, panning = _a.panning;
    var disabled = zoomAnimation.disabled, size = zoomAnimation.size;
    var allowPanning = pinch.allowPanning;
    // if one finger starts from outside of wrapper
    if (pinchStartDistance === null || !contentComponent)
        return;
    var midPoint = calculateTouchMidPoint(event, scale, contentComponent);
    // if touches goes off of the wrapper element
    if (!Number.isFinite(midPoint.x) || !Number.isFinite(midPoint.y))
        return;
    var currentDistance = getTouchDistance(event);
    var newScale = calculatePinchZoom(contextInstance, currentDistance);
    var center = getTouchCenter(event);
    // pan should be scale invariant.
    var scaleDiff = scale / newScale;
    var panX = (center.x - ((pinchPreviousCenter === null || pinchPreviousCenter === void 0 ? void 0 : pinchPreviousCenter.x) || 0)) * scaleDiff;
    var panY = (center.y - ((pinchPreviousCenter === null || pinchPreviousCenter === void 0 ? void 0 : pinchPreviousCenter.y) || 0)) * scaleDiff;
    if (newScale === scale && panX === 0 && panY === 0)
        return;
    contextInstance.pinchPreviousCenter = center;
    var bounds = handleCalculateBounds(contextInstance, newScale);
    var isPaddingDisabled = disabled || size === 0 || centerZoomedOut;
    var isLimitedToBounds = limitToBounds && isPaddingDisabled;
    var _b = handleCalculateZoomPositions(contextInstance, midPoint.x, midPoint.y, newScale, bounds, isLimitedToBounds), x = _b.x, y = _b.y;
    contextInstance.pinchMidpoint = midPoint;
    contextInstance.lastDistance = currentDistance;
    if (panning.disabled || !allowPanning) {
        contextInstance.setState(newScale, x, y);
    }
    else {
        var sizeX = autoAlignment.sizeX, sizeY = autoAlignment.sizeY;
        var paddingValueX = getPaddingValue(contextInstance, sizeX, newScale);
        var paddingValueY = getPaddingValue(contextInstance, sizeY, newScale);
        var newPositionX = x + panX;
        var newPositionY = y + panY;
        var _c = getMouseBoundedPosition(newPositionX, newPositionY, bounds, limitToBounds, paddingValueX, paddingValueY, wrapperComponent), finalX = _c.x, finalY = _c.y;
        contextInstance.setState(newScale, finalX, finalY);
    }
};
var handlePinchStop = function (contextInstance) {
    var pinchMidpoint = contextInstance.pinchMidpoint;
    contextInstance.velocity = null;
    contextInstance.lastDistance = null;
    contextInstance.pinchMidpoint = null;
    contextInstance.pinchStartScale = null;
    contextInstance.pinchStartDistance = null;
    contextInstance.isPinching = false;
    handleAlignToScaleBounds(contextInstance, pinchMidpoint === null || pinchMidpoint === void 0 ? void 0 : pinchMidpoint.x, pinchMidpoint === null || pinchMidpoint === void 0 ? void 0 : pinchMidpoint.y);
};

var handleDoubleClickStop = function (contextInstance, event) {
    var onZoomStop = contextInstance.props.onZoomStop;
    var animationTime = contextInstance.setup.doubleClick.animationTime;
    cancelTimeout(contextInstance.doubleClickStopEventTimer);
    contextInstance.doubleClickStopEventTimer = setTimeout(function () {
        contextInstance.doubleClickStopEventTimer = null;
        handleCallback(getContext(contextInstance), event, onZoomStop);
    }, animationTime);
};
var handleDoubleClickResetMode = function (contextInstance, event) {
    var _a = contextInstance.props, onZoomStart = _a.onZoomStart, onZoom = _a.onZoom;
    var _b = contextInstance.setup.doubleClick, animationTime = _b.animationTime, animationType = _b.animationType;
    handleCallback(getContext(contextInstance), event, onZoomStart);
    resetTransformations(contextInstance, animationTime, animationType, function () {
        return handleCallback(getContext(contextInstance), event, onZoom);
    });
    handleDoubleClickStop(contextInstance, event);
};
function getDoubleClickScale(mode, scale) {
    if (mode === "toggle") {
        return scale === 1 ? 1 : -1;
    }
    return mode === "zoomOut" ? -1 : 1;
}
function handleDoubleClick(contextInstance, event) {
    var setup = contextInstance.setup, doubleClickStopEventTimer = contextInstance.doubleClickStopEventTimer, state = contextInstance.state, contentComponent = contextInstance.contentComponent;
    var scale = state.scale;
    var _a = contextInstance.props, onZoomStart = _a.onZoomStart, onZoom = _a.onZoom;
    var _b = setup.doubleClick, disabled = _b.disabled, mode = _b.mode, step = _b.step, animationTime = _b.animationTime, animationType = _b.animationType;
    if (disabled)
        return;
    if (doubleClickStopEventTimer)
        return;
    if (mode === "reset") {
        return handleDoubleClickResetMode(contextInstance, event);
    }
    if (!contentComponent)
        return console.error("No ContentComponent found");
    var delta = getDoubleClickScale(mode, contextInstance.state.scale);
    var newScale = handleCalculateButtonZoom(contextInstance, delta, step);
    // stop execution when scale didn't change
    if (scale === newScale)
        return;
    handleCallback(getContext(contextInstance), event, onZoomStart);
    var mousePosition = getMousePosition(event, contentComponent, scale);
    var targetState = handleZoomToPoint(contextInstance, newScale, mousePosition.x, mousePosition.y);
    if (!targetState) {
        return console.error("Error during zoom event. New transformation state was not calculated.");
    }
    handleCallback(getContext(contextInstance), event, onZoom);
    animate(contextInstance, targetState, animationTime, animationType);
    handleDoubleClickStop(contextInstance, event);
}
var isDoubleClickAllowed = function (contextInstance, event) {
    var isInitialized = contextInstance.isInitialized, setup = contextInstance.setup, wrapperComponent = contextInstance.wrapperComponent;
    var _a = setup.doubleClick, disabled = _a.disabled, excluded = _a.excluded;
    var target = event.target;
    var isWrapperChild = wrapperComponent === null || wrapperComponent === void 0 ? void 0 : wrapperComponent.contains(target);
    var isAllowed = isInitialized && target && isWrapperChild && !disabled;
    if (!isAllowed)
        return false;
    var isExcluded = isExcludedNode(target, excluded);
    if (isExcluded)
        return false;
    return true;
};

var ZoomPanPinch = /** @class */ (function () {
    function ZoomPanPinch(props) {
        var _this = this;
        this.mounted = true;
        this.onChangeCallbacks = new Set();
        this.onInitCallbacks = new Set();
        this.onTransformCallbacks = new Set();
        // Components
        this.wrapperComponent = null;
        this.contentComponent = null;
        // Initialization
        this.isInitialized = false;
        this.bounds = null;
        // wheel helpers
        this.previousWheelEvent = null;
        this.wheelStopEventTimer = null;
        this.wheelAnimationTimer = null;
        // panning helpers
        this.isPanning = false;
        this.isWheelPanning = false;
        this.startCoords = null;
        this.panStartPosition = null;
        this.lastTouch = null;
        // pinch helpers
        this.isPinching = false;
        this.distance = null;
        this.lastDistance = null;
        this.pinchStartDistance = null;
        this.pinchStartScale = null;
        this.pinchMidpoint = null;
        this.pinchPreviousCenter = null;
        // double click helpers
        this.doubleClickStopEventTimer = null;
        // velocity helpers
        this.velocity = null;
        this.velocityTime = null;
        this.lastMousePosition = null;
        // animations helpers
        this.isAnimating = false;
        this.animation = null;
        // key press
        this.pressedKeys = {};
        this.mount = function () {
            _this.initializeWindowEvents();
        };
        this.unmount = function () {
            _this.cleanupWindowEvents();
        };
        this.update = function (newProps) {
            _this.props = newProps;
            if (_this.wrapperComponent && _this.contentComponent) {
                handleCalculateBounds(_this, _this.state.scale);
            }
            _this.setup = createSetup(newProps);
        };
        this.initializeWindowEvents = function () {
            var _a, _b, _c, _d;
            var passive = makePassiveEventOption();
            var currentDocument = (_a = _this.wrapperComponent) === null || _a === void 0 ? void 0 : _a.ownerDocument;
            var currentWindow = currentDocument === null || currentDocument === void 0 ? void 0 : currentDocument.defaultView;
            (_b = _this.wrapperComponent) === null || _b === void 0 ? void 0 : _b.addEventListener("wheel", _this.onWheelPanning, passive);
            (_c = _this.wrapperComponent) === null || _c === void 0 ? void 0 : _c.addEventListener("keyup", _this.setKeyUnPressed, passive);
            (_d = _this.wrapperComponent) === null || _d === void 0 ? void 0 : _d.addEventListener("keydown", _this.setKeyPressed, passive);
            // Panning on window to allow panning when mouse is out of component wrapper
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.addEventListener("mousedown", _this.onPanningStart, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.addEventListener("mousemove", _this.onPanning, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.addEventListener("mouseup", _this.onPanningStop, passive);
            currentDocument === null || currentDocument === void 0 ? void 0 : currentDocument.addEventListener("mouseleave", _this.clearPanning, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.addEventListener("keyup", _this.setKeyUnPressed, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.addEventListener("keydown", _this.setKeyPressed, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.addEventListener("blur", _this.handleWindowBlur);
        };
        this.cleanupWindowEvents = function () {
            var _a, _b, _c, _d, _e;
            var passive = makePassiveEventOption();
            var currentDocument = (_a = _this.wrapperComponent) === null || _a === void 0 ? void 0 : _a.ownerDocument;
            var currentWindow = currentDocument === null || currentDocument === void 0 ? void 0 : currentDocument.defaultView;
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.removeEventListener("mousedown", _this.onPanningStart, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.removeEventListener("mousemove", _this.onPanning, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.removeEventListener("mouseup", _this.onPanningStop, passive);
            currentDocument === null || currentDocument === void 0 ? void 0 : currentDocument.removeEventListener("mouseleave", _this.clearPanning, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.removeEventListener("keyup", _this.setKeyUnPressed, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.removeEventListener("keydown", _this.setKeyPressed, passive);
            currentWindow === null || currentWindow === void 0 ? void 0 : currentWindow.removeEventListener("blur", _this.handleWindowBlur);
            document.removeEventListener("mouseleave", _this.clearPanning, passive);
            (_b = _this.wrapperComponent) === null || _b === void 0 ? void 0 : _b.removeEventListener("wheel", _this.onWheelPanning, passive);
            (_c = _this.wrapperComponent) === null || _c === void 0 ? void 0 : _c.removeEventListener("keyup", _this.setKeyUnPressed, passive);
            (_d = _this.wrapperComponent) === null || _d === void 0 ? void 0 : _d.removeEventListener("keydown", _this.setKeyPressed, passive);
            handleCancelAnimation(_this);
            (_e = _this.observer) === null || _e === void 0 ? void 0 : _e.disconnect();
        };
        this.handleInitializeWrapperEvents = function (wrapper) {
            // Zooming events on wrapper
            var passive = makePassiveEventOption();
            wrapper.addEventListener("wheel", _this.onWheelZoom, passive);
            wrapper.addEventListener("dblclick", _this.onDoubleClick, passive);
            wrapper.addEventListener("touchstart", _this.onTouchPanningStart, passive);
            wrapper.addEventListener("touchmove", _this.onTouchPanning, passive);
            wrapper.addEventListener("touchend", _this.onTouchPanningStop, passive);
        };
        this.handleInitialize = function (contentComponent) {
            var centerOnInit = _this.setup.centerOnInit;
            _this.applyTransformation();
            _this.onInitCallbacks.forEach(function (callback) { return callback(getContext(_this)); });
            if (centerOnInit) {
                _this.setCenter();
                _this.observer = new ResizeObserver(function () {
                    var _a;
                    var currentWidth = contentComponent.offsetWidth;
                    var currentHeight = contentComponent.offsetHeight;
                    if (currentWidth > 0 || currentHeight > 0) {
                        _this.onInitCallbacks.forEach(function (callback) {
                            return callback(getContext(_this));
                        });
                        _this.setCenter();
                        (_a = _this.observer) === null || _a === void 0 ? void 0 : _a.disconnect();
                    }
                });
                // TODO: CHANGE to first interaction?
                // if nothing about the contentComponent has changed after 5 seconds, disconnect the observer
                setTimeout(function () {
                    var _a;
                    (_a = _this.observer) === null || _a === void 0 ? void 0 : _a.disconnect();
                }, 5000);
                // Start observing the target node for configured mutations
                _this.observer.observe(contentComponent);
            }
        };
        /// ///////
        // Zoom
        /// ///////
        this.onWheelZoom = function (event) {
            var disabled = _this.setup.disabled;
            if (disabled)
                return;
            _this.syncModifierKeys(event);
            var isAllowed = isWheelAllowed(_this, event);
            if (!isAllowed)
                return;
            handleWheelStart(_this, event);
            handleWheelZoom(_this, event);
            handleWheelStop(_this, event);
        };
        /// ///////
        // Track Pad Panning
        /// ///////
        this.onWheelPanning = function (event) {
            var onPanning = _this.props.onPanning;
            var trackPadPanning = _this.setup.trackPadPanning;
            var lockAxisX = trackPadPanning.lockAxisX, lockAxisY = trackPadPanning.lockAxisY;
            _this.syncModifierKeys(event);
            var isAllowed = isWheelPanningAllowed(_this, event);
            if (!isAllowed)
                return;
            event.preventDefault();
            event.stopPropagation();
            var _a = _this.state, positionX = _a.positionX, positionY = _a.positionY;
            var mouseX = positionX - event.deltaX;
            var mouseY = positionY - event.deltaY;
            var newPositionX = lockAxisX ? positionX : mouseX;
            var newPositionY = lockAxisY ? positionY : mouseY;
            var _b = _this.setup.autoAlignment, sizeX = _b.sizeX, sizeY = _b.sizeY;
            var paddingValueX = getPaddingValue(_this, sizeX);
            var paddingValueY = getPaddingValue(_this, sizeY);
            if (newPositionX === positionX && newPositionY === positionY)
                return;
            handleWheelPanningStart(_this, event);
            handleNewPosition(_this, newPositionX, newPositionY, paddingValueX, paddingValueY);
            handleCallback(getContext(_this), event, onPanning);
            handleWheelPanningStop(_this, event);
        };
        /// ///////
        // Pan
        /// ///////
        this.onPanningStart = function (event) {
            var disabled = _this.setup.disabled;
            var onPanningStart = _this.props.onPanningStart;
            if (disabled)
                return;
            _this.syncModifierKeys(event);
            var isAllowed = isPanningStartAllowed(_this, event);
            if (!isAllowed)
                return;
            var keysPressed = _this.isPressingKeys(_this.setup.panning.activationKeys);
            if (!keysPressed)
                return;
            if (event.button === 0 && !_this.setup.panning.allowLeftClickPan)
                return;
            if (event.button === 1 && !_this.setup.panning.allowMiddleClickPan)
                return;
            if (event.button === 2 && !_this.setup.panning.allowRightClickPan)
                return;
            event.preventDefault();
            event.stopPropagation();
            handleCancelAnimation(_this);
            handlePanningStart(_this, event);
            handleCallback(getContext(_this), event, onPanningStart);
        };
        this.onPanning = function (event) {
            var disabled = _this.setup.disabled;
            var onPanning = _this.props.onPanning;
            if (disabled)
                return;
            _this.syncModifierKeys(event);
            // Detect missed mouseup — e.g. when the mouse was released outside an
            // iframe boundary where the host frame swallows the mouseup event.
            if (_this.isPanning && event.buttons === 0) {
                _this.clearPanning(event);
                return;
            }
            var isAllowed = isPanningAllowed(_this);
            if (!isAllowed)
                return;
            var keysPressed = _this.isPressingKeys(_this.setup.panning.activationKeys);
            if (!keysPressed)
                return;
            event.preventDefault();
            event.stopPropagation();
            handlePanning(_this, event.clientX, event.clientY, exports.DeviceType.MOUSE);
            handleCallback(getContext(_this), event, onPanning);
        };
        this.onPanningStop = function (event) {
            var velocityDisabled = _this.setup.panning.velocityDisabled;
            var onPanningStop = _this.props.onPanningStop;
            if (_this.isPanning) {
                handlePanningEnd(_this, velocityDisabled);
                handleCallback(getContext(_this), event, onPanningStop);
            }
        };
        /// ///////
        // Pinch
        /// ///////
        this.onPinchStart = function (event) {
            var disabled = _this.setup.disabled;
            var onPinchStart = _this.props.onPinchStart;
            if (disabled)
                return;
            var isAllowed = isPinchStartAllowed(_this, event);
            if (!isAllowed)
                return;
            handlePinchStart(_this, event);
            handleCancelAnimation(_this);
            handleCallback(getContext(_this), event, onPinchStart);
        };
        this.onPinch = function (event) {
            var disabled = _this.setup.disabled;
            var onPinch = _this.props.onPinch;
            if (disabled)
                return;
            var isAllowed = isPinchAllowed(_this);
            if (!isAllowed)
                return;
            event.preventDefault();
            event.stopPropagation();
            handlePinchZoom(_this, event);
            handleCallback(getContext(_this), event, onPinch);
        };
        this.onPinchStop = function (event) {
            var onPinchStop = _this.props.onPinchStop;
            if (_this.pinchStartScale) {
                handlePinchStop(_this);
                handleCallback(getContext(_this), event, onPinchStop);
            }
        };
        /// ///////
        // Touch
        /// ///////
        this.onTouchPanningStart = function (event) {
            var _a = _this.setup, disabled = _a.disabled, doubleClick = _a.doubleClick;
            var onPanningStart = _this.props.onPanningStart;
            if (disabled)
                return;
            var isDoubleTapAllowed = !(doubleClick === null || doubleClick === void 0 ? void 0 : doubleClick.disabled);
            var isDoubleTap = _this.lastTouch && +new Date() - _this.lastTouch < 200;
            if (isDoubleTapAllowed && isDoubleTap && event.touches.length === 1) {
                _this.onDoubleClick(event);
            }
            else {
                _this.lastTouch = +new Date();
                handleCancelAnimation(_this);
                var touches = event.touches;
                var isPanningAction = touches.length === 1;
                var isPinchAction = touches.length === 2;
                var isAllowed = isPanningStartAllowed(_this, event);
                if (isPanningAction) {
                    if (!isAllowed)
                        return;
                    handleCancelAnimation(_this);
                    handlePanningStart(_this, event);
                    handleCallback(getContext(_this), event, onPanningStart);
                }
                if (isPinchAction) {
                    _this.onPinchStart(event);
                }
            }
        };
        this.onTouchPanning = function (event) {
            var disabled = _this.setup.disabled;
            var onPanning = _this.props.onPanning;
            if (_this.isPanning && event.touches.length === 1) {
                if (disabled)
                    return;
                var isAllowed = isPanningAllowed(_this);
                if (!isAllowed)
                    return;
                if (event.cancelable) {
                    event.preventDefault();
                }
                event.stopPropagation();
                var touch = event.touches[0];
                handlePanning(_this, touch.clientX, touch.clientY, exports.DeviceType.TOUCH);
                handleCallback(getContext(_this), event, onPanning);
            }
            else if (event.touches.length > 1) {
                _this.onPinch(event);
            }
        };
        this.onTouchPanningStop = function (event) {
            _this.onPanningStop(event);
            _this.onPinchStop(event);
        };
        /// ///////
        // Double Click
        /// ///////
        this.onDoubleClick = function (event) {
            var disabled = _this.setup.disabled;
            if (disabled)
                return;
            var isAllowed = isDoubleClickAllowed(_this, event);
            if (!isAllowed)
                return;
            handleDoubleClick(_this, event);
        };
        /// ///////
        // Helpers
        /// ///////
        this.clearPanning = function (event) {
            if (_this.isPanning) {
                _this.onPanningStop(event);
            }
        };
        // When the window loses focus (e.g. user clicks outside an iframe),
        // keyup and mouseup events are swallowed by the parent frame. Clear all
        // tracked state to prevent stale activation keys or ghost panning.
        this.handleWindowBlur = function () {
            _this.pressedKeys = {};
            if (_this.isPanning) {
                _this.isPanning = false;
                _this.startCoords = null;
            }
        };
        // Iframe focus problem (e.g. Storybook):
        //
        // When the library runs inside an iframe, keyboard events (keydown/keyup)
        // only reach the iframe's window when it has focus. If the user navigates
        // via the host UI (e.g. Storybook sidebar) the iframe never receives
        // focus, so keydown never fires and activationKeys like Cmd/Ctrl are
        // invisible to pressedKeys.
        //
        // Mouse and wheel events, however, DO reach the iframe regardless of
        // focus — and they carry modifier flags (ctrlKey, metaKey, shiftKey,
        // altKey) that always reflect the real physical key state at event time.
        //
        // We sync those flags into pressedKeys on every interaction event so
        // that activationKeys checks work without requiring iframe focus.
        // Both pressed (true) AND released (false) states must be written;
        // writing only `true` would leave stale keys after release because
        // keyup never fires in an unfocused iframe.
        this.syncModifierKeys = function (event) {
            var ctrlKey = event.ctrlKey, metaKey = event.metaKey, shiftKey = event.shiftKey, altKey = event.altKey;
            if (typeof ctrlKey === "boolean")
                _this.pressedKeys.Control = ctrlKey;
            if (typeof metaKey === "boolean")
                _this.pressedKeys.Meta = metaKey;
            if (typeof shiftKey === "boolean")
                _this.pressedKeys.Shift = shiftKey;
            if (typeof altKey === "boolean")
                _this.pressedKeys.Alt = altKey;
        };
        this.setKeyPressed = function (e) {
            _this.pressedKeys[e.key] = true;
        };
        this.setKeyUnPressed = function (e) {
            _this.pressedKeys[e.key] = false;
        };
        this.isPressingKeys = function (keys) {
            if (typeof keys === "function") {
                return keys(Object.entries(_this.pressedKeys)
                    .filter(function (_a) {
                    var pressed = _a[1];
                    return pressed;
                })
                    .map(function (_a) {
                    var key = _a[0];
                    return key;
                }));
            }
            if (!keys.length) {
                return true;
            }
            return Boolean(keys.every(function (key) { return _this.pressedKeys[key]; }));
        };
        this.setCenter = function () {
            if (_this.wrapperComponent && _this.contentComponent) {
                var targetState = getCenterPosition(_this.state.scale, _this.wrapperComponent, _this.contentComponent);
                _this.setState(targetState.scale, targetState.positionX, targetState.positionY);
            }
        };
        this.handleTransformStyles = function (x, y, scale) {
            if (_this.props.customTransform) {
                return _this.props.customTransform(x, y, scale);
            }
            return getTransformStyles(x, y, scale);
        };
        this.getContext = function () {
            return getContext(_this);
        };
        this.applyTransformation = function () {
            if (!_this.mounted || !_this.contentComponent)
                return;
            var _a = _this.state, scale = _a.scale, positionX = _a.positionX, positionY = _a.positionY;
            var transform = _this.handleTransformStyles(positionX, positionY, scale);
            // Detached mode do not apply transformation directly to content component
            if (!_this.props.detached) {
                _this.contentComponent.style.transform = transform;
            }
            _this.onTransformCallbacks.forEach(function (callback) {
                return callback({
                    scale: scale,
                    positionX: positionX,
                    positionY: positionY,
                    previousScale: _this.state.previousScale,
                    ref: getContext(_this),
                });
            });
        };
        this.setState = function (scale, positionX, positionY) {
            var onTransform = _this.props.onTransform;
            if (!Number.isNaN(scale) &&
                !Number.isNaN(positionX) &&
                !Number.isNaN(positionY)) {
                var safeScale = Math.max(scale, 1e-7);
                if (safeScale !== _this.state.scale) {
                    _this.state.previousScale = _this.state.scale;
                    _this.state.scale = safeScale;
                }
                _this.state.positionX = positionX;
                _this.state.positionY = positionY;
                _this.applyTransformation();
                var ctx_1 = getContext(_this);
                _this.onChangeCallbacks.forEach(function (callback) { return callback(ctx_1); });
                handleCallback(ctx_1, { scale: _this.state.scale, positionX: positionX, positionY: positionY }, onTransform);
            }
            else {
                console.error("Detected NaN set state values");
            }
        };
        /**
         * Hooks
         */
        this.onTransform = function (callback) {
            if (!_this.onTransformCallbacks.has(callback)) {
                _this.onTransformCallbacks.add(callback);
            }
            return function () {
                _this.onTransformCallbacks.delete(callback);
            };
        };
        this.onChange = function (callback) {
            if (!_this.onChangeCallbacks.has(callback)) {
                _this.onChangeCallbacks.add(callback);
            }
            return function () {
                _this.onChangeCallbacks.delete(callback);
            };
        };
        this.onInit = function (callback) {
            if (!_this.onInitCallbacks.has(callback)) {
                _this.onInitCallbacks.add(callback);
            }
            return function () {
                _this.onInitCallbacks.delete(callback);
            };
        };
        /**
         * Initialization
         */
        this.init = function (wrapperComponent, contentComponent) {
            _this.cleanupWindowEvents();
            _this.wrapperComponent = wrapperComponent;
            _this.contentComponent = contentComponent;
            handleCalculateBounds(_this, _this.state.scale);
            _this.handleInitializeWrapperEvents(wrapperComponent);
            _this.handleInitialize(contentComponent);
            _this.initializeWindowEvents();
            _this.isInitialized = true;
            var ctx = getContext(_this);
            handleCallback(ctx, undefined, _this.props.onInit);
            assignRef(_this.props.ref, ctx);
        };
        this.props = props;
        this.setup = createSetup(this.props);
        this.state = createState(this.props);
    }
    return ZoomPanPinch;
}());

var Context = React.createContext(null);
var getContent = function (children, ctx) {
    if (typeof children === "function") {
        return children(ctx);
    }
    return children;
};
var TransformWrapper = React.forwardRef(function (props, ref) {
    var instance = React.useRef(new ZoomPanPinch(props)).current;
    var content = getContent(props.children, getControls(instance));
    React.useImperativeHandle(ref, function () { return getControls(instance); }, [instance]);
    React.useEffect(function () {
        instance.update(props);
    }, [instance, props]);
    return jsxRuntime.jsx(Context.Provider, __assign({ value: instance }, { children: content }));
});

var KeepScale = React.forwardRef(function (props, ref) {
    var localRef = React.useRef(null);
    var instance = React.useContext(Context);
    React.useEffect(function () {
        return instance.onChange(function (ctx) {
            if (localRef.current) {
                var positionX = 0;
                var positionY = 0;
                localRef.current.style.transform = instance.handleTransformStyles(positionX, positionY, 1 / ctx.instance.state.scale);
            }
        });
    }, [instance]);
    return jsxRuntime.jsx("div", __assign({}, props, { ref: mergeRefs([localRef, ref]) }));
});

var initialElementRect = {
    width: 0,
    height: 0,
    y: 0,
    x: 0,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
};
var useResize = function (ref, onResize, dependencies) {
    var resizeObserverRef = React.useRef();
    var rectRef = React.useRef(initialElementRect);
    var didUnmount = React.useRef(false);
    React.useLayoutEffect(function () {
        var _a;
        didUnmount.current = false;
        if (!("ResizeObserver" in window)) {
            return;
        }
        if (ref) {
            resizeObserverRef.current = new ResizeObserver(function (entries) {
                var newSize = ref.getBoundingClientRect();
                if (!Array.isArray(entries) ||
                    !entries.length ||
                    didUnmount.current ||
                    (newSize.width === rectRef.current.width &&
                        newSize.height === rectRef.current.height))
                    return;
                onResize(newSize, ref);
                rectRef.current = newSize;
            });
            (_a = resizeObserverRef.current) === null || _a === void 0 ? void 0 : _a.observe(ref);
        }
        return function () {
            var _a;
            didUnmount.current = true;
            if (ref) {
                (_a = resizeObserverRef.current) === null || _a === void 0 ? void 0 : _a.unobserve(ref);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, __spreadArray([onResize, ref], dependencies, true));
};

var previewStyles = {
    position: "absolute",
    zIndex: 2,
    top: "0px",
    left: "0px",
    boxSizing: "border-box",
    border: "3px solid red",
    transformOrigin: "0% 0%",
    boxShadow: "rgba(0,0,0,0.2) 0 0 0 10000000px",
    pointerEvents: "none",
};
var MiniMap = function (_a) {
    var _b = _a.width, width = _b === void 0 ? 200 : _b, _c = _a.height, height = _c === void 0 ? 200 : _c, _d = _a.borderColor, borderColor = _d === void 0 ? "red" : _d, previewStyle = _a.previewStyle, wrapperClassName = _a.wrapperClassName, previewClassName = _a.previewClassName, children = _a.children, _e = _a.panning, panning = _e === void 0 ? true : _e, rest = __rest(_a, ["width", "height", "borderColor", "previewStyle", "wrapperClassName", "previewClassName", "children", "panning"]);
    var _f = React.useState(false), initialized = _f[0], setInitialized = _f[1];
    var instance = useTransformContext();
    var _g = React.useState(false), isDown = _g[0], setIsDown = _g[1];
    var miniMapInstance = React.useRef(null);
    var mainRef = React.useRef(null);
    var wrapperRef = React.useRef(null);
    var previewRef = React.useRef(null);
    var getViewportSize = React.useCallback(function () {
        if (instance.wrapperComponent) {
            var rect = instance.wrapperComponent.getBoundingClientRect();
            return {
                width: rect.width,
                height: rect.height,
            };
        }
        return {
            width: 0,
            height: 0,
        };
    }, [instance.wrapperComponent]);
    var getContentSize = React.useCallback(function () {
        if (instance.contentComponent) {
            var rect = instance.contentComponent.getBoundingClientRect();
            return {
                width: rect.width / instance.state.scale,
                height: rect.height / instance.state.scale,
            };
        }
        return {
            width: 0,
            height: 0,
        };
    }, [instance.contentComponent, instance.state.scale]);
    var computeMiniMapScale = React.useCallback(function () {
        var contentSize = getContentSize();
        var scaleX = width / contentSize.width;
        var scaleY = height / contentSize.height;
        var scale = scaleY > scaleX ? scaleX : scaleY;
        return scale;
    }, [getContentSize, height, width]);
    var computeMiniMapSize = function () {
        var contentSize = getContentSize();
        var scaleX = width / contentSize.width;
        var scaleY = height / contentSize.height;
        if (scaleY > scaleX) {
            return { width: width, height: contentSize.height * scaleX };
        }
        return { width: contentSize.width * scaleY, height: height };
    };
    var computeMiniMapStyle = function () {
        var scale = computeMiniMapScale();
        var style = {
            transform: "scale(".concat(scale || 1, ")"),
            transformOrigin: "0% 0%",
            position: "absolute",
            boxSizing: "border-box",
            zIndex: 1,
            // overflow: "hidden",
        };
        if (wrapperRef.current) {
            var el = wrapperRef.current.style;
            el.transform = style.transform;
            el.transformOrigin = style.transformOrigin;
            el.position = style.position;
            el.boxSizing = style.boxSizing;
            el.zIndex = String(style.zIndex);
        }
    };
    var transformMiniMap = function () {
        computeMiniMapStyle();
        var miniSize = computeMiniMapSize();
        var wrapSize = getContentSize();
        if (wrapperRef.current) {
            wrapperRef.current.style.width = "".concat(wrapSize.width, "px");
            wrapperRef.current.style.height = "".concat(wrapSize.height, "px");
        }
        if (mainRef.current) {
            mainRef.current.style.width = "".concat(miniSize.width, "px");
            mainRef.current.style.height = "".concat(miniSize.height, "px");
        }
        if (previewRef.current) {
            var size = getViewportSize();
            var scale = computeMiniMapScale();
            var previewScale = scale * (1 / instance.state.scale);
            var transform = instance.handleTransformStyles(-instance.state.positionX * previewScale, -instance.state.positionY * previewScale, 1);
            previewRef.current.style.transform = transform;
            previewRef.current.style.width = "".concat(size.width * previewScale, "px");
            previewRef.current.style.height = "".concat(size.height * previewScale, "px");
        }
    };
    var initialize = function () {
        transformMiniMap();
    };
    useTransformEffect(function () {
        transformMiniMap();
    });
    useTransformInit(function () {
        initialize();
        setInitialized(true);
    });
    useResize(instance.contentComponent, initialize, [initialized]);
    React.useEffect(function () {
        return instance.onChange(function (zpp) {
            var scale = computeMiniMapScale();
            if (miniMapInstance.current) {
                miniMapInstance.current.instance.state.scale = zpp.instance.state.scale;
                miniMapInstance.current.instance.state.positionX =
                    zpp.instance.state.positionX * scale;
                miniMapInstance.current.instance.state.positionY =
                    zpp.instance.state.positionY * scale;
            }
        });
    }, [computeMiniMapScale, instance, miniMapInstance]);
    React.useEffect(function () {
        var move = function (e) {
            var _a, _b;
            if (panning &&
                isDown &&
                instance.contentComponent &&
                previewRef.current &&
                mainRef.current) {
                var scale = computeMiniMapScale();
                var previewRect = previewRef.current.getBoundingClientRect();
                var mainRect = mainRef.current.getBoundingClientRect();
                var relativeX = (e.clientX - mainRect.left) / scale;
                var relativeY = (e.clientY - mainRect.top) / scale;
                var x = relativeX - previewRect.width / 2;
                var y = relativeY - previewRect.height / 2;
                var instanceWidth = (((_a = instance.wrapperComponent) === null || _a === void 0 ? void 0 : _a.offsetWidth) || 0) * instance.state.scale;
                var instanceHeight = (((_b = instance.wrapperComponent) === null || _b === void 0 ? void 0 : _b.offsetHeight) || 0) * instance.state.scale;
                var limitWidth = instanceWidth - previewRect.width * 2 * instance.state.scale;
                var limitHeight = instanceHeight - previewRect.height * 2 * instance.state.scale;
                var boundedX = boundLimiter(x * instance.state.scale, 0, limitWidth, true);
                var boundedY = boundLimiter(y * instance.state.scale, 0, limitHeight, true);
                instance.setState(instance.state.scale, -boundedX, -boundedY);
            }
        };
        var setDown = function (e) {
            var _a;
            if (((_a = mainRef.current) === null || _a === void 0 ? void 0 : _a.contains(e.target)) ||
                e.target === mainRef.current) {
                move(e);
                setIsDown(true);
            }
        };
        var setUp = function () {
            setIsDown(false);
        };
        document.addEventListener("mousedown", setDown);
        document.addEventListener("mouseup", setUp);
        document.addEventListener("mousemove", move);
        return function () {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", setUp);
        };
    });
    var wrapperStyle = React.useMemo(function () {
        return {
            position: "relative",
            zIndex: 2,
            // overflow: "hidden",
            userSelect: "none",
        };
    }, []);
    return (jsxRuntime.jsxs("div", __assign({}, rest, { ref: mainRef, style: wrapperStyle, className: "rzpp-mini-map ".concat(rest.className || "").trim() }, { children: [jsxRuntime.jsx("div", __assign({ style: { pointerEvents: "none" }, ref: wrapperRef, className: "rzpp-minimap-wrapper ".concat(wrapperClassName || "").trim() }, { children: children })), jsxRuntime.jsx("div", { className: "rzpp-minimap-preview ".concat(previewClassName || "").trim(), ref: previewRef, style: __assign(__assign(__assign({}, previewStyles), { borderColor: borderColor }), previewStyle) })] })));
};

function styleInject(css, ref) {
  if ( ref === void 0 ) ref = {};
  var insertAt = ref.insertAt;

  if (!css || typeof document === 'undefined') { return; }

  var head = document.head || document.getElementsByTagName('head')[0];
  var style = document.createElement('style');
  style.type = 'text/css';

  if (insertAt === 'top') {
    if (head.firstChild) {
      head.insertBefore(style, head.firstChild);
    } else {
      head.appendChild(style);
    }
  } else {
    head.appendChild(style);
  }

  if (style.styleSheet) {
    style.styleSheet.cssText = css;
  } else {
    style.appendChild(document.createTextNode(css));
  }
}

var css_248z = ".transform-component-module_wrapper__SPB86 {\n  position: relative;\n  width: -moz-fit-content;\n  width: fit-content;\n  height: -moz-fit-content;\n  height: fit-content;\n  overflow: hidden;\n  -webkit-touch-callout: none; /* iOS Safari */\n  -webkit-user-select: none; /* Safari */\n  -khtml-user-select: none; /* Konqueror HTML */\n  -moz-user-select: none; /* Firefox */\n  -ms-user-select: none; /* Internet Explorer/Edge */\n  user-select: none;\n  margin: 0;\n  padding: 0;\n  transform: translate3d(0, 0, 0);\n}\n.transform-component-module_content__FBWxo {\n  display: flex;\n  flex-wrap: wrap;\n  width: -moz-fit-content;\n  width: fit-content;\n  height: -moz-fit-content;\n  height: fit-content;\n  margin: 0;\n  padding: 0;\n  transform-origin: 0% 0%;\n}\n.transform-component-module_content__FBWxo img {\n  pointer-events: none;\n}\n.transform-component-module_infiniteGrid__Z-aP3 {\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n  background-image: radial-gradient(\n    circle,\n    rgba(0, 0, 0, 0.12) 1px,\n    transparent 1px\n  );\n  background-size: 20px 20px;\n  background-position: 0 0;\n}\n";
var styles = {"wrapper":"transform-component-module_wrapper__SPB86","content":"transform-component-module_content__FBWxo","infiniteGrid":"transform-component-module_infiniteGrid__Z-aP3"};
styleInject(css_248z);

var TransformComponent = function (_a) {
    var children = _a.children, _b = _a.wrapperClass, wrapperClass = _b === void 0 ? "" : _b, _c = _a.contentClass, contentClass = _c === void 0 ? "" : _c, wrapperStyle = _a.wrapperStyle, contentStyle = _a.contentStyle, _d = _a.wrapperProps, wrapperProps = _d === void 0 ? {} : _d, _e = _a.contentProps, contentProps = _e === void 0 ? {} : _e, _f = _a.infinite, infinite = _f === void 0 ? false : _f;
    var instance = React.useContext(Context);
    var init = instance.init, cleanupWindowEvents = instance.cleanupWindowEvents;
    var wrapperRef = React.useRef(null);
    var contentRef = React.useRef(null);
    var gridRef = React.useRef(null);
    React.useEffect(function () {
        var wrapper = wrapperRef.current;
        var content = contentRef.current;
        if (wrapper !== null && content !== null && init) {
            init === null || init === void 0 ? void 0 : init(wrapper, content);
        }
        return function () {
            cleanupWindowEvents === null || cleanupWindowEvents === void 0 ? void 0 : cleanupWindowEvents();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    React.useEffect(function () {
        if (!infinite)
            return;
        var grid = gridRef.current;
        if (!grid)
            return;
        var sync = function () {
            var _a = instance.state, positionX = _a.positionX, positionY = _a.positionY;
            grid.style.backgroundPosition = "".concat(positionX, "px ").concat(positionY, "px");
        };
        sync();
        return instance.onChange(sync);
    }, [infinite, instance]);
    return (jsxRuntime.jsxs("div", __assign({}, wrapperProps, { ref: wrapperRef, className: "".concat(baseClasses.wrapperClass, " ").concat(styles.wrapper, " ").concat(wrapperClass), style: wrapperStyle }, { children: [infinite && (jsxRuntime.jsx("div", { ref: gridRef, className: styles.infiniteGrid, "aria-hidden": true })), jsxRuntime.jsx("div", __assign({}, contentProps, { ref: contentRef, className: "".concat(baseClasses.contentClass, " ").concat(styles.content, " ").concat(contentClass), style: __assign(__assign({}, contentStyle), { transform: getTransformStyles(instance.state.positionX, instance.state.positionY, instance.state.scale) }) }, { children: children }))] })));
};

/**
 * Compute the overlap area between two axis-aligned rectangles.
 * Returns 0 when the rectangles do not intersect.
 */
function getOverlapArea(a, b) {
    var overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    var overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return overlapX * overlapY;
}
/**
 * Determine whether an element's content-space bounding box is visible
 * in the current viewport, accounting for transform, margin, and threshold.
 */
function isElementVisible(opts) {
    var elementX = opts.elementX, elementY = opts.elementY, elementWidth = opts.elementWidth, elementHeight = opts.elementHeight, scale = opts.scale, positionX = opts.positionX, positionY = opts.positionY, viewportWidth = opts.viewportWidth, viewportHeight = opts.viewportHeight, _a = opts.margin, margin = _a === void 0 ? 0 : _a, _b = opts.threshold, threshold = _b === void 0 ? 0 : _b;
    var viewport = {
        x: -margin,
        y: -margin,
        width: viewportWidth + 2 * margin,
        height: viewportHeight + 2 * margin,
    };
    var element = {
        x: elementX * scale + positionX,
        y: elementY * scale + positionY,
        width: elementWidth * scale,
        height: elementHeight * scale,
    };
    if (threshold <= 0) {
        var intersectsX = element.x < viewport.x + viewport.width &&
            element.x + element.width > viewport.x;
        var intersectsY = element.y < viewport.y + viewport.height &&
            element.y + element.height > viewport.y;
        return intersectsX && intersectsY;
    }
    var elementArea = element.width * element.height;
    if (elementArea <= 0)
        return false;
    var overlap = getOverlapArea(viewport, element);
    return overlap / elementArea >= threshold;
}

var Virtualize = React.forwardRef(function (_a, ref) {
    var x = _a.x, y = _a.y, width = _a.width, height = _a.height, _b = _a.margin, margin = _b === void 0 ? 0 : _b, _c = _a.threshold, threshold = _c === void 0 ? 0 : _c, _d = _a.placeholder, placeholder = _d === void 0 ? null : _d, onShow = _a.onShow, onHide = _a.onHide, children = _a.children, className = _a.className, style = _a.style;
    var instance = React.useContext(Context);
    var _e = React.useState(false), visible = _e[0], setVisible = _e[1];
    var visibleRef = React.useRef(false);
    var onShowRef = React.useRef(onShow);
    var onHideRef = React.useRef(onHide);
    onShowRef.current = onShow;
    onHideRef.current = onHide;
    React.useEffect(function () {
        var check = function () {
            var _a, _b;
            var wrapper = instance.wrapperComponent;
            if (!wrapper)
                return;
            var nowVisible = isElementVisible({
                elementX: x,
                elementY: y,
                elementWidth: width,
                elementHeight: height,
                scale: instance.state.scale,
                positionX: instance.state.positionX,
                positionY: instance.state.positionY,
                viewportWidth: wrapper.offsetWidth,
                viewportHeight: wrapper.offsetHeight,
                margin: margin,
                threshold: threshold,
            });
            if (nowVisible !== visibleRef.current) {
                visibleRef.current = nowVisible;
                setVisible(nowVisible);
                if (nowVisible) {
                    (_a = onShowRef.current) === null || _a === void 0 ? void 0 : _a.call(onShowRef);
                }
                else {
                    (_b = onHideRef.current) === null || _b === void 0 ? void 0 : _b.call(onHideRef);
                }
            }
        };
        check();
        var unsubChange = instance.onChange(check);
        var unsubInit;
        if (!instance.wrapperComponent) {
            unsubInit = instance.onInit(function () { return check(); });
        }
        return function () {
            unsubChange();
            unsubInit === null || unsubInit === void 0 ? void 0 : unsubInit();
        };
    }, [instance, x, y, width, height, margin, threshold]);
    if (!visible) {
        // eslint-disable-next-line react/jsx-no-useless-fragment
        return placeholder ? jsxRuntime.jsx(jsxRuntime.Fragment, { children: placeholder }) : null;
    }
    return (jsxRuntime.jsx("div", __assign({ ref: ref, className: className, style: style }, { children: children })));
});

var useTransformContext = function () {
    var libraryContext = React.useContext(Context);
    if (!libraryContext) {
        throw new Error("Transform context must be placed inside TransformWrapper");
    }
    return libraryContext;
};

var useControls = function () {
    var libraryContext = useTransformContext();
    return getControls(libraryContext);
};

var useTransformInit = function (callback) {
    var libraryContext = useTransformContext();
    React.useEffect(function () {
        var unmountCallback;
        var unmount;
        if (libraryContext.contentComponent && libraryContext.wrapperComponent) {
            unmountCallback = callback(getState(libraryContext));
        }
        else {
            unmount = libraryContext.onInit(function (ref) {
                unmountCallback = callback(getState(ref.instance));
            });
        }
        return function () {
            unmount === null || unmount === void 0 ? void 0 : unmount();
            unmountCallback === null || unmountCallback === void 0 ? void 0 : unmountCallback();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
};

var useTransformEffect = function (callback) {
    var libraryContext = useTransformContext();
    React.useEffect(function () {
        var unmountCallback;
        var unmount = libraryContext.onChange(function (ref) {
            unmountCallback = callback(getState(ref.instance));
        });
        return function () {
            unmount();
            unmountCallback === null || unmountCallback === void 0 ? void 0 : unmountCallback();
        };
    }, [callback, libraryContext]);
};

function useTransformComponent(callback) {
    var libraryContext = useTransformContext();
    var _a = React.useState(callback(getState(libraryContext))), transformRender = _a[0], setTransformRender = _a[1];
    React.useEffect(function () {
        var mounted = true;
        var unmount = libraryContext.onChange(function (ref) {
            if (mounted) {
                setTransformRender(callback(getState(ref.instance)));
            }
        });
        return function () {
            unmount();
            mounted = false;
        };
    }, [callback, libraryContext]);
    return transformRender;
}

exports.Context = Context;
exports.KeepScale = KeepScale;
exports.MiniMap = MiniMap;
exports.TransformComponent = TransformComponent;
exports.TransformWrapper = TransformWrapper;
exports.Virtualize = Virtualize;
exports.getCenterPosition = getCenterPosition;
exports.getMatrixTransformStyles = getMatrixTransformStyles;
exports.getTransformStyles = getTransformStyles;
exports.roundScaleForTransform = roundScaleForTransform;
exports.useControls = useControls;
exports.useTransformComponent = useTransformComponent;
exports.useTransformContext = useTransformContext;
exports.useTransformEffect = useTransformEffect;
exports.useTransformInit = useTransformInit;
//# sourceMappingURL=index.cjs.js.map
