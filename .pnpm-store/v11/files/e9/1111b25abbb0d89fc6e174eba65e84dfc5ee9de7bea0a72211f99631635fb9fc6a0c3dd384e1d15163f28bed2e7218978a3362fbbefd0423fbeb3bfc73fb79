'use client';

var _templateObject;
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = it.call(o); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } }; }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _taggedTemplateLiteral(strings, raw) { if (!raw) { raw = strings.slice(0); } return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { jsx as _jsx } from "react/jsx-runtime";
var styles = createStaticStyles(function (_ref) {
  var css = _ref.css,
    cssVar = _ref.cssVar;
  return {
    container: css(_templateObject || (_templateObject = _taggedTemplateLiteral(["\n    overflow-x: auto;\n\n    min-height: 160px;\n    margin-block: 16px;\n    padding: 32px;\n    border: 1px solid ", ";\n    border-radius: ", ";\n\n    background: ", ";\n  "])), cssVar.colorBorderSecondary, cssVar.borderRadiusLG, cssVar.colorBgContainer)
  };
});
var getClientSnapshot = function getClientSnapshot() {
  return true;
};
var getServerSnapshot = function getServerSnapshot() {
  return false;
};
var unsubscribe = function unsubscribe() {};
var subscribe = function subscribe() {
  return unsubscribe;
};
var namespaceSvgIds = function namespaceSvgIds(container, namespace) {
  var _iterator = _createForOfIteratorHelper(_toConsumableArray(container.querySelectorAll('svg')).entries()),
    _step;
  try {
    var _loop = function _loop() {
      var _step$value = _slicedToArray(_step.value, 2),
        svgIndex = _step$value[0],
        svg = _step$value[1];
      var idMap = new Map();
      var _iterator2 = _createForOfIteratorHelper(svg.querySelectorAll('[id]')),
        _step2;
      try {
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
          var element = _step2.value;
          var currentId = element.id;
          var namespacedId = "".concat(namespace, "-").concat(svgIndex, "-").concat(currentId);
          idMap.set(currentId, namespacedId);
          element.id = namespacedId;
        }
      } catch (err) {
        _iterator2.e(err);
      } finally {
        _iterator2.f();
      }
      var _iterator3 = _createForOfIteratorHelper(svg.querySelectorAll('*')),
        _step3;
      try {
        for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
          var _element = _step3.value;
          var _iterator4 = _createForOfIteratorHelper(_element.getAttributeNames()),
            _step4;
          try {
            for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
              var attribute = _step4.value;
              var currentValue = _element.getAttribute(attribute);
              if (!currentValue) continue;
              var _nextValue = currentValue;
              var _iterator6 = _createForOfIteratorHelper(idMap),
                _step6;
              try {
                for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
                  var _step6$value = _slicedToArray(_step6.value, 2),
                    _currentId2 = _step6$value[0],
                    _namespacedId2 = _step6$value[1];
                  _nextValue = _nextValue.replaceAll("url(#".concat(_currentId2, ")"), "url(#".concat(_namespacedId2, ")"));
                  if (_nextValue === "#".concat(_currentId2)) _nextValue = "#".concat(_namespacedId2);
                }
              } catch (err) {
                _iterator6.e(err);
              } finally {
                _iterator6.f();
              }
              if (attribute === 'aria-describedby' || attribute === 'aria-labelledby') {
                _nextValue = _nextValue.split(/\s+/).map(function (id) {
                  var _idMap$get;
                  return (_idMap$get = idMap.get(id)) !== null && _idMap$get !== void 0 ? _idMap$get : id;
                }).join(' ');
              }
              if (_nextValue !== currentValue) _element.setAttribute(attribute, _nextValue);
            }
          } catch (err) {
            _iterator4.e(err);
          } finally {
            _iterator4.f();
          }
          if (_element.tagName.toLowerCase() === 'style' && _element.textContent) {
            var nextValue = _element.textContent;
            var _iterator5 = _createForOfIteratorHelper(idMap),
              _step5;
            try {
              for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) {
                var _step5$value = _slicedToArray(_step5.value, 2),
                  _currentId = _step5$value[0],
                  _namespacedId = _step5$value[1];
                nextValue = nextValue.replaceAll("url(#".concat(_currentId, ")"), "url(#".concat(_namespacedId, ")"));
              }
            } catch (err) {
              _iterator5.e(err);
            } finally {
              _iterator5.f();
            }
            _element.textContent = nextValue;
          }
        }
      } catch (err) {
        _iterator3.e(err);
      } finally {
        _iterator3.f();
      }
    };
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      _loop();
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
};
var DocsPreview = /*#__PURE__*/memo(function (_ref2) {
  var children = _ref2.children;
  var containerRef = useRef(null);
  var hydrated = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  var namespace = "docs-preview-".concat(useId().replaceAll(/\W/g, ''));
  useLayoutEffect(function () {
    if (hydrated && containerRef.current) namespaceSvgIds(containerRef.current, namespace);
  }, [hydrated, namespace]);
  return /*#__PURE__*/_jsx(Flexbox, {
    align: 'center',
    className: styles.container,
    "data-docs-preview": true,
    justify: 'center',
    ref: containerRef,
    children: hydrated ? children : null
  });
});
export default DocsPreview;