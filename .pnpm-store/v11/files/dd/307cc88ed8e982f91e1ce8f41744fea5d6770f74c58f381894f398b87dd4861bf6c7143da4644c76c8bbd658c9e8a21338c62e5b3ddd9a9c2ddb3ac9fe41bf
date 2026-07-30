import { createElement, PureComponent } from 'react';
import Draggable from 'react-draggable';
import { Resizable } from 're-resizable';
import { flushSync } from 'react-dom';

/*! *****************************************************************************
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */
/* global Reflect, Promise */

var extendStatics = function(d, b) {
    extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return extendStatics(d, b);
};

function __extends(d, b) {
    extendStatics(d, b);
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}

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

var resizableStyle = {
    width: "auto",
    height: "auto",
    display: "inline-block",
    position: "absolute",
    top: 0,
    left: 0,
};
var getEnableResizingByFlag = function (flag) { return ({
    bottom: flag,
    bottomLeft: flag,
    bottomRight: flag,
    left: flag,
    right: flag,
    top: flag,
    topLeft: flag,
    topRight: flag,
}); };
var Rnd = /** @class */ (function (_super) {
    __extends(Rnd, _super);
    function Rnd(props) {
        var _this = _super.call(this, props) || this;
        _this.resizingPosition = { x: 0, y: 0 };
        _this.offsetFromParent = { left: 0, top: 0 };
        _this.resizableElement = { current: null };
        _this.originalPosition = { x: 0, y: 0 };
        _this.state = {
            resizing: false,
            bounds: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
            },
            maxWidth: props.maxWidth,
            maxHeight: props.maxHeight,
        };
        _this.onResizeStart = _this.onResizeStart.bind(_this);
        _this.onResize = _this.onResize.bind(_this);
        _this.onResizeStop = _this.onResizeStop.bind(_this);
        _this.onDragStart = _this.onDragStart.bind(_this);
        _this.onDrag = _this.onDrag.bind(_this);
        _this.onDragStop = _this.onDragStop.bind(_this);
        _this.getMaxSizesFromProps = _this.getMaxSizesFromProps.bind(_this);
        return _this;
    }
    Rnd.prototype.componentDidMount = function () {
        this.updateOffsetFromParent();
        var _a = this.offsetFromParent, left = _a.left, top = _a.top;
        var _b = this.getDraggablePosition(), x = _b.x, y = _b.y;
        this.draggable.setState({
            x: x - left,
            y: y - top,
        });
        // HACK: Apply position adjustment
        this.forceUpdate();
    };
    // HACK: To get `react-draggable` state x and y.
    Rnd.prototype.getDraggablePosition = function () {
        var _a = this.draggable.state, x = _a.x, y = _a.y;
        return { x: x, y: y };
    };
    Rnd.prototype.getParent = function () {
        return this.resizable && this.resizable.parentNode;
    };
    Rnd.prototype.getParentSize = function () {
        return this.resizable.getParentSize();
    };
    Rnd.prototype.getMaxSizesFromProps = function () {
        var maxWidth = typeof this.props.maxWidth === "undefined" ? Number.MAX_SAFE_INTEGER : this.props.maxWidth;
        var maxHeight = typeof this.props.maxHeight === "undefined" ? Number.MAX_SAFE_INTEGER : this.props.maxHeight;
        return { maxWidth: maxWidth, maxHeight: maxHeight };
    };
    Rnd.prototype.getSelfElement = function () {
        return this.resizable && this.resizable.resizable;
    };
    Rnd.prototype.getOffsetHeight = function (boundary) {
        var scale = this.props.scale;
        switch (this.props.bounds) {
            case "window":
                return window.innerHeight / scale;
            case "body":
                return document.body.offsetHeight / scale;
            default:
                return boundary.offsetHeight;
        }
    };
    Rnd.prototype.getOffsetWidth = function (boundary) {
        var scale = this.props.scale;
        switch (this.props.bounds) {
            case "window":
                return window.innerWidth / scale;
            case "body":
                return document.body.offsetWidth / scale;
            default:
                return boundary.offsetWidth;
        }
    };
    Rnd.prototype.onDragStart = function (e, data) {
        if (this.props.onDragStart && this.props.onDragStart(e, data) === false) {
            return false;
        }
        var pos = this.getDraggablePosition();
        this.originalPosition = pos;
        if (!this.props.bounds)
            return;
        var parent = this.getParent();
        var scale = this.props.scale;
        var boundary;
        if (this.props.bounds === "parent") {
            boundary = parent;
        }
        else if (this.props.bounds === "body") {
            var parentRect_1 = parent.getBoundingClientRect();
            var parentLeft_1 = parentRect_1.left;
            var parentTop_1 = parentRect_1.top;
            var bodyRect = document.body.getBoundingClientRect();
            var left_1 = -(parentLeft_1 - parent.offsetLeft * scale - bodyRect.left) / scale;
            var top_1 = -(parentTop_1 - parent.offsetTop * scale - bodyRect.top) / scale;
            var right = (document.body.offsetWidth - this.resizable.size.width * scale) / scale + left_1;
            var bottom = (document.body.offsetHeight - this.resizable.size.height * scale) / scale + top_1;
            return this.setState({ bounds: { top: top_1, right: right, bottom: bottom, left: left_1 } });
        }
        else if (this.props.bounds === "window") {
            if (!this.resizable)
                return;
            var parentRect_2 = parent.getBoundingClientRect();
            var parentLeft_2 = parentRect_2.left;
            var parentTop_2 = parentRect_2.top;
            var left_2 = -(parentLeft_2 - parent.offsetLeft * scale) / scale;
            var top_2 = -(parentTop_2 - parent.offsetTop * scale) / scale;
            var right = (window.innerWidth - this.resizable.size.width * scale) / scale + left_2;
            var bottom = (window.innerHeight - this.resizable.size.height * scale) / scale + top_2;
            return this.setState({ bounds: { top: top_2, right: right, bottom: bottom, left: left_2 } });
        }
        else if (typeof this.props.bounds === "string") {
            boundary = document.querySelector(this.props.bounds);
        }
        else if (this.props.bounds instanceof HTMLElement) {
            boundary = this.props.bounds;
        }
        if (!(boundary instanceof HTMLElement) || !(parent instanceof HTMLElement)) {
            return;
        }
        var boundaryRect = boundary.getBoundingClientRect();
        var boundaryLeft = boundaryRect.left;
        var boundaryTop = boundaryRect.top;
        var parentRect = parent.getBoundingClientRect();
        var parentLeft = parentRect.left;
        var parentTop = parentRect.top;
        var left = (boundaryLeft - parentLeft) / scale;
        var top = boundaryTop - parentTop;
        if (!this.resizable)
            return;
        this.updateOffsetFromParent();
        var offset = this.offsetFromParent;
        this.setState({
            bounds: {
                top: top - offset.top,
                right: left + (boundary.offsetWidth - this.resizable.size.width) - offset.left / scale,
                bottom: top + (boundary.offsetHeight - this.resizable.size.height) - offset.top,
                left: left - offset.left / scale,
            },
        });
    };
    Rnd.prototype.onDrag = function (e, data) {
        if (!this.props.onDrag)
            return;
        var _a = this.offsetFromParent, left = _a.left, top = _a.top;
        if (!this.props.dragAxis || this.props.dragAxis === "both") {
            return this.props.onDrag(e, __assign(__assign({}, data), { x: data.x + left, y: data.y + top }));
        }
        else if (this.props.dragAxis === "x") {
            return this.props.onDrag(e, __assign(__assign({}, data), { x: data.x + left, y: this.originalPosition.y + top, deltaY: 0 }));
        }
        else if (this.props.dragAxis === "y") {
            return this.props.onDrag(e, __assign(__assign({}, data), { x: this.originalPosition.x + left, y: data.y + top, deltaX: 0 }));
        }
    };
    Rnd.prototype.onDragStop = function (e, data) {
        if (!this.props.onDragStop)
            return;
        var _a = this.offsetFromParent, left = _a.left, top = _a.top;
        if (!this.props.dragAxis || this.props.dragAxis === "both") {
            return this.props.onDragStop(e, __assign(__assign({}, data), { x: data.x + left, y: data.y + top }));
        }
        else if (this.props.dragAxis === "x") {
            return this.props.onDragStop(e, __assign(__assign({}, data), { x: data.x + left, y: this.originalPosition.y + top, deltaY: 0 }));
        }
        else if (this.props.dragAxis === "y") {
            return this.props.onDragStop(e, __assign(__assign({}, data), { x: this.originalPosition.x + left, y: data.y + top, deltaX: 0 }));
        }
    };
    Rnd.prototype.onResizeStart = function (e, dir, elementRef) {
        if (this.props.onResizeStart && this.props.onResizeStart(e, dir, elementRef) === false) {
            return false;
        }
        e.stopPropagation();
        this.setState({
            resizing: true,
        });
        var scale = this.props.scale;
        var offset = this.offsetFromParent;
        var pos = this.getDraggablePosition();
        this.resizingPosition = { x: pos.x + offset.left, y: pos.y + offset.top };
        this.originalPosition = pos;
        if (this.props.bounds) {
            var parent_1 = this.getParent();
            var boundary = void 0;
            if (this.props.bounds === "parent") {
                boundary = parent_1;
            }
            else if (this.props.bounds === "body") {
                boundary = document.body;
            }
            else if (this.props.bounds === "window") {
                boundary = window;
            }
            else if (typeof this.props.bounds === "string") {
                boundary = document.querySelector(this.props.bounds);
            }
            else if (this.props.bounds instanceof HTMLElement) {
                boundary = this.props.bounds;
            }
            var self_1 = this.getSelfElement();
            if (self_1 instanceof Element &&
                (boundary instanceof HTMLElement || boundary === window) &&
                parent_1 instanceof HTMLElement) {
                var _a = this.getMaxSizesFromProps(), maxWidth = _a.maxWidth, maxHeight = _a.maxHeight;
                var parentSize = this.getParentSize();
                if (maxWidth && typeof maxWidth === "string") {
                    if (maxWidth.endsWith("%")) {
                        var ratio = Number(maxWidth.replace("%", "")) / 100;
                        maxWidth = parentSize.width * ratio;
                    }
                    else if (maxWidth.endsWith("px")) {
                        maxWidth = Number(maxWidth.replace("px", ""));
                    }
                }
                if (maxHeight && typeof maxHeight === "string") {
                    if (maxHeight.endsWith("%")) {
                        var ratio = Number(maxHeight.replace("%", "")) / 100;
                        maxHeight = parentSize.height * ratio;
                    }
                    else if (maxHeight.endsWith("px")) {
                        maxHeight = Number(maxHeight.replace("px", ""));
                    }
                }
                var selfRect = self_1.getBoundingClientRect();
                var selfLeft = selfRect.left;
                var selfTop = selfRect.top;
                var boundaryRect = this.props.bounds === "window" ? { left: 0, top: 0 } : boundary.getBoundingClientRect();
                var boundaryLeft = boundaryRect.left;
                var boundaryTop = boundaryRect.top;
                var offsetWidth = this.getOffsetWidth(boundary);
                var offsetHeight = this.getOffsetHeight(boundary);
                var hasLeft = dir.toLowerCase().endsWith("left");
                var hasRight = dir.toLowerCase().endsWith("right");
                var hasTop = dir.startsWith("top");
                var hasBottom = dir.startsWith("bottom");
                if ((hasLeft || hasTop) && this.resizable) {
                    var max = (selfLeft - boundaryLeft) / scale + this.resizable.size.width;
                    this.setState({ maxWidth: max > Number(maxWidth) ? maxWidth : max });
                }
                // INFO: To set bounds in `lock aspect ratio with bounds` case. See also that story.
                if (hasRight || (this.props.lockAspectRatio && !hasLeft && !hasTop)) {
                    var max = offsetWidth + (boundaryLeft - selfLeft) / scale;
                    this.setState({ maxWidth: max > Number(maxWidth) ? maxWidth : max });
                }
                if ((hasTop || hasLeft) && this.resizable) {
                    var max = (selfTop - boundaryTop) / scale + this.resizable.size.height;
                    this.setState({
                        maxHeight: max > Number(maxHeight) ? maxHeight : max,
                    });
                }
                // INFO: To set bounds in `lock aspect ratio with bounds` case. See also that story.
                if (hasBottom || (this.props.lockAspectRatio && !hasTop && !hasLeft)) {
                    var max = offsetHeight + (boundaryTop - selfTop) / scale;
                    this.setState({
                        maxHeight: max > Number(maxHeight) ? maxHeight : max,
                    });
                }
            }
        }
        else {
            this.setState({
                maxWidth: this.props.maxWidth,
                maxHeight: this.props.maxHeight,
            });
        }
    };
    Rnd.prototype.onResize = function (e, direction, elementRef, delta) {
        var _this = this;
        // INFO: Apply x and y position adjustments caused by resizing to draggable
        var newPos = { x: this.originalPosition.x, y: this.originalPosition.y };
        var left = -delta.width;
        var top = -delta.height;
        var directions = ["top", "left", "topLeft", "bottomLeft", "topRight"];
        if (directions.includes(direction)) {
            if (direction === "bottomLeft") {
                newPos.x += left;
            }
            else if (direction === "topRight") {
                newPos.y += top;
            }
            else {
                newPos.x += left;
                newPos.y += top;
            }
        }
        var draggableState = this.draggable.state;
        if (newPos.x !== draggableState.x || newPos.y !== draggableState.y) {
            flushSync(function () {
                _this.draggable.setState(newPos);
            });
        }
        this.updateOffsetFromParent();
        var offset = this.offsetFromParent;
        var x = this.getDraggablePosition().x + offset.left;
        var y = this.getDraggablePosition().y + offset.top;
        this.resizingPosition = { x: x, y: y };
        if (!this.props.onResize)
            return;
        this.props.onResize(e, direction, elementRef, delta, {
            x: x,
            y: y,
        });
    };
    Rnd.prototype.onResizeStop = function (e, direction, elementRef, delta) {
        this.setState({
            resizing: false,
        });
        var _a = this.getMaxSizesFromProps(), maxWidth = _a.maxWidth, maxHeight = _a.maxHeight;
        this.setState({ maxWidth: maxWidth, maxHeight: maxHeight });
        if (this.props.onResizeStop) {
            this.props.onResizeStop(e, direction, elementRef, delta, this.resizingPosition);
        }
    };
    Rnd.prototype.updateSize = function (size) {
        if (!this.resizable)
            return;
        this.resizable.updateSize({ width: size.width, height: size.height });
    };
    Rnd.prototype.updatePosition = function (position) {
        this.draggable.setState(position);
    };
    Rnd.prototype.updateOffsetFromParent = function () {
        var scale = this.props.scale;
        var parent = this.getParent();
        var self = this.getSelfElement();
        if (!parent || self === null) {
            return {
                top: 0,
                left: 0,
            };
        }
        var parentRect = parent.getBoundingClientRect();
        var parentLeft = parentRect.left;
        var parentTop = parentRect.top;
        var selfRect = self.getBoundingClientRect();
        var position = this.getDraggablePosition();
        var scrollLeft = parent.scrollLeft;
        var scrollTop = parent.scrollTop;
        this.offsetFromParent = {
            left: selfRect.left - parentLeft + scrollLeft - position.x * scale,
            top: selfRect.top - parentTop + scrollTop - position.y * scale,
        };
    };
    Rnd.prototype.render = function () {
        var _this = this;
        var _a = this.props, disableDragging = _a.disableDragging, style = _a.style, dragHandleClassName = _a.dragHandleClassName, position = _a.position, onMouseDown = _a.onMouseDown, onMouseUp = _a.onMouseUp, dragAxis = _a.dragAxis, dragGrid = _a.dragGrid, bounds = _a.bounds, enableUserSelectHack = _a.enableUserSelectHack, cancel = _a.cancel, children = _a.children, onResizeStart = _a.onResizeStart, onResize = _a.onResize, onResizeStop = _a.onResizeStop, onDragStart = _a.onDragStart, onDrag = _a.onDrag, onDragStop = _a.onDragStop, resizeHandleStyles = _a.resizeHandleStyles, resizeHandleClasses = _a.resizeHandleClasses, resizeHandleComponent = _a.resizeHandleComponent, enableResizing = _a.enableResizing, resizeGrid = _a.resizeGrid, resizeHandleWrapperClass = _a.resizeHandleWrapperClass, resizeHandleWrapperStyle = _a.resizeHandleWrapperStyle, scale = _a.scale, allowAnyClick = _a.allowAnyClick, dragPositionOffset = _a.dragPositionOffset, resizableProps = __rest(_a, ["disableDragging", "style", "dragHandleClassName", "position", "onMouseDown", "onMouseUp", "dragAxis", "dragGrid", "bounds", "enableUserSelectHack", "cancel", "children", "onResizeStart", "onResize", "onResizeStop", "onDragStart", "onDrag", "onDragStop", "resizeHandleStyles", "resizeHandleClasses", "resizeHandleComponent", "enableResizing", "resizeGrid", "resizeHandleWrapperClass", "resizeHandleWrapperStyle", "scale", "allowAnyClick", "dragPositionOffset"]);
        var defaultValue = this.props.default ? __assign({}, this.props.default) : undefined;
        // Remove unknown props, see also https://reactjs.org/warnings/unknown-prop.html
        delete resizableProps.default;
        var cursorStyle = disableDragging || dragHandleClassName ? { cursor: "auto" } : { cursor: "move" };
        var innerStyle = __assign(__assign(__assign({}, resizableStyle), cursorStyle), style);
        var _b = this.offsetFromParent, left = _b.left, top = _b.top;
        var draggablePosition;
        if (position) {
            draggablePosition = {
                x: position.x - left,
                y: position.y - top,
            };
        }
        // INFO: Make uncontorolled component when resizing to control position by setPostion.
        var pos = this.state.resizing ? undefined : draggablePosition;
        var dragAxisOrUndefined = this.state.resizing ? "both" : dragAxis;
        return (createElement(Draggable, { ref: function (c) {
                if (!c)
                    return;
                _this.draggable = c;
            }, handle: dragHandleClassName ? ".".concat(dragHandleClassName) : undefined, defaultPosition: defaultValue, onMouseDown: onMouseDown, 
            // @ts-expect-error
            onMouseUp: onMouseUp, onStart: this.onDragStart, onDrag: this.onDrag, onStop: this.onDragStop, axis: dragAxisOrUndefined, disabled: disableDragging, grid: dragGrid, bounds: bounds ? this.state.bounds : undefined, position: pos, enableUserSelectHack: enableUserSelectHack, cancel: cancel, scale: scale, allowAnyClick: allowAnyClick, nodeRef: this.resizableElement, positionOffset: dragPositionOffset },
            createElement(Resizable, __assign({}, resizableProps, { ref: function (c) {
                    if (!c)
                        return;
                    _this.resizable = c;
                    _this.resizableElement.current = c.resizable;
                }, defaultSize: defaultValue, size: this.props.size, enable: typeof enableResizing === "boolean" ? getEnableResizingByFlag(enableResizing) : enableResizing, onResizeStart: this.onResizeStart, onResize: this.onResize, onResizeStop: this.onResizeStop, style: innerStyle, minWidth: this.props.minWidth, minHeight: this.props.minHeight, maxWidth: this.state.resizing ? this.state.maxWidth : this.props.maxWidth, maxHeight: this.state.resizing ? this.state.maxHeight : this.props.maxHeight, grid: resizeGrid, handleWrapperClass: resizeHandleWrapperClass, handleWrapperStyle: resizeHandleWrapperStyle, lockAspectRatio: this.props.lockAspectRatio, lockAspectRatioExtraWidth: this.props.lockAspectRatioExtraWidth, lockAspectRatioExtraHeight: this.props.lockAspectRatioExtraHeight, handleStyles: resizeHandleStyles, handleClasses: resizeHandleClasses, handleComponent: resizeHandleComponent, scale: this.props.scale }), children)));
    };
    Rnd.defaultProps = {
        maxWidth: Number.MAX_SAFE_INTEGER,
        maxHeight: Number.MAX_SAFE_INTEGER,
        scale: 1,
        onResizeStart: function () { },
        onResize: function () { },
        onResizeStop: function () { },
        onDragStart: function () { },
        onDrag: function () { },
        onDragStop: function () { },
    };
    return Rnd;
}(PureComponent));

export { Rnd };
