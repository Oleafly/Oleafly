/**
 * @licstart The following is the entire license notice for the
 * JavaScript code in this page
 *
 * Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @licend The above is the entire license notice for the
 * JavaScript code in this page
 */

/**
 * pdfjsVersion = 6.1.200
 * pdfjsBuild = 6353acefe
 */

;// ./src/shared/util.js
const isNodeJS = typeof process === "object" && process + "" === "[object process]" && !process.versions.nw && !(process.versions.electron && process.type && process.type !== "browser");
const BBOX_INIT = [Infinity, Infinity, -Infinity, -Infinity];
const F32_BBOX_INIT = new Float32Array(BBOX_INIT);
const FONT_IDENTITY_MATRIX = (/* unused pure expression or super */ null && ([0.001, 0, 0, 0.001, 0, 0]));
const LINE_FACTOR = 1.35;
const LINE_DESCENT_FACTOR = 0.35;
const BASELINE_FACTOR = LINE_DESCENT_FACTOR / LINE_FACTOR;
const SVG_NS = "http://www.w3.org/2000/svg";
const RenderingIntentFlag = (/* unused pure expression or super */ null && ({
  ANY: 0x01,
  DISPLAY: 0x02,
  PRINT: 0x04,
  SAVE: 0x08,
  ANNOTATIONS_FORMS: 0x10,
  ANNOTATIONS_STORAGE: 0x20,
  ANNOTATIONS_DISABLE: 0x40,
  IS_EDITING: 0x80,
  OPLIST: 0x100
}));
const AnnotationMode = (/* unused pure expression or super */ null && ({
  DISABLE: 0,
  ENABLE: 1,
  ENABLE_FORMS: 2,
  ENABLE_STORAGE: 3
}));
const AnnotationPrefix = "pdfjs_internal_id_";
const AnnotationEditorPrefix = "pdfjs_internal_editor_";
const AnnotationEditorType = (/* unused pure expression or super */ null && ({
  DISABLE: -1,
  NONE: 0,
  FREETEXT: 3,
  HIGHLIGHT: 9,
  STAMP: 13,
  INK: 15,
  POPUP: 16,
  SIGNATURE: 101,
  COMMENT: 102
}));
const AnnotationEditorParamsType = (/* unused pure expression or super */ null && ({
  RESIZE: 1,
  CREATE: 2,
  FREETEXT_SIZE: 11,
  FREETEXT_COLOR: 12,
  FREETEXT_OPACITY: 13,
  INK_COLOR: 21,
  INK_THICKNESS: 22,
  INK_OPACITY: 23,
  INK_COLOR_AND_OPACITY: 24,
  HIGHLIGHT_COLOR: 31,
  HIGHLIGHT_THICKNESS: 32,
  HIGHLIGHT_FREE: 33,
  HIGHLIGHT_SHOW_ALL: 34,
  DRAW_STEP: 41
}));
const PermissionFlag = (/* unused pure expression or super */ null && ({
  PRINT: 0x04,
  MODIFY_CONTENTS: 0x08,
  COPY: 0x10,
  MODIFY_ANNOTATIONS: 0x20,
  FILL_INTERACTIVE_FORMS: 0x100,
  COPY_FOR_ACCESSIBILITY: 0x200,
  ASSEMBLE: 0x400,
  PRINT_HIGH_QUALITY: 0x800
}));
const MeshFigureType = (/* unused pure expression or super */ null && ({
  TRIANGLES: 1,
  LATTICE: 2,
  PATCH: 3
}));
const TextRenderingMode = (/* unused pure expression or super */ null && ({
  FILL: 0,
  STROKE: 1,
  FILL_STROKE: 2,
  INVISIBLE: 3,
  FILL_ADD_TO_PATH: 4,
  STROKE_ADD_TO_PATH: 5,
  FILL_STROKE_ADD_TO_PATH: 6,
  ADD_TO_PATH: 7,
  FILL_STROKE_MASK: 3,
  ADD_TO_PATH_FLAG: 4
}));
const ImageKind = (/* unused pure expression or super */ null && ({
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3
}));
const AnnotationType = (/* unused pure expression or super */ null && ({
  TEXT: 1,
  LINK: 2,
  FREETEXT: 3,
  LINE: 4,
  SQUARE: 5,
  CIRCLE: 6,
  POLYGON: 7,
  POLYLINE: 8,
  HIGHLIGHT: 9,
  UNDERLINE: 10,
  SQUIGGLY: 11,
  STRIKEOUT: 12,
  STAMP: 13,
  CARET: 14,
  INK: 15,
  POPUP: 16,
  FILEATTACHMENT: 17,
  SOUND: 18,
  MOVIE: 19,
  WIDGET: 20,
  SCREEN: 21,
  PRINTERMARK: 22,
  TRAPNET: 23,
  WATERMARK: 24,
  THREED: 25,
  REDACT: 26,
  RICHMEDIA: 27
}));
const AnnotationReplyType = (/* unused pure expression or super */ null && ({
  GROUP: "Group",
  REPLY: "R"
}));
const AnnotationRenditionOperation = (/* unused pure expression or super */ null && ({
  PLAY_OR_RESUME: 0,
  STOP: 1,
  PAUSE: 2,
  RESUME: 3,
  PLAY: 4
}));
const AnnotationFlag = (/* unused pure expression or super */ null && ({
  INVISIBLE: 0x01,
  HIDDEN: 0x02,
  PRINT: 0x04,
  NOZOOM: 0x08,
  NOROTATE: 0x10,
  NOVIEW: 0x20,
  READONLY: 0x40,
  LOCKED: 0x80,
  TOGGLENOVIEW: 0x100,
  LOCKEDCONTENTS: 0x200
}));
const AnnotationFieldFlag = (/* unused pure expression or super */ null && ({
  READONLY: 0x0000001,
  REQUIRED: 0x0000002,
  NOEXPORT: 0x0000004,
  MULTILINE: 0x0001000,
  PASSWORD: 0x0002000,
  NOTOGGLETOOFF: 0x0004000,
  RADIO: 0x0008000,
  PUSHBUTTON: 0x0010000,
  COMBO: 0x0020000,
  EDIT: 0x0040000,
  SORT: 0x0080000,
  FILESELECT: 0x0100000,
  MULTISELECT: 0x0200000,
  DONOTSPELLCHECK: 0x0400000,
  DONOTSCROLL: 0x0800000,
  COMB: 0x1000000,
  RICHTEXT: 0x2000000,
  RADIOSINUNISON: 0x2000000,
  COMMITONSELCHANGE: 0x4000000
}));
const AnnotationBorderStyleType = (/* unused pure expression or super */ null && ({
  SOLID: 1,
  DASHED: 2,
  BEVELED: 3,
  INSET: 4,
  UNDERLINE: 5
}));
const AnnotationActionEventType = (/* unused pure expression or super */ null && ({
  E: "Mouse Enter",
  X: "Mouse Exit",
  D: "Mouse Down",
  U: "Mouse Up",
  Fo: "Focus",
  Bl: "Blur",
  PO: "PageOpen",
  PC: "PageClose",
  PV: "PageVisible",
  PI: "PageInvisible",
  K: "Keystroke",
  F: "Format",
  V: "Validate",
  C: "Calculate"
}));
const DocumentActionEventType = (/* unused pure expression or super */ null && ({
  WC: "WillClose",
  WS: "WillSave",
  DS: "DidSave",
  WP: "WillPrint",
  DP: "DidPrint"
}));
const PageActionEventType = (/* unused pure expression or super */ null && ({
  O: "PageOpen",
  C: "PageClose"
}));
const VerbosityLevel = {
  ERRORS: 0,
  WARNINGS: 1,
  INFOS: 5
};
const OPS = (/* unused pure expression or super */ null && ({
  dependency: 1,
  setLineWidth: 2,
  setLineCap: 3,
  setLineJoin: 4,
  setMiterLimit: 5,
  setDash: 6,
  setRenderingIntent: 7,
  setFlatness: 8,
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  endText: 32,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  setCharWidth: 48,
  setCharWidthAndBounds: 49,
  setStrokeColorSpace: 50,
  setFillColorSpace: 51,
  setStrokeColor: 52,
  setStrokeColorN: 53,
  setFillColor: 54,
  setFillColorN: 55,
  setStrokeGray: 56,
  setFillGray: 57,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeCMYKColor: 60,
  setFillCMYKColor: 61,
  shadingFill: 62,
  beginInlineImage: 63,
  beginImageData: 64,
  endInlineImage: 65,
  paintXObject: 66,
  markPoint: 67,
  markPointProps: 68,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
  beginCompat: 72,
  endCompat: 73,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  beginAnnotation: 80,
  endAnnotation: 81,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintSolidColorImageMask: 90,
  constructPath: 91,
  setStrokeTransparent: 92,
  setFillTransparent: 93,
  rawFillPath: 94
}));
const DrawOPS = (/* unused pure expression or super */ null && ({
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4
}));
const PasswordResponses = (/* unused pure expression or super */ null && ({
  NEED_PASSWORD: 1,
  INCORRECT_PASSWORD: 2
}));
let verbosity = VerbosityLevel.WARNINGS;
function setVerbosityLevel(level) {
  if (Number.isInteger(level)) {
    verbosity = level;
  }
}
function getVerbosityLevel() {
  return verbosity;
}
function info(msg) {
  if (verbosity >= VerbosityLevel.INFOS) {
    console.info(`Info: ${msg}`);
  }
}
function warn(msg) {
  if (verbosity >= VerbosityLevel.WARNINGS) {
    console.warn(`Warning: ${msg}`);
  }
}
function unreachable(msg) {
  throw new Error(msg);
}
function assert(cond, msg) {
  if (!cond) {
    unreachable(msg);
  }
}
function _isValidProtocol(url) {
  switch (url?.protocol) {
    case "http:":
    case "https:":
    case "ftp:":
    case "mailto:":
    case "tel:":
      return true;
    default:
      return false;
  }
}
function createValidAbsoluteUrl(url, baseUrl = null, options = null) {
  if (!url) {
    return null;
  }
  if (options && typeof url === "string") {
    if (options.addDefaultProtocol && url.startsWith("www.")) {
      const dots = url.match(/\./g);
      if (dots?.length >= 2) {
        url = `http://${url}`;
      }
    }
    if (options.tryConvertEncoding) {
      try {
        url = stringToUTF8String(url);
      } catch {}
    }
  }
  const absoluteUrl = baseUrl ? URL.parse(url, baseUrl) : URL.parse(url);
  return _isValidProtocol(absoluteUrl) ? absoluteUrl : null;
}
function updateUrlHash(url, hash, allowRel = false) {
  const res = URL.parse(url);
  if (res) {
    res.hash = hash;
    return res.href;
  }
  if (allowRel && createValidAbsoluteUrl(url, "http://example.com")) {
    return url.split("#", 1)[0] + `${hash ? `#${hash}` : ""}`;
  }
  return "";
}
function stripPath(str) {
  return str.substring(str.lastIndexOf("/") + 1);
}
function shadow(obj, prop, value, nonSerializable = false) {
  Object.defineProperty(obj, prop, {
    value,
    enumerable: !nonSerializable,
    configurable: true,
    writable: false
  });
  return value;
}
const BaseException = function BaseExceptionClosure() {
  function BaseException(message, name) {
    this.message = message;
    this.name = name;
  }
  BaseException.prototype = new Error();
  BaseException.constructor = BaseException;
  return BaseException;
}();
class PasswordException extends BaseException {
  constructor(msg, code) {
    super(msg, "PasswordException");
    this.code = code;
  }
}
class UnknownErrorException extends BaseException {
  constructor(msg, details) {
    super(msg, "UnknownErrorException");
    this.details = details;
  }
}
class InvalidPDFException extends BaseException {
  constructor(msg) {
    super(msg, "InvalidPDFException");
  }
}
class ResponseException extends BaseException {
  constructor(msg, status, missing) {
    super(msg, "ResponseException");
    this.status = status;
    this.missing = missing;
  }
}
class FormatError extends BaseException {
  constructor(msg) {
    super(msg, "FormatError");
  }
}
class AbortException extends BaseException {
  constructor(msg) {
    super(msg, "AbortException");
  }
}
function bytesToString(bytes) {
  if (typeof bytes !== "object" || bytes?.length === undefined) {
    unreachable("Invalid argument for bytesToString");
  }
  const length = bytes.length;
  const MAX_ARGUMENT_COUNT = 8192;
  if (length < MAX_ARGUMENT_COUNT) {
    return String.fromCharCode.apply(null, bytes);
  }
  const strBuf = [];
  for (let i = 0; i < length; i += MAX_ARGUMENT_COUNT) {
    const chunkEnd = Math.min(i + MAX_ARGUMENT_COUNT, length);
    const chunk = bytes.subarray(i, chunkEnd);
    strBuf.push(String.fromCharCode.apply(null, chunk));
  }
  return strBuf.join("");
}
function stringToBytes(str) {
  if (typeof str !== "string") {
    unreachable("Invalid argument for stringToBytes");
  }
  const length = str.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; ++i) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}
function objectSize(obj) {
  return Object.keys(obj).length;
}
class FeatureTest {
  static get isLittleEndian() {
    const buffer8 = new Uint8Array(4);
    buffer8[0] = 1;
    const view32 = new Uint32Array(buffer8.buffer, 0, 1);
    return shadow(this, "isLittleEndian", view32[0] === 1);
  }
  static get isOffscreenCanvasSupported() {
    return shadow(this, "isOffscreenCanvasSupported", typeof OffscreenCanvas !== "undefined");
  }
  static get isImageDecoderSupported() {
    return shadow(this, "isImageDecoderSupported", typeof ImageDecoder !== "undefined");
  }
  static get isFloat16ArraySupported() {
    return shadow(this, "isFloat16ArraySupported", typeof Float16Array !== "undefined");
  }
  static get isSanitizerSupported() {
    return shadow(this, "isSanitizerSupported", typeof Sanitizer !== "undefined");
  }
  static get platform() {
    const {
      platform,
      userAgent
    } = navigator;
    return shadow(this, "platform", {
      isAndroid: userAgent.includes("Android"),
      isLinux: platform.includes("Linux"),
      isMac: platform.includes("Mac"),
      isWindows: platform.includes("Win"),
      isFirefox: userAgent.includes("Firefox")
    });
  }
  static get isCanvasFilterSupported() {
    let ctx;
    if (this.isOffscreenCanvasSupported) {
      ctx = new OffscreenCanvas(1, 1).getContext("2d");
    } else if (typeof document !== "undefined") {
      ctx = document.createElement("canvas").getContext("2d");
    }
    return shadow(this, "isCanvasFilterSupported", ctx?.filter !== undefined);
  }
  static get isAlphaColorInputSupported() {
    if (typeof document === "undefined") {
      return shadow(this, "isAlphaColorInputSupported", false);
    }
    const input = document.createElement("input");
    input.type = "color";
    input.setAttribute("alpha", "");
    input.value = "#ff000080";
    return shadow(this, "isAlphaColorInputSupported", input.value !== "#ff0000");
  }
  static get isBackdropFilterSupported() {
    return shadow(this, "isBackdropFilterSupported", typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "blur(1px)"));
  }
}
class Util {
  static get hexNums() {
    return shadow(this, "hexNums", Array.from(Array(256).keys(), n => n.toString(16).padStart(2, "0")));
  }
  static makeHexColor(r, g, b) {
    return `#${this.hexNums[r]}${this.hexNums[g]}${this.hexNums[b]}`;
  }
  static transform(m1, m2) {
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
  }
  static multiplyByDOMMatrix(m, md) {
    return [m[0] * md.a + m[2] * md.b, m[1] * md.a + m[3] * md.b, m[0] * md.c + m[2] * md.d, m[1] * md.c + m[3] * md.d, m[0] * md.e + m[2] * md.f + m[4], m[1] * md.e + m[3] * md.f + m[5]];
  }
  static applyTransform(p, m, pos = 0) {
    const p0 = p[pos];
    const p1 = p[pos + 1];
    p[pos] = p0 * m[0] + p1 * m[2] + m[4];
    p[pos + 1] = p0 * m[1] + p1 * m[3] + m[5];
  }
  static applyTransformToBezier(p, transform, pos = 0) {
    const m0 = transform[0];
    const m1 = transform[1];
    const m2 = transform[2];
    const m3 = transform[3];
    const m4 = transform[4];
    const m5 = transform[5];
    for (let i = 0; i < 6; i += 2) {
      const pI = p[pos + i];
      const pI1 = p[pos + i + 1];
      p[pos + i] = pI * m0 + pI1 * m2 + m4;
      p[pos + i + 1] = pI * m1 + pI1 * m3 + m5;
    }
  }
  static applyInverseTransform(p, m) {
    const p0 = p[0];
    const p1 = p[1];
    const d = m[0] * m[3] - m[1] * m[2];
    p[0] = (p0 * m[3] - p1 * m[2] + m[2] * m[5] - m[4] * m[3]) / d;
    p[1] = (-p0 * m[1] + p1 * m[0] + m[4] * m[1] - m[5] * m[0]) / d;
  }
  static axialAlignedBoundingBox(rect, transform, output) {
    const m0 = transform[0];
    const m1 = transform[1];
    const m2 = transform[2];
    const m3 = transform[3];
    const m4 = transform[4];
    const m5 = transform[5];
    const r0 = rect[0];
    const r1 = rect[1];
    const r2 = rect[2];
    const r3 = rect[3];
    let a0 = m0 * r0 + m4;
    let a2 = a0;
    let a1 = m0 * r2 + m4;
    let a3 = a1;
    let b0 = m3 * r1 + m5;
    let b2 = b0;
    let b1 = m3 * r3 + m5;
    let b3 = b1;
    if (m1 !== 0 || m2 !== 0) {
      const m1r0 = m1 * r0;
      const m1r2 = m1 * r2;
      const m2r1 = m2 * r1;
      const m2r3 = m2 * r3;
      a0 += m2r1;
      a3 += m2r1;
      a1 += m2r3;
      a2 += m2r3;
      b0 += m1r0;
      b3 += m1r0;
      b1 += m1r2;
      b2 += m1r2;
    }
    output[0] = Math.min(output[0], a0, a1, a2, a3);
    output[1] = Math.min(output[1], b0, b1, b2, b3);
    output[2] = Math.max(output[2], a0, a1, a2, a3);
    output[3] = Math.max(output[3], b0, b1, b2, b3);
  }
  static inverseTransform(m) {
    const d = m[0] * m[3] - m[1] * m[2];
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[4] * m[3]) / d, (m[4] * m[1] - m[5] * m[0]) / d];
  }
  static singularValueDecompose2dScale(matrix, output) {
    const m0 = matrix[0];
    const m1 = matrix[1];
    const m2 = matrix[2];
    const m3 = matrix[3];
    const a = m0 ** 2 + m1 ** 2;
    const b = m0 * m2 + m1 * m3;
    const c = m2 ** 2 + m3 ** 2;
    const first = (a + c) / 2;
    const second = Math.sqrt(first ** 2 - (a * c - b ** 2));
    output[0] = Math.sqrt(first + second || 1);
    output[1] = Math.sqrt(first - second || 1);
  }
  static normalizeRect(rect) {
    const r = rect.slice(0);
    if (rect[0] > rect[2]) {
      r[0] = rect[2];
      r[2] = rect[0];
    }
    if (rect[1] > rect[3]) {
      r[1] = rect[3];
      r[3] = rect[1];
    }
    return r;
  }
  static intersect(rect1, rect2) {
    const xLow = Math.max(Math.min(rect1[0], rect1[2]), Math.min(rect2[0], rect2[2]));
    const xHigh = Math.min(Math.max(rect1[0], rect1[2]), Math.max(rect2[0], rect2[2]));
    if (xLow > xHigh) {
      return null;
    }
    const yLow = Math.max(Math.min(rect1[1], rect1[3]), Math.min(rect2[1], rect2[3]));
    const yHigh = Math.min(Math.max(rect1[1], rect1[3]), Math.max(rect2[1], rect2[3]));
    if (yLow > yHigh) {
      return null;
    }
    return [xLow, yLow, xHigh, yHigh];
  }
  static pointBoundingBox(x, y, minMax) {
    minMax[0] = Math.min(minMax[0], x);
    minMax[1] = Math.min(minMax[1], y);
    minMax[2] = Math.max(minMax[2], x);
    minMax[3] = Math.max(minMax[3], y);
  }
  static rectBoundingBox(x0, y0, x1, y1, minMax) {
    minMax[0] = Math.min(minMax[0], x0, x1);
    minMax[1] = Math.min(minMax[1], y0, y1);
    minMax[2] = Math.max(minMax[2], x0, x1);
    minMax[3] = Math.max(minMax[3], y0, y1);
  }
  static #getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, t, minMax) {
    if (t <= 0 || t >= 1) {
      return;
    }
    const mt = 1 - t;
    const tt = t * t;
    const ttt = tt * t;
    const x = mt * (mt * (mt * x0 + 3 * t * x1) + 3 * tt * x2) + ttt * x3;
    const y = mt * (mt * (mt * y0 + 3 * t * y1) + 3 * tt * y2) + ttt * y3;
    minMax[0] = Math.min(minMax[0], x);
    minMax[1] = Math.min(minMax[1], y);
    minMax[2] = Math.max(minMax[2], x);
    minMax[3] = Math.max(minMax[3], y);
  }
  static #getExtremum(x0, x1, x2, x3, y0, y1, y2, y3, a, b, c, minMax) {
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) >= 1e-12) {
        this.#getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, -c / b, minMax);
      }
      return;
    }
    const delta = b ** 2 - 4 * c * a;
    if (delta < 0) {
      return;
    }
    const sqrtDelta = Math.sqrt(delta);
    const a2 = 2 * a;
    this.#getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, (-b + sqrtDelta) / a2, minMax);
    this.#getExtremumOnCurve(x0, x1, x2, x3, y0, y1, y2, y3, (-b - sqrtDelta) / a2, minMax);
  }
  static bezierBoundingBox(x0, y0, x1, y1, x2, y2, x3, y3, minMax) {
    minMax[0] = Math.min(minMax[0], x0, x3);
    minMax[1] = Math.min(minMax[1], y0, y3);
    minMax[2] = Math.max(minMax[2], x0, x3);
    minMax[3] = Math.max(minMax[3], y0, y3);
    this.#getExtremum(x0, x1, x2, x3, y0, y1, y2, y3, 3 * (-x0 + 3 * (x1 - x2) + x3), 6 * (x0 - 2 * x1 + x2), 3 * (x1 - x0), minMax);
    this.#getExtremum(x0, x1, x2, x3, y0, y1, y2, y3, 3 * (-y0 + 3 * (y1 - y2) + y3), 6 * (y0 - 2 * y1 + y2), 3 * (y1 - y0), minMax);
  }
}
function stringToUTF8String(str) {
  return decodeURIComponent(escape(str));
}
function utf8StringToString(str) {
  return unescape(encodeURIComponent(str));
}
function isArrayEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) {
    return false;
  }
  for (let i = 0, ii = arr1.length; i < ii; i++) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }
  return true;
}
let NormalizeRegex = null;
let NormalizationMap = null;
function normalizeUnicode(str) {
  if (!NormalizeRegex) {
    NormalizeRegex = /([\u00a0\u00b5\u037e\u0eb3\u2000-\u200a\u202f\u2126\ufb00-\ufb04\ufb06\ufb20-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufba1\ufba4-\ufba9\ufbae-\ufbb1\ufbd3-\ufbdc\ufbde-\ufbe7\ufbea-\ufbf8\ufbfc\ufbfd\ufc00-\ufc5d\ufc64-\ufcf1\ufcf5-\ufd3d\ufd88\ufdf4\ufdfa\ufdfb\ufe71\ufe77\ufe79\ufe7b\ufe7d]+)|(\ufb05+)/gu;
    NormalizationMap = new Map([["ﬅ", "ſt"]]);
  }
  return str.replaceAll(NormalizeRegex, (_, p1, p2) => p1 ? p1.normalize("NFKC") : NormalizationMap.get(p2));
}
function getUuid() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToString(buf);
}
function _isValidExplicitDest(validRef, validName, dest) {
  if (!Array.isArray(dest) || dest.length < 2) {
    return false;
  }
  const [page, zoom, ...args] = dest;
  if (!validRef(page) && !Number.isInteger(page)) {
    return false;
  }
  if (!validName(zoom)) {
    return false;
  }
  const argsLen = args.length;
  let allowNull = true;
  switch (zoom.name) {
    case "XYZ":
      if (argsLen < 2 || argsLen > 3) {
        return false;
      }
      break;
    case "Fit":
    case "FitB":
      return argsLen === 0;
    case "FitH":
    case "FitBH":
    case "FitV":
    case "FitBV":
      if (argsLen > 1) {
        return false;
      }
      break;
    case "FitR":
      if (argsLen !== 4) {
        return false;
      }
      allowNull = false;
      break;
    default:
      return false;
  }
  for (const arg of args) {
    if (typeof arg === "number" || allowNull && arg === null) {
      continue;
    }
    return false;
  }
  return true;
}
const makeArr = () => [];
const makeMap = () => new Map();
const makeObj = () => Object.create(null);

;// ./external/jbig2/jbig2.js
async function JBig2(moduleArg = {}) {
  var moduleRtn;
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = true;
  var ENVIRONMENT_IS_WORKER = false;
  var arguments_ = [];
  var thisProgram = "./this.program";
  var quit_ = (status, toThrow) => {
    throw toThrow;
  };
  var _scriptName = import.meta.url;
  var scriptDirectory = "";
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL(".", _scriptName).href;
    } catch {}
    readAsync = async url => {
      var response = await fetch(url, {
        credentials: "same-origin"
      });
      if (response.ok) {
        return response.arrayBuffer();
      }
      throw new Error(response.status + " : " + response.url);
    };
  } else {}
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  var wasmBinary;
  var ABORT = false;
  var EXITSTATUS;
  var readyPromiseResolve, readyPromiseReject;
  var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
  var HEAP64, HEAPU64;
  var runtimeInitialized = false;
  function updateMemoryViews() {
    var b = wasmMemory.buffer;
    HEAP8 = new Int8Array(b);
    HEAP16 = new Int16Array(b);
    HEAPU8 = new Uint8Array(b);
    HEAPU16 = new Uint16Array(b);
    HEAP32 = new Int32Array(b);
    HEAPU32 = new Uint32Array(b);
    HEAPF32 = new Float32Array(b);
    HEAPF64 = new Float64Array(b);
    HEAP64 = new BigInt64Array(b);
    HEAPU64 = new BigUint64Array(b);
  }
  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }
    callRuntimeCallbacks(onPreRuns);
  }
  function initRuntime() {
    runtimeInitialized = true;
    wasmExports["j"]();
  }
  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }
    callRuntimeCallbacks(onPostRuns);
  }
  function abort(what) {
    Module["onAbort"]?.(what);
    what = "Aborted(" + what + ")";
    err(what);
    ABORT = true;
    what += ". Build with -sASSERTIONS for more info.";
    var e = new WebAssembly.RuntimeError(what);
    readyPromiseReject?.(e);
    throw e;
  }
  var wasmBinaryFile;
  function getWasmImports() {
    var imports = {
      a: wasmImports
    };
    return imports;
  }
  async function createWasm() {
    function receiveInstance(instance, module) {
      wasmExports = instance.exports;
      assignWasmExports(wasmExports);
      updateMemoryViews();
      return wasmExports;
    }
    var info = getWasmImports();
    return new Promise((resolve, reject) => {
      Module["instantiateWasm"](info, (inst, mod) => {
        resolve(receiveInstance(inst, mod));
      });
    });
  }
  class ExitStatus {
    name = "ExitStatus";
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var callRuntimeCallbacks = callbacks => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  };
  var onPostRuns = [];
  var addOnPostRun = cb => onPostRuns.push(cb);
  var onPreRuns = [];
  var addOnPreRun = cb => onPreRuns.push(cb);
  var noExitRuntime = true;
  var __abort_js = () => abort("");
  var runtimeKeepaliveCounter = 0;
  var __emscripten_runtime_keepalive_clear = () => {
    noExitRuntime = false;
    runtimeKeepaliveCounter = 0;
  };
  var timers = {};
  var handleException = e => {
    if (e instanceof ExitStatus || e == "unwind") {
      return EXITSTATUS;
    }
    quit_(1, e);
  };
  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  var _proc_exit = code => {
    EXITSTATUS = code;
    if (!keepRuntimeAlive()) {
      Module["onExit"]?.(code);
      ABORT = true;
    }
    quit_(code, new ExitStatus(code));
  };
  var exitJS = (status, implicit) => {
    EXITSTATUS = status;
    _proc_exit(status);
  };
  var _exit = exitJS;
  var maybeExit = () => {
    if (!keepRuntimeAlive()) {
      try {
        _exit(EXITSTATUS);
      } catch (e) {
        handleException(e);
      }
    }
  };
  var callUserCallback = func => {
    if (ABORT) {
      return;
    }
    try {
      return func();
    } catch (e) {
      handleException(e);
    } finally {
      maybeExit();
    }
  };
  var _emscripten_get_now = () => performance.now();
  var __setitimer_js = (which, timeout_ms) => {
    if (timers[which]) {
      clearTimeout(timers[which].id);
      delete timers[which];
    }
    if (!timeout_ms) return 0;
    var id = setTimeout(() => {
      delete timers[which];
      callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
    }, timeout_ms);
    timers[which] = {
      id,
      timeout_ms
    };
    return 0;
  };
  function _createImageData(size) {
    Module.imageData = new Uint8Array(size);
  }
  var getHeapMax = () => 2147483648;
  var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
  var growMemory = size => {
    var oldHeapSize = wasmMemory.buffer.byteLength;
    var pages = (size - oldHeapSize + 65535) / 65536 | 0;
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return 1;
    } catch (e) {}
  };
  var _emscripten_resize_heap = requestedSize => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    var maxHeapSize = getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
      var overGrownHeapSize = oldSize * (1 + .2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
      var replacement = growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  };
  function _setImageData(array_ptr, pitch8, pitch32, height) {
    if (pitch32 === pitch8) {
      Module.imageData = new Uint8ClampedArray(HEAPU8.subarray(array_ptr, array_ptr + pitch32 * height));
      return;
    }
    const destSize = pitch8 * height;
    const imageData = Module.imageData = new Uint8ClampedArray(destSize);
    for (let srcStart = array_ptr, destStart = 0; destStart < destSize; srcStart += pitch32, destStart += pitch8) {
      imageData.set(HEAPU8.subarray(srcStart, srcStart + pitch8), destStart);
    }
  }
  function _setLineData(line_ptr, pitch8, offset) {
    Module.imageData.set(HEAPU8.subarray(line_ptr, line_ptr + pitch8), offset);
  }
  var writeArrayToMemory = (array, buffer) => {
    HEAP8.set(array, buffer);
  };
  if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
  if (Module["print"]) out = Module["print"];
  if (Module["printErr"]) err = Module["printErr"];
  if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
  if (Module["arguments"]) arguments_ = Module["arguments"];
  if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
  if (Module["preInit"]) {
    if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
    while (Module["preInit"].length > 0) {
      Module["preInit"].shift()();
    }
  }
  Module["writeArrayToMemory"] = writeArrayToMemory;
  var _malloc, _free, _jbig2_decode, _ccitt_decode, __emscripten_timeout, memory, __indirect_function_table, wasmMemory;
  function assignWasmExports(wasmExports) {
    _malloc = Module["_malloc"] = wasmExports["k"];
    _free = Module["_free"] = wasmExports["l"];
    _jbig2_decode = Module["_jbig2_decode"] = wasmExports["m"];
    _ccitt_decode = Module["_ccitt_decode"] = wasmExports["n"];
    __emscripten_timeout = wasmExports["o"];
    memory = wasmMemory = wasmExports["i"];
    __indirect_function_table = wasmExports["__indirect_function_table"];
  }
  var wasmImports = {
    e: __abort_js,
    b: __emscripten_runtime_keepalive_clear,
    c: __setitimer_js,
    g: _createImageData,
    d: _emscripten_resize_heap,
    a: _proc_exit,
    h: _setImageData,
    f: _setLineData
  };
  function run() {
    preRun();
    function doRun() {
      Module["calledRun"] = true;
      if (ABORT) return;
      initRuntime();
      readyPromiseResolve?.(Module);
      Module["onRuntimeInitialized"]?.();
      postRun();
    }
    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(() => {
        setTimeout(() => Module["setStatus"](""), 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }
  var wasmExports;
  wasmExports = await createWasm();
  run();
  if (runtimeInitialized) {
    moduleRtn = Module;
  } else {
    moduleRtn = new Promise((resolve, reject) => {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
  }
  return moduleRtn;
}
/* harmony default export */ const jbig2 = (JBig2);
;// ./src/core/primitives.js

const CIRCULAR_REF = Symbol("CIRCULAR_REF");
const EOF = Symbol("EOF");
let CmdCache = Object.create(null);
let NameCache = Object.create(null);
let RefCache = Object.create(null);
function clearPrimitiveCaches() {
  CmdCache = Object.create(null);
  NameCache = Object.create(null);
  RefCache = Object.create(null);
}
class Name {
  constructor(name) {
    this.name = name;
  }
  static get(name) {
    return NameCache[name] ||= new Name(name);
  }
}
class Cmd {
  constructor(cmd) {
    this.cmd = cmd;
  }
  static get(cmd) {
    return CmdCache[cmd] ||= new Cmd(cmd);
  }
}
const nonSerializable = function nonSerializableClosure() {
  return nonSerializable;
};
class Dict {
  __nonSerializable__ = nonSerializable;
  #map = new Map();
  objId = null;
  suppressEncryption = false;
  xref;
  constructor(xref = null) {
    this.xref = xref;
  }
  assignXref(newXref) {
    this.xref = newXref;
  }
  get size() {
    return this.#map.size;
  }
  #getValue(isAsync, key1, key2, key3) {
    let value = this.#map.get(key1);
    if (value === undefined && key2 !== undefined) {
      value = this.#map.get(key2);
      if (value === undefined && key3 !== undefined) {
        value = this.#map.get(key3);
      }
    }
    if (value instanceof Ref && this.xref) {
      return isAsync ? this.xref.fetchAsync(value, this.suppressEncryption) : this.xref.fetch(value, this.suppressEncryption);
    }
    return value;
  }
  get(key1, key2, key3) {
    return this.#getValue(false, key1, key2, key3);
  }
  async getAsync(key1, key2, key3) {
    return this.#getValue(true, key1, key2, key3);
  }
  getArray(key1, key2, key3) {
    let value = this.#getValue(false, key1, key2, key3);
    if (Array.isArray(value)) {
      value = value.slice();
      for (let i = 0, ii = value.length; i < ii; i++) {
        if (value[i] instanceof Ref && this.xref) {
          value[i] = this.xref.fetch(value[i], this.suppressEncryption);
        }
      }
    }
    return value;
  }
  getRaw(key) {
    return this.#map.get(key);
  }
  getKeys() {
    return this.#map.keys();
  }
  getRawValues() {
    return this.#map.values();
  }
  getRawEntries() {
    return this.#map.entries();
  }
  set(key, value) {
    this.#map.set(key, value);
  }
  setIfNotExists(key, value) {
    if (!this.has(key)) {
      this.set(key, value);
    }
  }
  setIfNumber(key, value) {
    if (typeof value === "number") {
      this.set(key, value);
    }
  }
  setIfArray(key, value) {
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      this.set(key, value);
    }
  }
  setIfDefined(key, value) {
    if (value !== undefined && value !== null) {
      this.set(key, value);
    }
  }
  setIfName(key, value) {
    if (typeof value === "string") {
      this.set(key, Name.get(value));
    } else if (value instanceof Name) {
      this.set(key, value);
    }
  }
  setIfDict(key, value) {
    if (value instanceof Dict) {
      this.set(key, value);
    }
  }
  has(key) {
    return this.#map.has(key);
  }
  *[Symbol.iterator]() {
    for (const [key, value] of this.#map) {
      yield [key, value instanceof Ref && this.xref ? this.xref.fetch(value, this.suppressEncryption) : value];
    }
  }
  static get empty() {
    const emptyDict = new Dict(null);
    emptyDict.set = (key, value) => {
      unreachable("Should not call `set` on the empty dictionary.");
    };
    return shadow(this, "empty", emptyDict);
  }
  static merge({
    xref,
    dictArray,
    mergeSubDicts = false
  }) {
    const mergedDict = new Dict(xref),
      properties = new Map();
    for (const dict of dictArray) {
      if (!(dict instanceof Dict)) {
        continue;
      }
      for (const [key, value] of dict.getRawEntries()) {
        const property = properties.getOrInsertComputed(key, makeArr);
        if (property.length && !(mergeSubDicts && value instanceof Dict)) {
          continue;
        }
        property.push(value);
      }
    }
    for (const [name, values] of properties) {
      if (values.length === 1 || !(values[0] instanceof Dict)) {
        mergedDict.set(name, values[0]);
        continue;
      }
      const subDict = new Dict(xref);
      for (const dict of values) {
        for (const [key, value] of dict.getRawEntries()) {
          subDict.setIfNotExists(key, value);
        }
      }
      if (subDict.size > 0) {
        mergedDict.set(name, subDict);
      }
    }
    properties.clear();
    return mergedDict.size > 0 ? mergedDict : Dict.empty;
  }
  clone() {
    const dict = new Dict(this.xref);
    for (const [key, value] of this.#map) {
      dict.set(key, value);
    }
    return dict;
  }
  delete(key) {
    this.#map.delete(key);
  }
}
class Ref {
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
  toString() {
    if (this.gen === 0) {
      return `${this.num}R`;
    }
    return `${this.num}R${this.gen}`;
  }
  static fromString(str) {
    const ref = RefCache[str];
    if (ref) {
      return ref;
    }
    const m = /^(\d+)R(\d*)$/.exec(str);
    if (!m || m[1] === "0") {
      return null;
    }
    return RefCache[str] = new Ref(parseInt(m[1], 10), !m[2] ? 0 : parseInt(m[2], 10));
  }
  static get(num, gen) {
    const key = gen === 0 ? `${num}R` : `${num}R${gen}`;
    return RefCache[key] ||= new Ref(num, gen);
  }
}
class RefSet {
  constructor(parent = null) {
    this._set = new Set(parent?._set);
  }
  has(ref) {
    return this._set.has(ref.toString());
  }
  put(ref) {
    this._set.add(ref.toString());
  }
  remove(ref) {
    this._set.delete(ref.toString());
  }
  [Symbol.iterator]() {
    return this._set.values();
  }
  clear() {
    this._set.clear();
  }
}
class RefSetCache {
  _map = new Map();
  get size() {
    return this._map.size;
  }
  get(ref) {
    return this._map.get(ref.toString());
  }
  has(ref) {
    return this._map.has(ref.toString());
  }
  put(ref, obj) {
    this._map.set(ref.toString(), obj);
  }
  putAlias(ref, aliasRef) {
    this._map.set(ref.toString(), this.get(aliasRef));
  }
  [Symbol.iterator]() {
    return this._map.values();
  }
  clear() {
    this._map.clear();
  }
  *values() {
    yield* this._map.values();
  }
  *items() {
    for (const [ref, value] of this._map) {
      yield [Ref.fromString(ref), value];
    }
  }
  *keys() {
    for (const ref of this._map.keys()) {
      yield Ref.fromString(ref);
    }
  }
}
function isName(v, name) {
  return v instanceof Name && (name === undefined || v.name === name);
}
function isCmd(v, cmd) {
  return v instanceof Cmd && (cmd === undefined || v.cmd === cmd);
}
function isDict(v, type) {
  return v instanceof Dict && (type === undefined || isName(v.get("Type"), type));
}
function isRefsEqual(v1, v2) {
  return v1.num === v2.num && v1.gen === v2.gen;
}

;// ./src/core/base_stream.js

class BaseStream {
  get length() {
    unreachable("Abstract getter `length` accessed");
  }
  get isEmpty() {
    unreachable("Abstract getter `isEmpty` accessed");
  }
  get isDataLoaded() {
    return shadow(this, "isDataLoaded", true);
  }
  getByte() {
    unreachable("Abstract method `getByte` called");
  }
  getBytes(length) {
    unreachable("Abstract method `getBytes` called");
  }
  async getImageData(length, decoderOptions) {
    return this.getBytes(length, decoderOptions);
  }
  async asyncGetBytes() {
    unreachable("Abstract method `asyncGetBytes` called");
  }
  get isAsync() {
    return false;
  }
  get isAsyncDecoder() {
    return false;
  }
  get isImageStream() {
    return false;
  }
  get canAsyncDecodeImageFromBuffer() {
    return false;
  }
  async getTransferableImage() {
    return null;
  }
  peekByte() {
    const peekedByte = this.getByte();
    if (peekedByte !== -1) {
      this.pos--;
    }
    return peekedByte;
  }
  peekBytes(length) {
    const bytes = this.getBytes(length);
    this.pos -= bytes.length;
    return bytes;
  }
  getUint16() {
    const b0 = this.getByte();
    const b1 = this.getByte();
    if (b0 === -1 || b1 === -1) {
      return -1;
    }
    return (b0 << 8) + b1;
  }
  getInt32() {
    const b0 = this.getByte();
    const b1 = this.getByte();
    const b2 = this.getByte();
    const b3 = this.getByte();
    return (b0 << 24) + (b1 << 16) + (b2 << 8) + b3;
  }
  getByteRange(begin, end) {
    unreachable("Abstract method `getByteRange` called");
  }
  getString(length) {
    return bytesToString(this.getBytes(length));
  }
  skip(n) {
    this.pos += n || 1;
  }
  reset() {
    unreachable("Abstract method `reset` called");
  }
  moveStart() {
    unreachable("Abstract method `moveStart` called");
  }
  makeSubStream(start, length, dict = null) {
    unreachable("Abstract method `makeSubStream` called");
  }
  clone() {
    unreachable("Abstract method `clone` called");
  }
  getBaseStreams() {
    return null;
  }
  getOriginalStream() {
    return this.stream?.getOriginalStream() || this;
  }
}

;// ./src/core/string_utils.js
/* unused harmony import specifier */ var string_utils_Util;
/* unused harmony import specifier */ var string_utils_stringToBytes;
/* unused harmony import specifier */ var string_utils_warn;

function isAscii(str) {
  return typeof str === "string" && (!str || /^[\x00-\x7F]*$/.test(str));
}
function stringToAsciiOrUTF16BE(str) {
  if (str === null || str === undefined) {
    return str;
  }
  return isAscii(str) ? str : stringToUTF16String(str, true);
}
function stringToUTF16HexString(str) {
  const buf = [];
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.charCodeAt(i);
    buf.push(string_utils_Util.hexNums[char >> 8 & 0xff], string_utils_Util.hexNums[char & 0xff]);
  }
  return buf.join("");
}
function stringToUTF16String(str, bigEndian = false) {
  const buf = [];
  if (bigEndian) {
    buf.push("\xFE\xFF");
  }
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.charCodeAt(i);
    buf.push(String.fromCharCode(char >> 8 & 0xff), String.fromCharCode(char & 0xff));
  }
  return buf.join("");
}
const PDFStringTranslateTable = (/* unused pure expression or super */ null && ([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x2d8, 0x2c7, 0x2c6, 0x2d9, 0x2dd, 0x2db, 0x2da, 0x2dc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x2022, 0x2020, 0x2021, 0x2026, 0x2014, 0x2013, 0x192, 0x2044, 0x2039, 0x203a, 0x2212, 0x2030, 0x201e, 0x201c, 0x201d, 0x2018, 0x2019, 0x201a, 0x2122, 0xfb01, 0xfb02, 0x141, 0x152, 0x160, 0x178, 0x17d, 0x131, 0x142, 0x153, 0x161, 0x17e, 0, 0x20ac]));
function stringToPDFString(str, keepEscapeSequence = false) {
  if (str[0] >= "\xEF") {
    let encoding;
    if (str[0] === "\xFE" && str[1] === "\xFF") {
      encoding = "utf-16be";
      if (str.length % 2 === 1) {
        str = str.slice(0, -1);
      }
    } else if (str[0] === "\xFF" && str[1] === "\xFE") {
      encoding = "utf-16le";
      if (str.length % 2 === 1) {
        str = str.slice(0, -1);
      }
    } else if (str[0] === "\xEF" && str[1] === "\xBB" && str[2] === "\xBF") {
      encoding = "utf-8";
    }
    if (encoding) {
      try {
        const decoder = new TextDecoder(encoding, {
          fatal: true
        });
        const buffer = string_utils_stringToBytes(str);
        const decoded = decoder.decode(buffer);
        if (keepEscapeSequence || !decoded.includes("\x1b")) {
          return decoded;
        }
        return decoded.replaceAll(/\x1b[^\x1b]*(?:\x1b|$)/g, "");
      } catch (ex) {
        string_utils_warn(`stringToPDFString: "${ex}".`);
      }
    }
  }
  const strBuf = [];
  for (let i = 0, ii = str.length; i < ii; i++) {
    const charCode = str.charCodeAt(i);
    if (!keepEscapeSequence && charCode === 0x1b) {
      while (++i < ii && str.charCodeAt(i) !== 0x1b) {}
      continue;
    }
    const code = PDFStringTranslateTable[charCode];
    strBuf.push(code ? String.fromCharCode(code) : str.charAt(i));
  }
  return strBuf.join("");
}

;// ./src/core/core_utils.js
/* unused harmony import specifier */ var core_utils_assert;
/* unused harmony import specifier */ var core_utils_Util;
/* unused harmony import specifier */ var core_utils_objectSize;
/* unused harmony import specifier */ var core_utils_warn;
/* unused harmony import specifier */ var core_utils_AnnotationEditorPrefix;
/* unused harmony import specifier */ var core_utils_makeArr;
/* unused harmony import specifier */ var core_utils_RefSet;
/* unused harmony import specifier */ var core_utils_Dict;
/* unused harmony import specifier */ var core_utils_Ref;
/* unused harmony import specifier */ var core_utils_isRefsEqual;
/* unused harmony import specifier */ var core_utils_Name;
/* unused harmony import specifier */ var core_utils_isName;
/* unused harmony import specifier */ var core_utils_BaseStream;
/* unused harmony import specifier */ var core_utils_stringToPDFString;




const PDF_VERSION_REGEXP = /^[1-9]\.\d$/;
const MAX_INT_32 = (/* unused pure expression or super */ null && (2 ** 31 - 1));
const IDENTITY_MATRIX = (/* unused pure expression or super */ null && ([1, 0, 0, 1, 0, 0]));
const RESOURCES_KEYS_OPERATOR_LIST = (/* unused pure expression or super */ null && (["ColorSpace", "ExtGState", "Font", "Pattern", "Properties", "Shading", "XObject"]));
const RESOURCES_KEYS_TEXT_CONTENT = (/* unused pure expression or super */ null && (["ExtGState", "Font", "Properties", "XObject"]));
function getLookupTableFactory(initializer) {
  let lookup;
  return function () {
    if (initializer) {
      lookup = Object.create(null);
      initializer(lookup);
      initializer = null;
    }
    return lookup;
  };
}
class MissingDataException extends BaseException {
  constructor(begin, end) {
    super(`Missing data [${begin}, ${end})`, "MissingDataException");
    this.begin = begin;
    this.end = end;
  }
}
class ParserEOFException extends BaseException {
  constructor(msg) {
    super(msg, "ParserEOFException");
  }
}
class XRefEntryException extends BaseException {
  constructor(msg) {
    super(msg, "XRefEntryException");
  }
}
class XRefParseException extends BaseException {
  constructor(msg) {
    super(msg, "XRefParseException");
  }
}
function arrayBuffersToBytes(arr) {
  const length = arr.length;
  if (length === 0) {
    return new Uint8Array(0);
  }
  if (length === 1) {
    return new Uint8Array(arr[0]);
  }
  let dataLength = 0;
  for (let i = 0; i < length; i++) {
    dataLength += arr[i].byteLength;
  }
  const data = new Uint8Array(dataLength);
  let pos = 0;
  for (let i = 0; i < length; i++) {
    const item = new Uint8Array(arr[i]);
    data.set(item, pos);
    pos += item.byteLength;
  }
  return data;
}
async function fetchBinaryData(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file "${url}" with "${response.statusText}".`);
  }
  return response.bytes();
}
function getInheritableProperty({
  dict,
  key,
  getArray = false,
  stopWhenFound = true
}) {
  let values;
  const visited = new core_utils_RefSet();
  while (dict instanceof core_utils_Dict && !(dict.objId && visited.has(dict.objId))) {
    if (dict.objId) {
      visited.put(dict.objId);
    }
    const value = getArray ? dict.getArray(key) : dict.get(key);
    if (value !== undefined) {
      if (stopWhenFound) {
        return value;
      }
      (values ||= []).push(value);
    }
    dict = dict.get("Parent");
  }
  return values;
}
function getParentToUpdate(dict, ref, xref) {
  const visited = new core_utils_RefSet();
  const firstDict = dict;
  const result = {
    dict: null,
    ref: null
  };
  while (dict instanceof core_utils_Dict && !visited.has(ref)) {
    visited.put(ref);
    if (dict.has("T")) {
      break;
    }
    ref = dict.getRaw("Parent");
    if (!(ref instanceof core_utils_Ref)) {
      return result;
    }
    dict = xref.fetch(ref);
  }
  if (dict instanceof core_utils_Dict && dict !== firstDict) {
    result.dict = dict;
    result.ref = ref;
  }
  return result;
}
function deepCompare(a, b) {
  if (a === b) {
    return true;
  }
  if (a instanceof core_utils_Ref && b instanceof core_utils_Ref) {
    return core_utils_isRefsEqual(a, b);
  }
  if (a instanceof core_utils_Name && b instanceof core_utils_Name) {
    return a.name === b.name;
  }
  if (a instanceof core_utils_Dict && b instanceof core_utils_Dict) {
    if (a.size !== b.size) {
      return false;
    }
    for (const [key, value1] of a.getRawEntries()) {
      const value2 = b.getRaw(key);
      if (value2 === undefined || !deepCompare(value1, value2)) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0, ii = a.length; i < ii; i++) {
      if (!deepCompare(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  return false;
}
const ROMAN_NUMBER_MAP = (/* unused pure expression or super */ null && (["", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM", "", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC", "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"]));
function toRomanNumerals(number, lowerCase = false) {
  core_utils_assert(Number.isInteger(number) && number > 0, "The number should be a positive integer.");
  const roman = "M".repeat(number / 1000 | 0) + ROMAN_NUMBER_MAP[number % 1000 / 100 | 0] + ROMAN_NUMBER_MAP[10 + (number % 100 / 10 | 0)] + ROMAN_NUMBER_MAP[20 + number % 10];
  return lowerCase ? roman.toLowerCase() : roman;
}
function isWhiteSpace(ch) {
  return ch === 0x20 || ch === 0x09 || ch === 0x0d || ch === 0x0a;
}
function isBooleanArray(arr, len) {
  return Array.isArray(arr) && (len === null || arr.length === len) && arr.every(x => typeof x === "boolean");
}
function isNumberArray(arr, len) {
  if (Array.isArray(arr)) {
    return (len === null || arr.length === len) && arr.every(x => typeof x === "number");
  }
  return ArrayBuffer.isView(arr) && !(arr instanceof BigInt64Array || arr instanceof BigUint64Array) && (len === null || arr.length === len);
}
function lookupMatrix(arr, fallback) {
  return isNumberArray(arr, 6) ? arr : fallback;
}
function lookupRect(arr, fallback) {
  return isNumberArray(arr, 4) ? arr : fallback;
}
function lookupNormalRect(arr, fallback) {
  return isNumberArray(arr, 4) ? core_utils_Util.normalizeRect(arr) : fallback;
}
function parseXFAPath(path) {
  const positionPattern = /(.+)\[(\d+)\]$/;
  return path.split(".").map(component => {
    const m = component.match(positionPattern);
    if (m) {
      return {
        name: m[1],
        pos: parseInt(m[2], 10)
      };
    }
    return {
      name: component,
      pos: 0
    };
  });
}
function escapePDFName(str) {
  const buffer = [];
  let start = 0;
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.charCodeAt(i);
    if (char < 0x21 || char > 0x7e || char === 0x23 || char === 0x28 || char === 0x29 || char === 0x3c || char === 0x3e || char === 0x5b || char === 0x5d || char === 0x7b || char === 0x7d || char === 0x2f || char === 0x25) {
      if (start < i) {
        buffer.push(str.substring(start, i));
      }
      buffer.push(`#${char.toString(16)}`);
      start = i + 1;
    }
  }
  if (buffer.length === 0) {
    return str;
  }
  if (start < str.length) {
    buffer.push(str.substring(start));
  }
  return buffer.join("");
}
function escapeString(str) {
  return str.replaceAll(/([()\\\n\r])/g, match => {
    if (match === "\n") {
      return "\\n";
    } else if (match === "\r") {
      return "\\r";
    }
    return `\\${match}`;
  });
}
function _collectJS(entry, xref, list, parents) {
  if (!entry) {
    return;
  }
  let parent = null;
  if (entry instanceof core_utils_Ref) {
    if (parents.has(entry)) {
      return;
    }
    parent = entry;
    parents.put(parent);
    entry = xref.fetch(entry);
  }
  if (Array.isArray(entry)) {
    for (const element of entry) {
      _collectJS(element, xref, list, parents);
    }
  } else if (entry instanceof core_utils_Dict) {
    if (core_utils_isName(entry.get("S"), "JavaScript")) {
      const js = entry.get("JS");
      let code;
      if (js instanceof core_utils_BaseStream) {
        code = js.getString();
      } else if (typeof js === "string") {
        code = js;
      }
      code &&= core_utils_stringToPDFString(code, true).replaceAll("\x00", "");
      if (code) {
        list.push(code.trim());
      }
    }
    _collectJS(entry.getRaw("Next"), xref, list, parents);
  }
  if (parent) {
    parents.remove(parent);
  }
}
function collectActions(xref, dict, eventType) {
  const actions = Object.create(null);
  const additionalActionsDicts = getInheritableProperty({
    dict,
    key: "AA",
    stopWhenFound: false
  });
  if (additionalActionsDicts) {
    for (let i = additionalActionsDicts.length - 1; i >= 0; i--) {
      const additionalActions = additionalActionsDicts[i];
      if (!(additionalActions instanceof core_utils_Dict)) {
        continue;
      }
      for (const [key, rawActionDict] of additionalActions.getRawEntries()) {
        const action = eventType[key];
        if (!action) {
          continue;
        }
        const parents = new core_utils_RefSet();
        const list = [];
        _collectJS(rawActionDict, xref, list, parents);
        if (list.length > 0) {
          actions[action] = list;
        }
      }
    }
  }
  if (dict.has("A")) {
    const actionDict = dict.get("A");
    const parents = new core_utils_RefSet();
    const list = [];
    _collectJS(actionDict, xref, list, parents);
    if (list.length > 0) {
      actions.Action = list;
    }
  }
  return core_utils_objectSize(actions) > 0 ? actions : null;
}
const XMLEntities = (/* unused pure expression or super */ null && ({
  0x3c: "&lt;",
  0x3e: "&gt;",
  0x26: "&amp;",
  0x22: "&quot;",
  0x27: "&apos;"
}));
function* codePointIter(str) {
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.codePointAt(i);
    if (char > 0xd7ff && (char < 0xe000 || char > 0xfffd)) {
      i++;
    }
    yield char;
  }
}
function encodeToXmlString(str) {
  const buffer = [];
  let start = 0;
  for (let i = 0, ii = str.length; i < ii; i++) {
    const char = str.codePointAt(i);
    if (0x20 <= char && char <= 0x7e) {
      const entity = XMLEntities[char];
      if (entity) {
        if (start < i) {
          buffer.push(str.substring(start, i));
        }
        buffer.push(entity);
        start = i + 1;
      }
    } else {
      if (start < i) {
        buffer.push(str.substring(start, i));
      }
      buffer.push(`&#x${char.toString(16).toUpperCase()};`);
      if (char > 0xd7ff && (char < 0xe000 || char > 0xfffd)) {
        i++;
      }
      start = i + 1;
    }
  }
  if (buffer.length === 0) {
    return str;
  }
  if (start < str.length) {
    buffer.push(str.substring(start));
  }
  return buffer.join("");
}
function validateFontName(fontFamily, mustWarn = false) {
  const m = /^("|').*("|')$/.exec(fontFamily);
  if (m && m[1] === m[2]) {
    const re = new RegExp(`[^\\\\]${m[1]}`);
    if (re.test(fontFamily.slice(1, -1))) {
      if (mustWarn) {
        core_utils_warn(`FontFamily contains unescaped ${m[1]}: ${fontFamily}.`);
      }
      return false;
    }
  } else {
    for (const ident of fontFamily.split(/[ \t]+/)) {
      if (/^(?:\d|-[\d-])/.test(ident) || !/^[\w\\-]+$/.test(ident)) {
        if (mustWarn) {
          core_utils_warn(`FontFamily contains invalid <custom-ident>: ${fontFamily}.`);
        }
        return false;
      }
    }
  }
  return true;
}
function validateCSSFont(cssFontInfo) {
  const DEFAULT_CSS_FONT_OBLIQUE = "14";
  const DEFAULT_CSS_FONT_WEIGHT = "400";
  const CSS_FONT_WEIGHT_VALUES = new Set(["100", "200", "300", "400", "500", "600", "700", "800", "900", "1000", "normal", "bold", "bolder", "lighter"]);
  const {
    fontFamily,
    fontWeight,
    italicAngle
  } = cssFontInfo;
  if (!validateFontName(fontFamily, true)) {
    return false;
  }
  const weight = fontWeight ? fontWeight.toString() : "";
  cssFontInfo.fontWeight = CSS_FONT_WEIGHT_VALUES.has(weight) ? weight : DEFAULT_CSS_FONT_WEIGHT;
  const angle = parseFloat(italicAngle);
  cssFontInfo.italicAngle = isNaN(angle) || angle < -90 || angle > 90 ? DEFAULT_CSS_FONT_OBLIQUE : italicAngle.toString();
  return true;
}
function recoverJsURL(str) {
  const URL_OPEN_METHODS = ["app.launchURL", "window.open", "xfa.host.gotoURL"];
  const regex = new RegExp("^\\s*(" + URL_OPEN_METHODS.join("|").replaceAll(".", "\\.") + ")\\((?:'|\")([^'\"]*)(?:'|\")(?:,\\s*(\\w+)\\)|\\))", "i");
  const jsUrl = regex.exec(str);
  if (jsUrl?.[2]) {
    return {
      url: jsUrl[2],
      newWindow: jsUrl[1] === "app.launchURL" && jsUrl[3] === "true"
    };
  }
  return null;
}
function numberToString(value) {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  const roundedValue = Math.round(value * 100);
  if (roundedValue % 100 === 0) {
    return (roundedValue / 100).toString();
  }
  if (roundedValue % 10 === 0) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}
function getNewAnnotationsMap(annotationStorage) {
  if (!annotationStorage) {
    return null;
  }
  const newAnnotationsByPage = new Map();
  for (const [key, value] of annotationStorage) {
    if (!key.startsWith(core_utils_AnnotationEditorPrefix)) {
      continue;
    }
    newAnnotationsByPage.getOrInsertComputed(value.pageIndex, core_utils_makeArr).push(value);
  }
  return newAnnotationsByPage.size > 0 ? newAnnotationsByPage : null;
}
function getModificationDate(date = new Date()) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  const buffer = [date.getUTCFullYear().toString(), (date.getUTCMonth() + 1).toString().padStart(2, "0"), date.getUTCDate().toString().padStart(2, "0"), date.getUTCHours().toString().padStart(2, "0"), date.getUTCMinutes().toString().padStart(2, "0"), date.getUTCSeconds().toString().padStart(2, "0")];
  return buffer.join("");
}
function getRotationMatrix(rotation, width, height) {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, width, 0];
    case 180:
      return [-1, 0, 0, -1, width, height];
    case 270:
      return [0, -1, 1, 0, 0, height];
    default:
      throw new Error("Invalid rotation");
  }
}
function getSizeInBytes(x) {
  return Math.ceil(Math.ceil(Math.log2(1 + x)) / 8);
}

;// ./src/core/wasm_image.js


class WasmImage {
  static #handler = null;
  static #instances = new Set();
  static #useWasm = true;
  static #useWorkerFetch = true;
  static #wasmUrl = null;
  #buffer = null;
  #modulePromise = null;
  _filename = null;
  _noWasmFilename = null;
  static setOptions({
    handler,
    useWasm,
    useWorkerFetch,
    wasmUrl
  }) {
    WasmImage.#useWasm = useWasm;
    WasmImage.#useWorkerFetch = useWorkerFetch;
    WasmImage.#wasmUrl = wasmUrl;
    if (!useWorkerFetch) {
      WasmImage.#handler = handler;
    }
  }
  static get instance() {
    unreachable("Abstract getter `instance` accessed");
  }
  static cleanup() {
    for (const instance of WasmImage.#instances) {
      instance.#modulePromise = null;
    }
  }
  constructor(trackInstance = false) {
    if (trackInstance) {
      WasmImage.#instances.add(this);
    }
  }
  async #getJsModule(fallbackCallback) {
    let instance = null;
    try {
      const mod = await import(
      /*webpackIgnore: true*/
      /*@vite-ignore*/
      `${WasmImage.#wasmUrl}${this._noWasmFilename}`);
      instance = mod.default();
    } catch (ex) {
      warn(`#getJsModule: ${ex}`);
    }
    fallbackCallback(instance);
  }
  async #instantiateWasm(fallbackCallback, imports, successCallback) {
    try {
      if (!this.#buffer) {
        if (WasmImage.#useWorkerFetch) {
          this.#buffer = await fetchBinaryData(`${WasmImage.#wasmUrl}${this._filename}`);
        } else {
          this.#buffer = await WasmImage.#handler.sendWithPromise("FetchBinaryData", {
            kind: "wasmUrl",
            filename: this._filename
          });
        }
      }
      const results = await WebAssembly.instantiate(this.#buffer, imports);
      return successCallback(results.instance);
    } catch (ex) {
      warn(`#instantiateWasm: ${ex}`);
      this.#getJsModule(fallbackCallback);
      return null;
    }
  }
  _getModule(ImageDecoder) {
    if (!this.#modulePromise) {
      const {
        promise,
        resolve
      } = Promise.withResolvers();
      const promises = [promise];
      if (!WasmImage.#useWasm) {
        this.#getJsModule(resolve);
      } else {
        promises.push(ImageDecoder({
          warn: warn,
          instantiateWasm: this.#instantiateWasm.bind(this, resolve)
        }));
      }
      this.#modulePromise = Promise.race(promises);
    }
    return this.#modulePromise;
  }
  async decode(bytes, _params) {
    unreachable("Abstract method `decode` called");
  }
}

;// ./src/core/jbig2_ccittFax.js



class Jbig2Error extends BaseException {
  constructor(msg) {
    super(msg, "Jbig2Error");
  }
}
class JBig2CCITTFaxImage extends WasmImage {
  _filename = "jbig2.wasm";
  _noWasmFilename = "jbig2_nowasm_fallback.js";
  static get instance() {
    return shadow(this, "instance", new JBig2CCITTFaxImage(true));
  }
  async decode(bytes, width, height, globals, CCITTOptions) {
    const module = await this._getModule(jbig2);
    if (!module) {
      throw new Jbig2Error("JBig2 failed to initialize");
    }
    let ptr, globalsPtr;
    try {
      const size = bytes.length;
      ptr = module._malloc(size);
      module.writeArrayToMemory(bytes, ptr);
      if (CCITTOptions) {
        module._ccitt_decode(ptr, size, width, height, CCITTOptions.K, CCITTOptions.EndOfLine ? 1 : 0, CCITTOptions.EncodedByteAlign ? 1 : 0, CCITTOptions.BlackIs1 ? 1 : 0, CCITTOptions.Columns, CCITTOptions.Rows);
      } else {
        const globalsSize = globals ? globals.length : 0;
        if (globalsSize > 0) {
          globalsPtr = module._malloc(globalsSize);
          module.writeArrayToMemory(globals, globalsPtr);
        }
        module._jbig2_decode(ptr, size, width, height, globalsPtr, globalsSize);
      }
      if (!module.imageData) {
        throw new Jbig2Error("Unknown error");
      }
      const {
        imageData
      } = module;
      module.imageData = null;
      return imageData;
    } finally {
      if (ptr) {
        module._free(ptr);
      }
      if (globalsPtr) {
        module._free(globalsPtr);
      }
    }
  }
}

;// ./src/shared/math_clamp.js
function MathClamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

;// ./src/core/colorspace.js



function resizeRgbImage(src, dest, w1, h1, w2, h2, alpha01) {
  const COMPONENTS = 3;
  alpha01 = alpha01 !== 1 ? 0 : alpha01;
  const xRatio = w1 / w2;
  const yRatio = h1 / h2;
  let newIndex = 0,
    oldIndex;
  const xScaled = new Uint16Array(w2);
  const w1Scanline = w1 * COMPONENTS;
  for (let i = 0; i < w2; i++) {
    xScaled[i] = Math.floor(i * xRatio) * COMPONENTS;
  }
  for (let i = 0; i < h2; i++) {
    const py = Math.floor(i * yRatio) * w1Scanline;
    for (let j = 0; j < w2; j++) {
      oldIndex = py + xScaled[j];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      dest[newIndex++] = src[oldIndex++];
      newIndex += alpha01;
    }
  }
}
function resizeRgbaImage(src, dest, w1, h1, w2, h2, alpha01) {
  const xRatio = w1 / w2;
  const yRatio = h1 / h2;
  let newIndex = 0;
  const xScaled = new Uint16Array(w2);
  if (alpha01 === 1) {
    for (let i = 0; i < w2; i++) {
      xScaled[i] = Math.floor(i * xRatio);
    }
    const src32 = new Uint32Array(src.buffer);
    const dest32 = new Uint32Array(dest.buffer);
    const rgbMask = FeatureTest.isLittleEndian ? 0x00ffffff : 0xffffff00;
    for (let i = 0; i < h2; i++) {
      const buf = src32.subarray(Math.floor(i * yRatio) * w1);
      for (let j = 0; j < w2; j++) {
        dest32[newIndex++] |= buf[xScaled[j]] & rgbMask;
      }
    }
  } else {
    const COMPONENTS = 4;
    const w1Scanline = w1 * COMPONENTS;
    for (let i = 0; i < w2; i++) {
      xScaled[i] = Math.floor(i * xRatio) * COMPONENTS;
    }
    for (let i = 0; i < h2; i++) {
      const buf = src.subarray(Math.floor(i * yRatio) * w1Scanline);
      for (let j = 0; j < w2; j++) {
        const oldIndex = xScaled[j];
        dest[newIndex++] = buf[oldIndex];
        dest[newIndex++] = buf[oldIndex + 1];
        dest[newIndex++] = buf[oldIndex + 2];
      }
    }
  }
}
function copyRgbaImage(src, dest, alpha01) {
  if (alpha01 === 1) {
    const src32 = new Uint32Array(src.buffer);
    const dest32 = new Uint32Array(dest.buffer);
    const rgbMask = FeatureTest.isLittleEndian ? 0x00ffffff : 0xffffff00;
    for (let i = 0, ii = src32.length; i < ii; i++) {
      dest32[i] |= src32[i] & rgbMask;
    }
  } else {
    let j = 0;
    for (let i = 0, ii = src.length; i < ii; i += 4) {
      dest[j++] = src[i];
      dest[j++] = src[i + 1];
      dest[j++] = src[i + 2];
    }
  }
}
function isDefaultDecodeHelper(decode, expectedLen) {
  if (!Array.isArray(decode)) {
    return true;
  }
  const decodeLen = decode.length;
  if (decodeLen < expectedLen) {
    warn("Decode map length is too short.");
    return true;
  }
  if (decodeLen > expectedLen) {
    info("Truncating too long decode map.");
    decode.length = expectedLen;
  }
  return false;
}
class ColorSpace {
  static #rgbBuf = new Uint8ClampedArray(3);
  constructor(name, numComps) {
    this.name = name;
    this.numComps = numComps;
  }
  getRgb(src, srcOffset, output = new Uint8ClampedArray(3)) {
    this.getRgbItem(src, srcOffset, output, 0);
    return output;
  }
  getRgbHex(src, srcOffset) {
    const buffer = this.getRgb(src, srcOffset, ColorSpace.#rgbBuf);
    return Util.makeHexColor(buffer[0], buffer[1], buffer[2]);
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    unreachable("Should not call ColorSpace.getRgbItem");
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    unreachable("Should not call ColorSpace.getRgbBuffer");
  }
  getOutputLength(inputLength, alpha01) {
    unreachable("Should not call ColorSpace.getOutputLength");
  }
  isPassthrough(bits) {
    return false;
  }
  isDefaultDecode(decode, bpc) {
    return ColorSpace.isDefaultDecode(decode, this.numComps);
  }
  fillRgb(dest, originalWidth, originalHeight, width, height, actualHeight, bpc, comps, alpha01) {
    const count = originalWidth * originalHeight;
    let rgbBuf = null;
    const numComponentColors = 1 << bpc;
    const needsResizing = originalHeight !== height || originalWidth !== width;
    if (this.isPassthrough(bpc)) {
      rgbBuf = comps;
    } else if (this.numComps === 1 && count > numComponentColors && this.name !== "DeviceGray" && this.name !== "DeviceRGB") {
      const allColors = bpc <= 8 ? new Uint8Array(numComponentColors) : new Uint16Array(numComponentColors);
      for (let i = 0; i < numComponentColors; i++) {
        allColors[i] = i;
      }
      const colorMap = new Uint8ClampedArray(numComponentColors * 3);
      this.getRgbBuffer(allColors, 0, numComponentColors, colorMap, 0, bpc, 0);
      if (!needsResizing) {
        let destPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          dest[destPos++] = colorMap[key];
          dest[destPos++] = colorMap[key + 1];
          dest[destPos++] = colorMap[key + 2];
          destPos += alpha01;
        }
      } else {
        rgbBuf = new Uint8Array(count * 3);
        let rgbPos = 0;
        for (let i = 0; i < count; ++i) {
          const key = comps[i] * 3;
          rgbBuf[rgbPos++] = colorMap[key];
          rgbBuf[rgbPos++] = colorMap[key + 1];
          rgbBuf[rgbPos++] = colorMap[key + 2];
        }
      }
    } else if (!needsResizing) {
      this.getRgbBuffer(comps, 0, width * actualHeight, dest, 0, bpc, alpha01);
    } else {
      rgbBuf = new Uint8ClampedArray(count * 3);
      this.getRgbBuffer(comps, 0, count, rgbBuf, 0, bpc, 0);
    }
    if (rgbBuf) {
      if (needsResizing) {
        resizeRgbImage(rgbBuf, dest, originalWidth, originalHeight, width, height, alpha01);
      } else {
        let destPos = 0,
          rgbPos = 0;
        for (let i = 0, ii = width * actualHeight; i < ii; i++) {
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          dest[destPos++] = rgbBuf[rgbPos++];
          destPos += alpha01;
        }
      }
    }
  }
  get usesZeroToOneRange() {
    return shadow(this, "usesZeroToOneRange", true);
  }
  static isDefaultDecode(decode, numComps) {
    if (isDefaultDecodeHelper(decode, numComps * 2)) {
      return true;
    }
    for (let i = 0, ii = decode.length; i < ii; i += 2) {
      if (decode[i] !== 0 || decode[i + 1] !== 1) {
        return false;
      }
    }
    return true;
  }
}
class AlternateCS extends ColorSpace {
  constructor(numComps, base, tintFn) {
    super("Alternate", numComps);
    this.base = base;
    this.tintFn = tintFn;
    this.tmpBuf = new Float32Array(base.numComps);
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    const tmpBuf = this.tmpBuf;
    this.tintFn(src, srcOffset, tmpBuf, 0);
    this.base.getRgbItem(tmpBuf, 0, dest, destOffset);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    const tintFn = this.tintFn;
    const base = this.base;
    const scale = 1 / ((1 << bits) - 1);
    const baseNumComps = base.numComps;
    const usesZeroToOneRange = base.usesZeroToOneRange;
    const isPassthrough = (base.isPassthrough(8) || !usesZeroToOneRange) && alpha01 === 0;
    let pos = isPassthrough ? destOffset : 0;
    const baseBuf = isPassthrough ? dest : new Uint8ClampedArray(baseNumComps * count);
    const numComps = this.numComps;
    const scaled = new Float32Array(numComps);
    const tinted = new Float32Array(baseNumComps);
    let i, j;
    for (i = 0; i < count; i++) {
      for (j = 0; j < numComps; j++) {
        scaled[j] = src[srcOffset++] * scale;
      }
      tintFn(scaled, 0, tinted, 0);
      if (usesZeroToOneRange) {
        for (j = 0; j < baseNumComps; j++) {
          baseBuf[pos++] = tinted[j] * 255;
        }
      } else {
        base.getRgbItem(tinted, 0, baseBuf, pos);
        pos += baseNumComps;
      }
    }
    if (!isPassthrough) {
      base.getRgbBuffer(baseBuf, 0, count, dest, destOffset, 8, alpha01);
    }
  }
  getOutputLength(inputLength, alpha01) {
    return this.base.getOutputLength(inputLength * this.base.numComps / this.numComps, alpha01);
  }
}
class PatternCS extends ColorSpace {
  constructor(baseCS) {
    super("Pattern", null);
    this.base = baseCS;
  }
  isDefaultDecode(decode, bpc) {
    unreachable("Should not call PatternCS.isDefaultDecode");
  }
}
class IndexedCS extends ColorSpace {
  constructor(base, highVal, lookup) {
    super("Indexed", 1);
    this.base = base;
    this.highVal = highVal;
    const length = base.numComps * (highVal + 1);
    this.lookup = new Uint8Array(length);
    if (lookup instanceof BaseStream) {
      const bytes = lookup.getBytes(length);
      this.lookup.set(bytes);
    } else if (typeof lookup === "string") {
      for (let i = 0; i < length; ++i) {
        this.lookup[i] = lookup.charCodeAt(i) & 0xff;
      }
    } else {
      throw new FormatError(`IndexedCS - unrecognized lookup table: ${lookup}`);
    }
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    const {
      base,
      highVal,
      lookup
    } = this;
    const start = MathClamp(Math.round(src[srcOffset]), 0, highVal) * base.numComps;
    base.getRgbBuffer(lookup, start, 1, dest, destOffset, 8, 0);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    const {
      base,
      highVal,
      lookup
    } = this;
    const {
      numComps
    } = base;
    const outputDelta = base.getOutputLength(numComps, alpha01);
    for (let i = 0; i < count; ++i) {
      const lookupPos = MathClamp(Math.round(src[srcOffset++]), 0, highVal) * numComps;
      base.getRgbBuffer(lookup, lookupPos, 1, dest, destOffset, 8, alpha01);
      destOffset += outputDelta;
    }
  }
  getOutputLength(inputLength, alpha01) {
    return this.base.getOutputLength(inputLength * this.base.numComps, alpha01);
  }
  isDefaultDecode(decode, bpc) {
    if (isDefaultDecodeHelper(decode, 2)) {
      return true;
    }
    if (!Number.isInteger(bpc) || bpc < 1) {
      warn("Bits per component is not correct");
      return true;
    }
    return decode[0] === 0 && decode[1] === (1 << bpc) - 1;
  }
}
class DeviceGrayCS extends ColorSpace {
  constructor() {
    super("DeviceGray", 1);
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    const c = src[srcOffset] * 255;
    dest[destOffset] = dest[destOffset + 1] = dest[destOffset + 2] = c;
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    const scale = 255 / ((1 << bits) - 1);
    let j = srcOffset,
      q = destOffset;
    for (let i = 0; i < count; ++i) {
      const c = scale * src[j++];
      dest[q++] = c;
      dest[q++] = c;
      dest[q++] = c;
      q += alpha01;
    }
  }
  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01);
  }
}
class DeviceRgbCS extends ColorSpace {
  constructor() {
    super("DeviceRGB", 3);
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    dest[destOffset] = src[srcOffset] * 255;
    dest[destOffset + 1] = src[srcOffset + 1] * 255;
    dest[destOffset + 2] = src[srcOffset + 2] * 255;
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    if (bits === 8 && alpha01 === 0) {
      dest.set(src.subarray(srcOffset, srcOffset + count * 3), destOffset);
      return;
    }
    const scale = 255 / ((1 << bits) - 1);
    let j = srcOffset,
      q = destOffset;
    for (let i = 0; i < count; ++i) {
      dest[q++] = scale * src[j++];
      dest[q++] = scale * src[j++];
      dest[q++] = scale * src[j++];
      q += alpha01;
    }
  }
  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01) / 3 | 0;
  }
  isPassthrough(bits) {
    return bits === 8;
  }
}
class DeviceRgbaCS extends ColorSpace {
  constructor() {
    super("DeviceRGBA", 4);
  }
  getOutputLength(inputLength, _alpha01) {
    return inputLength * 4;
  }
  isPassthrough(bits) {
    return bits === 8;
  }
  fillRgb(dest, originalWidth, originalHeight, width, height, actualHeight, bpc, comps, alpha01) {
    if (originalHeight !== height || originalWidth !== width) {
      resizeRgbaImage(comps, dest, originalWidth, originalHeight, width, height, alpha01);
    } else {
      copyRgbaImage(comps, dest, alpha01);
    }
  }
}
class DeviceCmykCS extends ColorSpace {
  constructor() {
    super("DeviceCMYK", 4);
  }
  #toRgb(src, srcOffset, srcScale, dest, destOffset) {
    const c = src[srcOffset] * srcScale;
    const m = src[srcOffset + 1] * srcScale;
    const y = src[srcOffset + 2] * srcScale;
    const k = src[srcOffset + 3] * srcScale;
    dest[destOffset] = 255 + c * (-4.387332384609988 * c + 54.48615194189176 * m + 18.82290502165302 * y + 212.25662451639585 * k + -285.2331026137004) + m * (1.7149763477362134 * m - 5.6096736904047315 * y + -17.873870861415444 * k - 5.497006427196366) + y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) + k * (-21.86122147463605 * k - 189.48180835922747);
    dest[destOffset + 1] = 255 + c * (8.841041422036149 * c + 60.118027045597366 * m + 6.871425592049007 * y + 31.159100130055922 * k + -79.2970844816548) + m * (-15.310361306967817 * m + 17.575251261109482 * y + 131.35250912493976 * k - 190.9453302588951) + y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) + k * (-20.737325471181034 * k - 187.80453709719578);
    dest[destOffset + 2] = 255 + c * (0.8842522430003296 * c + 8.078677503112928 * m + 30.89978309703729 * y - 0.23883238689178934 * k + -14.183576799673286) + m * (10.49593273432072 * m + 63.02378494754052 * y + 50.606957656360734 * k - 112.23884253719248) + y * (0.03296041114873217 * y + 115.60384449646641 * k + -193.58209356861505) + k * (-22.33816807309886 * k - 180.12613974708367);
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    this.#toRgb(src, srcOffset, 1, dest, destOffset);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    const scale = 1 / ((1 << bits) - 1);
    for (let i = 0; i < count; i++) {
      this.#toRgb(src, srcOffset, scale, dest, destOffset);
      srcOffset += 4;
      destOffset += 3 + alpha01;
    }
  }
  getOutputLength(inputLength, alpha01) {
    return inputLength / 4 * (3 + alpha01) | 0;
  }
}
class CalGrayCS extends ColorSpace {
  constructor(whitePoint, blackPoint, gamma) {
    super("CalGray", 1);
    if (!whitePoint) {
      throw new FormatError("WhitePoint missing - required for color space CalGray");
    }
    [this.XW, this.YW, this.ZW] = whitePoint;
    [this.XB, this.YB, this.ZB] = blackPoint || [0, 0, 0];
    this.G = gamma || 1;
    if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
      throw new FormatError(`Invalid WhitePoint components for ${this.name}, no fallback available`);
    }
    if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
      info(`Invalid BlackPoint for ${this.name}, falling back to default.`);
      this.XB = this.YB = this.ZB = 0;
    }
    if (this.XB !== 0 || this.YB !== 0 || this.ZB !== 0) {
      warn(`${this.name}, BlackPoint: XB: ${this.XB}, YB: ${this.YB}, ` + `ZB: ${this.ZB}, only default values are supported.`);
    }
    if (this.G < 1) {
      info(`Invalid Gamma: ${this.G} for ${this.name}, falling back to default.`);
      this.G = 1;
    }
  }
  #toRgb(src, srcOffset, dest, destOffset, scale) {
    const A = src[srcOffset] * scale;
    const AG = A ** this.G;
    const L = this.YW * AG;
    const val = Math.max(295.8 * L ** 0.3333333333333333 - 40.8, 0);
    dest[destOffset] = val;
    dest[destOffset + 1] = val;
    dest[destOffset + 2] = val;
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    this.#toRgb(src, srcOffset, dest, destOffset, 1);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    const scale = 1 / ((1 << bits) - 1);
    for (let i = 0; i < count; ++i) {
      this.#toRgb(src, srcOffset, dest, destOffset, scale);
      srcOffset += 1;
      destOffset += 3 + alpha01;
    }
  }
  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01);
  }
}
class CalRGBCS extends ColorSpace {
  static #BRADFORD_SCALE_MATRIX = new Float32Array([0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]);
  static #BRADFORD_SCALE_INVERSE_MATRIX = new Float32Array([0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867]);
  static #SRGB_D65_XYZ_TO_RGB_MATRIX = new Float32Array([3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252]);
  static #FLAT_WHITEPOINT_MATRIX = new Float32Array([1, 1, 1]);
  static #tempNormalizeMatrix = new Float32Array(3);
  static #tempConvertMatrix1 = new Float32Array(3);
  static #tempConvertMatrix2 = new Float32Array(3);
  static #DECODE_L_CONSTANT = ((8 + 16) / 116) ** 3 / 8.0;
  constructor(whitePoint, blackPoint, gamma, matrix) {
    super("CalRGB", 3);
    if (!whitePoint) {
      throw new FormatError("WhitePoint missing - required for color space CalRGB");
    }
    const [XW, YW, ZW] = this.whitePoint = whitePoint;
    const [XB, YB, ZB] = this.blackPoint = blackPoint || new Float32Array(3);
    [this.GR, this.GG, this.GB] = gamma || new Float32Array([1, 1, 1]);
    [this.MXA, this.MYA, this.MZA, this.MXB, this.MYB, this.MZB, this.MXC, this.MYC, this.MZC] = matrix || new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    if (XW < 0 || ZW < 0 || YW !== 1) {
      throw new FormatError(`Invalid WhitePoint components for ${this.name}, no fallback available`);
    }
    if (XB < 0 || YB < 0 || ZB < 0) {
      info(`Invalid BlackPoint for ${this.name} [${XB}, ${YB}, ${ZB}], ` + "falling back to default.");
      this.blackPoint = new Float32Array(3);
    }
    if (this.GR < 0 || this.GG < 0 || this.GB < 0) {
      info(`Invalid Gamma [${this.GR}, ${this.GG}, ${this.GB}] for ` + `${this.name}, falling back to default.`);
      this.GR = this.GG = this.GB = 1;
    }
  }
  #matrixProduct(a, b, result) {
    result[0] = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    result[1] = a[3] * b[0] + a[4] * b[1] + a[5] * b[2];
    result[2] = a[6] * b[0] + a[7] * b[1] + a[8] * b[2];
  }
  #toFlat(sourceWhitePoint, LMS, result) {
    result[0] = LMS[0] * 1 / sourceWhitePoint[0];
    result[1] = LMS[1] * 1 / sourceWhitePoint[1];
    result[2] = LMS[2] * 1 / sourceWhitePoint[2];
  }
  #toD65(sourceWhitePoint, LMS, result) {
    const D65X = 0.95047;
    const D65Y = 1;
    const D65Z = 1.08883;
    result[0] = LMS[0] * D65X / sourceWhitePoint[0];
    result[1] = LMS[1] * D65Y / sourceWhitePoint[1];
    result[2] = LMS[2] * D65Z / sourceWhitePoint[2];
  }
  #sRGBTransferFunction(color) {
    if (color <= 0.0031308) {
      return MathClamp(12.92 * color, 0, 1);
    }
    if (color >= 0.99554525) {
      return 1;
    }
    return MathClamp((1 + 0.055) * color ** (1 / 2.4) - 0.055, 0, 1);
  }
  #decodeL(L) {
    if (L < 0) {
      return -this.#decodeL(-L);
    }
    if (L > 8.0) {
      return ((L + 16) / 116) ** 3;
    }
    return L * CalRGBCS.#DECODE_L_CONSTANT;
  }
  #compensateBlackPoint(sourceBlackPoint, XYZ_Flat, result) {
    if (sourceBlackPoint[0] === 0 && sourceBlackPoint[1] === 0 && sourceBlackPoint[2] === 0) {
      result[0] = XYZ_Flat[0];
      result[1] = XYZ_Flat[1];
      result[2] = XYZ_Flat[2];
      return;
    }
    const zeroDecodeL = this.#decodeL(0);
    const X_DST = zeroDecodeL;
    const X_SRC = this.#decodeL(sourceBlackPoint[0]);
    const Y_DST = zeroDecodeL;
    const Y_SRC = this.#decodeL(sourceBlackPoint[1]);
    const Z_DST = zeroDecodeL;
    const Z_SRC = this.#decodeL(sourceBlackPoint[2]);
    const X_Scale = (1 - X_DST) / (1 - X_SRC);
    const X_Offset = 1 - X_Scale;
    const Y_Scale = (1 - Y_DST) / (1 - Y_SRC);
    const Y_Offset = 1 - Y_Scale;
    const Z_Scale = (1 - Z_DST) / (1 - Z_SRC);
    const Z_Offset = 1 - Z_Scale;
    result[0] = XYZ_Flat[0] * X_Scale + X_Offset;
    result[1] = XYZ_Flat[1] * Y_Scale + Y_Offset;
    result[2] = XYZ_Flat[2] * Z_Scale + Z_Offset;
  }
  #normalizeWhitePointToFlat(sourceWhitePoint, XYZ_In, result) {
    if (sourceWhitePoint[0] === 1 && sourceWhitePoint[2] === 1) {
      result[0] = XYZ_In[0];
      result[1] = XYZ_In[1];
      result[2] = XYZ_In[2];
      return;
    }
    const LMS = result;
    this.#matrixProduct(CalRGBCS.#BRADFORD_SCALE_MATRIX, XYZ_In, LMS);
    const LMS_Flat = CalRGBCS.#tempNormalizeMatrix;
    this.#toFlat(sourceWhitePoint, LMS, LMS_Flat);
    this.#matrixProduct(CalRGBCS.#BRADFORD_SCALE_INVERSE_MATRIX, LMS_Flat, result);
  }
  #normalizeWhitePointToD65(sourceWhitePoint, XYZ_In, result) {
    const LMS = result;
    this.#matrixProduct(CalRGBCS.#BRADFORD_SCALE_MATRIX, XYZ_In, LMS);
    const LMS_D65 = CalRGBCS.#tempNormalizeMatrix;
    this.#toD65(sourceWhitePoint, LMS, LMS_D65);
    this.#matrixProduct(CalRGBCS.#BRADFORD_SCALE_INVERSE_MATRIX, LMS_D65, result);
  }
  #toRgb(src, srcOffset, dest, destOffset, scale) {
    const A = MathClamp(src[srcOffset] * scale, 0, 1);
    const B = MathClamp(src[srcOffset + 1] * scale, 0, 1);
    const C = MathClamp(src[srcOffset + 2] * scale, 0, 1);
    const AGR = A === 1 ? 1 : A ** this.GR;
    const BGG = B === 1 ? 1 : B ** this.GG;
    const CGB = C === 1 ? 1 : C ** this.GB;
    const X = this.MXA * AGR + this.MXB * BGG + this.MXC * CGB;
    const Y = this.MYA * AGR + this.MYB * BGG + this.MYC * CGB;
    const Z = this.MZA * AGR + this.MZB * BGG + this.MZC * CGB;
    const XYZ = CalRGBCS.#tempConvertMatrix1;
    XYZ[0] = X;
    XYZ[1] = Y;
    XYZ[2] = Z;
    const XYZ_Flat = CalRGBCS.#tempConvertMatrix2;
    this.#normalizeWhitePointToFlat(this.whitePoint, XYZ, XYZ_Flat);
    const XYZ_Black = CalRGBCS.#tempConvertMatrix1;
    this.#compensateBlackPoint(this.blackPoint, XYZ_Flat, XYZ_Black);
    const XYZ_D65 = CalRGBCS.#tempConvertMatrix2;
    this.#normalizeWhitePointToD65(CalRGBCS.#FLAT_WHITEPOINT_MATRIX, XYZ_Black, XYZ_D65);
    const SRGB = CalRGBCS.#tempConvertMatrix1;
    this.#matrixProduct(CalRGBCS.#SRGB_D65_XYZ_TO_RGB_MATRIX, XYZ_D65, SRGB);
    dest[destOffset] = this.#sRGBTransferFunction(SRGB[0]) * 255;
    dest[destOffset + 1] = this.#sRGBTransferFunction(SRGB[1]) * 255;
    dest[destOffset + 2] = this.#sRGBTransferFunction(SRGB[2]) * 255;
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    this.#toRgb(src, srcOffset, dest, destOffset, 1);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    const scale = 1 / ((1 << bits) - 1);
    for (let i = 0; i < count; ++i) {
      this.#toRgb(src, srcOffset, dest, destOffset, scale);
      srcOffset += 3;
      destOffset += 3 + alpha01;
    }
  }
  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01) / 3 | 0;
  }
}
class LabCS extends ColorSpace {
  constructor(whitePoint, blackPoint, range) {
    super("Lab", 3);
    if (!whitePoint) {
      throw new FormatError("WhitePoint missing - required for color space Lab");
    }
    [this.XW, this.YW, this.ZW] = whitePoint;
    [this.amin, this.amax, this.bmin, this.bmax] = range || [-100, 100, -100, 100];
    [this.XB, this.YB, this.ZB] = blackPoint || [0, 0, 0];
    if (this.XW < 0 || this.ZW < 0 || this.YW !== 1) {
      throw new FormatError("Invalid WhitePoint components, no fallback available");
    }
    if (this.XB < 0 || this.YB < 0 || this.ZB < 0) {
      info("Invalid BlackPoint, falling back to default");
      this.XB = this.YB = this.ZB = 0;
    }
    if (this.amin > this.amax || this.bmin > this.bmax) {
      info("Invalid Range, falling back to defaults");
      this.amin = -100;
      this.amax = 100;
      this.bmin = -100;
      this.bmax = 100;
    }
  }
  #fn_g(x) {
    return x >= 6 / 29 ? x ** 3 : 108 / 841 * (x - 4 / 29);
  }
  #decode(value, high1, low2, high2) {
    return low2 + value * (high2 - low2) / high1;
  }
  #toRgb(src, srcOffset, maxVal, dest, destOffset) {
    let Ls = src[srcOffset];
    let as = src[srcOffset + 1];
    let bs = src[srcOffset + 2];
    if (maxVal !== false) {
      Ls = this.#decode(Ls, maxVal, 0, 100);
      as = this.#decode(as, maxVal, this.amin, this.amax);
      bs = this.#decode(bs, maxVal, this.bmin, this.bmax);
    }
    if (as > this.amax) {
      as = this.amax;
    } else if (as < this.amin) {
      as = this.amin;
    }
    if (bs > this.bmax) {
      bs = this.bmax;
    } else if (bs < this.bmin) {
      bs = this.bmin;
    }
    const M = (Ls + 16) / 116;
    const L = M + as / 500;
    const N = M - bs / 200;
    const X = this.XW * this.#fn_g(L);
    const Y = this.YW * this.#fn_g(M);
    const Z = this.ZW * this.#fn_g(N);
    let r, g, b;
    if (this.ZW < 1) {
      r = X * 3.1339 + Y * -1.617 + Z * -0.4906;
      g = X * -0.9785 + Y * 1.916 + Z * 0.0333;
      b = X * 0.072 + Y * -0.229 + Z * 1.4057;
    } else {
      r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
      g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
      b = X * 0.0557 + Y * -0.204 + Z * 1.057;
    }
    dest[destOffset] = Math.sqrt(r) * 255;
    dest[destOffset + 1] = Math.sqrt(g) * 255;
    dest[destOffset + 2] = Math.sqrt(b) * 255;
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    this.#toRgb(src, srcOffset, false, dest, destOffset);
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    const maxVal = (1 << bits) - 1;
    for (let i = 0; i < count; i++) {
      this.#toRgb(src, srcOffset, maxVal, dest, destOffset);
      srcOffset += 3;
      destOffset += 3 + alpha01;
    }
  }
  getOutputLength(inputLength, alpha01) {
    return inputLength * (3 + alpha01) / 3 | 0;
  }
  isDefaultDecode(decode, bpc) {
    return true;
  }
  get usesZeroToOneRange() {
    return shadow(this, "usesZeroToOneRange", false);
  }
}

;// ./external/qcms/qcms_utils.js
class QCMS {
  static #memoryArray = null;
  static _memory = null;
  static _mustAddAlpha = false;
  static _destBuffer = null;
  static _destOffset = 0;
  static _destLength = 0;
  static _cssColor = "";
  static _makeHexColor = null;
  static get _memoryArray() {
    const array = this.#memoryArray;
    if (array?.byteLength) {
      return array;
    }
    return this.#memoryArray = new Uint8Array(this._memory.buffer);
  }
}
function copy_result(ptr, len) {
  const {
    _mustAddAlpha,
    _destBuffer,
    _destOffset,
    _destLength,
    _memoryArray
  } = QCMS;
  if (len === _destLength) {
    _destBuffer.set(_memoryArray.subarray(ptr, ptr + len), _destOffset);
    return;
  }
  if (_mustAddAlpha) {
    for (let i = ptr, ii = ptr + len, j = _destOffset; i < ii; i += 3, j += 4) {
      _destBuffer[j] = _memoryArray[i];
      _destBuffer[j + 1] = _memoryArray[i + 1];
      _destBuffer[j + 2] = _memoryArray[i + 2];
      _destBuffer[j + 3] = 255;
    }
  } else {
    for (let i = ptr, ii = ptr + len, j = _destOffset; i < ii; i += 3, j += 4) {
      _destBuffer[j] = _memoryArray[i];
      _destBuffer[j + 1] = _memoryArray[i + 1];
      _destBuffer[j + 2] = _memoryArray[i + 2];
    }
  }
}
function copy_rgb(ptr) {
  const {
    _destBuffer,
    _destOffset,
    _memoryArray
  } = QCMS;
  _destBuffer[_destOffset] = _memoryArray[ptr];
  _destBuffer[_destOffset + 1] = _memoryArray[ptr + 1];
  _destBuffer[_destOffset + 2] = _memoryArray[ptr + 2];
}
function make_cssRGB(ptr) {
  const {
    _memoryArray
  } = QCMS;
  QCMS._cssColor = QCMS._makeHexColor(_memoryArray[ptr], _memoryArray[ptr + 1], _memoryArray[ptr + 2]);
}

;// ./external/qcms/qcms.js

const DataType = Object.freeze({
  RGB8: 0,
  "0": "RGB8",
  RGBA8: 1,
  "1": "RGBA8",
  BGRA8: 2,
  "2": "BGRA8",
  Gray8: 3,
  "3": "Gray8",
  GrayA8: 4,
  "4": "GrayA8",
  CMYK: 5,
  "5": "CMYK"
});
const Intent = Object.freeze({
  Perceptual: 0,
  "0": "Perceptual",
  RelativeColorimetric: 1,
  "1": "RelativeColorimetric",
  Saturation: 2,
  "2": "Saturation",
  AbsoluteColorimetric: 3,
  "3": "AbsoluteColorimetric"
});
function qcms_convert_array(transformer, src) {
  const ptr0 = passArray8ToWasm0(src, wasm.__wbindgen_malloc);
  const len0 = WASM_VECTOR_LEN;
  wasm.qcms_convert_array(transformer, ptr0, len0);
}
function qcms_convert_four(transformer, src1, src2, src3, src4, css) {
  wasm.qcms_convert_four(transformer, src1, src2, src3, src4, css);
}
function qcms_convert_one(transformer, src, css) {
  wasm.qcms_convert_one(transformer, src, css);
}
function qcms_convert_three(transformer, src1, src2, src3, css) {
  wasm.qcms_convert_three(transformer, src1, src2, src3, css);
}
function qcms_drop_transformer(transformer) {
  wasm.qcms_drop_transformer(transformer);
}
function qcms_transformer_from_memory(mem, in_type, intent) {
  const ptr0 = passArray8ToWasm0(mem, wasm.__wbindgen_malloc);
  const len0 = WASM_VECTOR_LEN;
  const ret = wasm.qcms_transformer_from_memory(ptr0, len0, in_type, intent);
  return ret >>> 0;
}
function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg___wbindgen_throw_6b64449b9b9ed33c: function (arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_copy_result_0d15f3bf9d9012ae: function (arg0, arg1) {
      copy_result(arg0 >>> 0, arg1 >>> 0);
    },
    __wbg_copy_rgb_0106d9d9464fce43: function (arg0) {
      copy_rgb(arg0 >>> 0);
    },
    __wbg_make_cssRGB_8e24b34f71f5363e: function (arg0) {
      make_cssRGB(arg0 >>> 0);
    },
    __wbindgen_init_externref_table: function () {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, undefined);
      table.set(offset + 0, undefined);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    }
  };
  return {
    __proto__: null,
    "./qcms_bg.js": import0
  };
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return decodeText(ptr, len);
}
let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
let cachedTextDecoder = new TextDecoder('utf-8', {
  ignoreBOM: true,
  fatal: true
});
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder('utf-8', {
      ignoreBOM: true,
      fatal: true
    });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
let WASM_VECTOR_LEN = 0;
let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  wasmModule = module;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}
async function __wbg_load(module, imports) {
  if (typeof Response === 'function' && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        const validResponse = module.ok && expectedResponseType(module.type);
        if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return {
        instance,
        module
      };
    } else {
      return instance;
    }
  }
  function expectedResponseType(type) {
    switch (type) {
      case 'basic':
      case 'cors':
      case 'default':
        return true;
    }
    return false;
  }
}
function initSync(module) {
  if (wasm !== undefined) return wasm;
  if (module !== undefined) {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      ({
        module
      } = module);
    } else {
      console.warn('using deprecated parameters for `initSync()`; pass a single object instead');
    }
  }
  const imports = __wbg_get_imports();
  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }
  const instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance, module);
}
async function __wbg_init(module_or_path) {
  if (wasm !== undefined) return wasm;
  if (module_or_path !== undefined) {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({
        module_or_path
      } = module_or_path);
    } else {
      console.warn('using deprecated parameters for the initialization function; pass a single object instead');
    }
  }
  const imports = __wbg_get_imports();
  if (typeof module_or_path === 'string' || typeof Request === 'function' && module_or_path instanceof Request || typeof URL === 'function' && module_or_path instanceof URL) {
    module_or_path = fetch(module_or_path);
  }
  const {
    instance,
    module
  } = await __wbg_load(await module_or_path, imports);
  return __wbg_finalize_init(instance, module);
}

;// ./src/core/icc_colorspace.js




function fetchSync(url) {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.responseType = "arraybuffer";
  xhr.send(null);
  return xhr.response;
}
class IccColorSpace extends ColorSpace {
  #transformer;
  #convertPixel;
  static #useWasm = true;
  static #wasmUrl = null;
  static #finalizer = null;
  constructor(iccProfile, name, numComps) {
    if (!IccColorSpace.isUsable) {
      throw new Error("No ICC color space support");
    }
    super(name, numComps);
    let inType;
    switch (numComps) {
      case 1:
        inType = DataType.Gray8;
        this.#convertPixel = (src, srcOffset, css) => qcms_convert_one(this.#transformer, src[srcOffset] * 255, css);
        break;
      case 3:
        inType = DataType.RGB8;
        this.#convertPixel = (src, srcOffset, css) => qcms_convert_three(this.#transformer, src[srcOffset] * 255, src[srcOffset + 1] * 255, src[srcOffset + 2] * 255, css);
        break;
      case 4:
        inType = DataType.CMYK;
        this.#convertPixel = (src, srcOffset, css) => qcms_convert_four(this.#transformer, src[srcOffset] * 255, src[srcOffset + 1] * 255, src[srcOffset + 2] * 255, src[srcOffset + 3] * 255, css);
        break;
      default:
        throw new Error(`Unsupported number of components: ${numComps}`);
    }
    this.#transformer = qcms_transformer_from_memory(iccProfile, inType, Intent.Perceptual);
    if (!this.#transformer) {
      throw new Error("Failed to create ICC color space");
    }
    IccColorSpace.#finalizer ||= new FinalizationRegistry(transformer => {
      qcms_drop_transformer(transformer);
    });
    IccColorSpace.#finalizer.register(this, this.#transformer);
  }
  getRgbHex(src, srcOffset) {
    this.#convertPixel(src, srcOffset, true);
    return QCMS._cssColor;
  }
  getRgbItem(src, srcOffset, dest, destOffset) {
    QCMS._destBuffer = dest;
    QCMS._destOffset = destOffset;
    QCMS._destLength = 3;
    this.#convertPixel(src, srcOffset, false);
    QCMS._destBuffer = null;
  }
  getRgbBuffer(src, srcOffset, count, dest, destOffset, bits, alpha01) {
    src = src.subarray(srcOffset, srcOffset + count * this.numComps);
    if (bits !== 8) {
      const scale = 255 / ((1 << bits) - 1);
      for (let i = 0, ii = src.length; i < ii; i++) {
        src[i] *= scale;
      }
    }
    QCMS._mustAddAlpha = alpha01 && dest.buffer === src.buffer;
    QCMS._destBuffer = dest;
    QCMS._destOffset = destOffset;
    QCMS._destLength = count * (3 + alpha01);
    qcms_convert_array(this.#transformer, src);
    QCMS._mustAddAlpha = false;
    QCMS._destBuffer = null;
  }
  getOutputLength(inputLength, alpha01) {
    return inputLength / this.numComps * (3 + alpha01) | 0;
  }
  static setOptions({
    useWasm,
    useWorkerFetch,
    wasmUrl
  }) {
    if (!useWorkerFetch) {
      this.#useWasm = false;
      return;
    }
    this.#useWasm = useWasm;
    this.#wasmUrl = wasmUrl;
  }
  static get isUsable() {
    let isUsable = false;
    if (this.#useWasm) {
      if (this.#wasmUrl) {
        try {
          this._module = initSync({
            module: fetchSync(`${this.#wasmUrl}qcms_bg.wasm`)
          });
          isUsable = !!this._module;
          QCMS._memory = this._module.memory;
          QCMS._makeHexColor = Util.makeHexColor.bind(Util);
        } catch (e) {
          warn(`ICCBased color space: "${e}".`);
        }
      } else {
        warn("No ICC color space support due to missing `wasmUrl` API option");
      }
    }
    return shadow(this, "isUsable", isUsable);
  }
}
class CmykICCBasedCS extends IccColorSpace {
  static #iccUrl;
  constructor() {
    const iccProfile = new Uint8Array(fetchSync(`${CmykICCBasedCS.#iccUrl}CGATS001Compat-v2-micro.icc`));
    super(iccProfile, "DeviceCMYK", 4);
  }
  static setOptions({
    iccUrl
  }) {
    this.#iccUrl = iccUrl;
  }
  static get isUsable() {
    let isUsable = false;
    if (IccColorSpace.isUsable) {
      if (this.#iccUrl) {
        isUsable = true;
      } else {
        warn("No CMYK ICC profile support due to missing `iccUrl` API option");
      }
    }
    return shadow(this, "isUsable", isUsable);
  }
}

;// ./src/core/colorspace_utils.js






class ColorSpaceUtils {
  static parse({
    cs,
    xref,
    resources = null,
    pdfFunctionFactory,
    globalColorSpaceCache,
    localColorSpaceCache,
    asyncIfNotCached = false
  }) {
    const options = {
      xref,
      resources,
      pdfFunctionFactory,
      globalColorSpaceCache,
      localColorSpaceCache
    };
    let csName, csRef, parsedCS;
    if (cs instanceof Ref) {
      csRef = cs;
      const cachedCS = globalColorSpaceCache.getByRef(csRef) || localColorSpaceCache.getByRef(csRef);
      if (cachedCS) {
        return cachedCS;
      }
      cs = xref.fetch(cs);
    }
    if (cs instanceof Name) {
      csName = cs.name;
      const cachedCS = localColorSpaceCache.getByName(csName);
      if (cachedCS) {
        return cachedCS;
      }
    }
    try {
      parsedCS = this.#parse(cs, options);
    } catch (ex) {
      if (asyncIfNotCached && !(ex instanceof MissingDataException)) {
        return Promise.reject(ex);
      }
      throw ex;
    }
    if (csName || csRef) {
      localColorSpaceCache.set(csName, csRef, parsedCS);
      if (csRef) {
        globalColorSpaceCache.set(null, csRef, parsedCS);
      }
    }
    return asyncIfNotCached ? Promise.resolve(parsedCS) : parsedCS;
  }
  static #subParse(cs, options) {
    const {
      globalColorSpaceCache
    } = options;
    let csRef;
    if (cs instanceof Ref) {
      csRef = cs;
      const cachedCS = globalColorSpaceCache.getByRef(csRef);
      if (cachedCS) {
        return cachedCS;
      }
    }
    const parsedCS = this.#parse(cs, options);
    if (csRef) {
      globalColorSpaceCache.set(null, csRef, parsedCS);
    }
    return parsedCS;
  }
  static #parse(cs, options) {
    const {
      xref,
      resources,
      pdfFunctionFactory,
      globalColorSpaceCache
    } = options;
    cs = xref.fetchIfRef(cs);
    if (cs instanceof Name) {
      switch (cs.name) {
        case "G":
        case "DeviceGray":
          return this.gray;
        case "RGB":
        case "DeviceRGB":
          return this.rgb;
        case "DeviceRGBA":
          return this.rgba;
        case "CMYK":
        case "DeviceCMYK":
          return this.cmyk;
        case "Pattern":
          return new PatternCS(null);
        default:
          if (resources instanceof Dict) {
            const colorSpaces = resources.get("ColorSpace");
            if (colorSpaces instanceof Dict) {
              const resourcesCS = colorSpaces.get(cs.name);
              if (resourcesCS) {
                if (resourcesCS instanceof Name) {
                  return this.#parse(resourcesCS, options);
                }
                cs = resourcesCS;
                break;
              }
            }
          }
          warn(`Unrecognized ColorSpace: ${cs.name}`);
          return this.gray;
      }
    }
    if (Array.isArray(cs)) {
      const mode = xref.fetchIfRef(cs[0]).name;
      let params, numComps, baseCS, whitePoint, blackPoint, gamma;
      switch (mode) {
        case "G":
        case "DeviceGray":
          return this.gray;
        case "RGB":
        case "DeviceRGB":
          return this.rgb;
        case "CMYK":
        case "DeviceCMYK":
          return this.cmyk;
        case "CalGray":
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray("WhitePoint");
          blackPoint = params.getArray("BlackPoint");
          gamma = params.get("Gamma");
          return new CalGrayCS(whitePoint, blackPoint, gamma);
        case "CalRGB":
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray("WhitePoint");
          blackPoint = params.getArray("BlackPoint");
          gamma = params.getArray("Gamma");
          const matrix = params.getArray("Matrix");
          return new CalRGBCS(whitePoint, blackPoint, gamma, matrix);
        case "ICCBased":
          const isRef = cs[1] instanceof Ref;
          if (isRef) {
            const cachedCS = globalColorSpaceCache.getByRef(cs[1]);
            if (cachedCS) {
              return cachedCS;
            }
          }
          const stream = xref.fetchIfRef(cs[1]);
          const dict = stream.dict;
          numComps = dict.get("N");
          if (IccColorSpace.isUsable) {
            try {
              const iccCS = new IccColorSpace(stream.getBytes(), "ICCBased", numComps);
              if (isRef) {
                globalColorSpaceCache.set(null, cs[1], iccCS);
              }
              return iccCS;
            } catch (ex) {
              if (ex instanceof MissingDataException) {
                throw ex;
              }
              warn(`ICCBased color space (${cs[1]}): "${ex}".`);
            }
          }
          const altRaw = dict.getRaw("Alternate");
          if (altRaw) {
            const altCS = this.#subParse(altRaw, options);
            if (altCS.numComps === numComps) {
              return altCS;
            }
            warn("ICCBased color space: Ignoring incorrect /Alternate entry.");
          }
          if (numComps === 1) {
            return this.gray;
          } else if (numComps === 3) {
            return this.rgb;
          } else if (numComps === 4) {
            return this.cmyk;
          }
          break;
        case "Pattern":
          baseCS = cs[1] || null;
          if (baseCS) {
            baseCS = this.#subParse(baseCS, options);
          }
          return new PatternCS(baseCS);
        case "I":
        case "Indexed":
          baseCS = this.#subParse(cs[1], options);
          const hiVal = MathClamp(xref.fetchIfRef(cs[2]), 0, 255);
          const lookup = xref.fetchIfRef(cs[3]);
          return new IndexedCS(baseCS, hiVal, lookup);
        case "Separation":
        case "DeviceN":
          const name = xref.fetchIfRef(cs[1]);
          numComps = Array.isArray(name) ? name.length : 1;
          baseCS = this.#subParse(cs[2], options);
          const tintFn = pdfFunctionFactory.create(cs[3]);
          return new AlternateCS(numComps, baseCS, tintFn);
        case "Lab":
          params = xref.fetchIfRef(cs[1]);
          whitePoint = params.getArray("WhitePoint");
          blackPoint = params.getArray("BlackPoint");
          const range = params.getArray("Range");
          return new LabCS(whitePoint, blackPoint, range);
        default:
          warn(`Unimplemented ColorSpace object: ${mode}`);
          return this.gray;
      }
    }
    warn(`Unrecognized ColorSpace object: ${cs}`);
    return this.gray;
  }
  static get gray() {
    return shadow(this, "gray", new DeviceGrayCS());
  }
  static get rgb() {
    return shadow(this, "rgb", new DeviceRgbCS());
  }
  static get rgba() {
    return shadow(this, "rgba", new DeviceRgbaCS());
  }
  static get cmyk() {
    if (CmykICCBasedCS.isUsable) {
      try {
        return shadow(this, "cmyk", new CmykICCBasedCS());
      } catch {
        warn("CMYK fallback: DeviceCMYK");
      }
    }
    return shadow(this, "cmyk", new DeviceCmykCS());
  }
}

;// ./src/shared/image_utils.js
/* unused harmony import specifier */ var image_utils_ImageKind;
/* unused harmony import specifier */ var image_utils_FeatureTest;

function convertToRGBA(params) {
  switch (params.kind) {
    case image_utils_ImageKind.GRAYSCALE_1BPP:
      return convertBlackAndWhiteToRGBA(params);
    case image_utils_ImageKind.RGB_24BPP:
      return convertRGBToRGBA(params);
  }
  return null;
}
function convertBlackAndWhiteToRGBA({
  src,
  srcPos = 0,
  dest,
  width,
  height,
  nonBlackColor = 0xffffffff,
  inverseDecode = false
}) {
  const black = image_utils_FeatureTest.isLittleEndian ? 0xff000000 : 0x000000ff;
  const [zeroMapping, oneMapping] = inverseDecode ? [nonBlackColor, black] : [black, nonBlackColor];
  const widthInSource = width >> 3;
  const widthRemainder = width & 7;
  const xorMask = zeroMapping ^ oneMapping;
  const srcLength = src.length;
  dest = new Uint32Array(dest.buffer);
  let destPos = 0;
  for (let i = 0; i < height; ++i) {
    for (const max = srcPos + widthInSource; srcPos < max; ++srcPos, destPos += 8) {
      const elem = src[srcPos];
      dest[destPos] = zeroMapping ^ -(elem >> 7 & 1) & xorMask;
      dest[destPos + 1] = zeroMapping ^ -(elem >> 6 & 1) & xorMask;
      dest[destPos + 2] = zeroMapping ^ -(elem >> 5 & 1) & xorMask;
      dest[destPos + 3] = zeroMapping ^ -(elem >> 4 & 1) & xorMask;
      dest[destPos + 4] = zeroMapping ^ -(elem >> 3 & 1) & xorMask;
      dest[destPos + 5] = zeroMapping ^ -(elem >> 2 & 1) & xorMask;
      dest[destPos + 6] = zeroMapping ^ -(elem >> 1 & 1) & xorMask;
      dest[destPos + 7] = zeroMapping ^ -(elem & 1) & xorMask;
    }
    if (widthRemainder === 0) {
      continue;
    }
    const elem = srcPos < srcLength ? src[srcPos++] : 255;
    for (let j = 0; j < widthRemainder; ++j, ++destPos) {
      dest[destPos] = zeroMapping ^ -(elem >> 7 - j & 1) & xorMask;
    }
  }
  return {
    srcPos,
    destPos
  };
}
function convertRGBToRGBA({
  src,
  srcPos = 0,
  dest,
  destPos = 0,
  width,
  height
}) {
  let i = 0;
  const len = width * height * 3;
  const len32 = len >> 2;
  const src32 = new Uint32Array(src.buffer, srcPos, len32);
  const alphaMask = image_utils_FeatureTest.isLittleEndian ? 0xff000000 : 0xff;
  if (image_utils_FeatureTest.isLittleEndian) {
    for (; i < len32 - 2; i += 3, destPos += 4) {
      const s1 = src32[i],
        s2 = src32[i + 1],
        s3 = src32[i + 2];
      dest[destPos] = s1 | alphaMask;
      dest[destPos + 1] = s1 >>> 24 | s2 << 8 | alphaMask;
      dest[destPos + 2] = s2 >>> 16 | s3 << 16 | alphaMask;
      dest[destPos + 3] = s3 >>> 8 | alphaMask;
    }
    for (let j = i * 4, jj = srcPos + len; j < jj; j += 3) {
      dest[destPos++] = src[j] | src[j + 1] << 8 | src[j + 2] << 16 | alphaMask;
    }
  } else {
    for (; i < len32 - 2; i += 3, destPos += 4) {
      const s1 = src32[i],
        s2 = src32[i + 1],
        s3 = src32[i + 2];
      dest[destPos] = s1 | alphaMask;
      dest[destPos + 1] = s1 << 24 | s2 >>> 8 | alphaMask;
      dest[destPos + 2] = s2 << 16 | s3 >>> 16 | alphaMask;
      dest[destPos + 3] = s3 << 8 | alphaMask;
    }
    for (let j = i * 4, jj = srcPos + len; j < jj; j += 3) {
      dest[destPos++] = src[j] << 24 | src[j + 1] << 16 | src[j + 2] << 8 | alphaMask;
    }
  }
  return {
    srcPos: srcPos + len,
    destPos
  };
}
function grayToRGBA(src, dest) {
  if (FeatureTest.isLittleEndian) {
    for (let i = 0, ii = src.length; i < ii; i++) {
      dest[i] = src[i] * 0x10101 | 0xff000000;
    }
  } else {
    for (let i = 0, ii = src.length; i < ii; i++) {
      dest[i] = src[i] * 0x1010100 | 0x000000ff;
    }
  }
}

;// ./src/core/jpg.js




class JpegError extends BaseException {
  constructor(msg) {
    super(msg, "JpegError");
  }
}
class DNLMarkerError extends BaseException {
  constructor(message, scanLines) {
    super(message, "DNLMarkerError");
    this.scanLines = scanLines;
  }
}
class EOIMarkerError extends BaseException {
  constructor(msg) {
    super(msg, "EOIMarkerError");
  }
}
const dctZigZag = new Uint8Array([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);
const dctCos1 = 4017;
const dctSin1 = 799;
const dctCos3 = 3406;
const dctSin3 = 2276;
const dctCos6 = 1567;
const dctSin6 = 3784;
const dctSqrt2 = 5793;
const dctSqrt1d2 = 2896;
function buildHuffmanTable(codeLengths, values) {
  let k = 0,
    i,
    j,
    length = 16;
  while (length > 0 && !codeLengths[length - 1]) {
    length--;
  }
  const code = [{
    children: [],
    index: 0
  }];
  let p = code[0],
    q;
  for (i = 0; i < length; i++) {
    for (j = 0; j < codeLengths[i]; j++) {
      p = code.pop();
      p.children[p.index] = values[k];
      while (p.index > 0) {
        p = code.pop();
      }
      p.index++;
      code.push(p);
      while (code.length <= i) {
        code.push(q = {
          children: [],
          index: 0
        });
        p.children[p.index] = q.children;
        p = q;
      }
      k++;
    }
    if (i + 1 < length) {
      code.push(q = {
        children: [],
        index: 0
      });
      p.children[p.index] = q.children;
      p = q;
    }
  }
  return code[0].children;
}
function getBlockBufferOffset(component, row, col) {
  return 64 * ((component.blocksPerLine + 1) * row + col);
}
function decodeScan(data, view, offset, frame, components, resetInterval, spectralStart, spectralEnd, successivePrev, successive, parseDNLMarker = false) {
  const mcusPerLine = frame.mcusPerLine;
  const progressive = frame.progressive;
  const startOffset = offset;
  let bitsData = 0,
    bitsCount = 0;
  function readBit() {
    if (bitsCount > 0) {
      bitsCount--;
      return bitsData >> bitsCount & 1;
    }
    bitsData = data[offset++];
    if (bitsData === 0xff) {
      const nextByte = data[offset++];
      if (nextByte) {
        if (nextByte === 0xdc && parseDNLMarker) {
          offset += 2;
          const scanLines = view.getUint16(offset);
          offset += 2;
          if (scanLines > 0 && scanLines !== frame.scanLines) {
            throw new DNLMarkerError("Found DNL marker (0xFFDC) while parsing scan data", scanLines);
          }
        } else if (nextByte === 0xd9) {
          if (parseDNLMarker) {
            const maybeScanLines = blockRow * (frame.precision === 8 ? 8 : 0);
            if (maybeScanLines > 0 && Math.round(frame.scanLines / maybeScanLines) >= 5) {
              throw new DNLMarkerError("Found EOI marker (0xFFD9) while parsing scan data, " + "possibly caused by incorrect `scanLines` parameter", maybeScanLines);
            }
          }
          throw new EOIMarkerError("Found EOI marker (0xFFD9) while parsing scan data");
        }
        throw new JpegError(`unexpected marker ${(bitsData << 8 | nextByte).toString(16)}`);
      }
    }
    bitsCount = 7;
    return bitsData >>> 7;
  }
  function decodeHuffman(tree) {
    let node = tree;
    while (true) {
      node = node[readBit()];
      switch (typeof node) {
        case "number":
          return node;
        case "object":
          continue;
      }
      throw new JpegError("invalid huffman sequence");
    }
  }
  function receive(length) {
    let n = 0;
    while (length > 0) {
      n = n << 1 | readBit();
      length--;
    }
    return n;
  }
  function receiveAndExtend(length) {
    if (length === 1) {
      return readBit() === 1 ? 1 : -1;
    }
    const n = receive(length);
    if (n >= 1 << length - 1) {
      return n;
    }
    return n + (-1 << length) + 1;
  }
  function decodeBaseline(component, blockOffset) {
    const t = decodeHuffman(component.huffmanTableDC);
    const diff = t === 0 ? 0 : receiveAndExtend(t);
    component.blockData[blockOffset] = component.pred += diff;
    let k = 1;
    while (k < 64) {
      const rs = decodeHuffman(component.huffmanTableAC);
      const s = rs & 15,
        r = rs >> 4;
      if (s === 0) {
        if (r < 15) {
          break;
        }
        k += 16;
        continue;
      }
      k += r;
      const z = dctZigZag[k];
      component.blockData[blockOffset + z] = receiveAndExtend(s);
      k++;
    }
  }
  function decodeDCFirst(component, blockOffset) {
    const t = decodeHuffman(component.huffmanTableDC);
    const diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
    component.blockData[blockOffset] = component.pred += diff;
  }
  function decodeDCSuccessive(component, blockOffset) {
    component.blockData[blockOffset] |= readBit() << successive;
  }
  let eobrun = 0;
  function decodeACFirst(component, blockOffset) {
    if (eobrun > 0) {
      eobrun--;
      return;
    }
    let k = spectralStart;
    const e = spectralEnd;
    while (k <= e) {
      const rs = decodeHuffman(component.huffmanTableAC);
      const s = rs & 15,
        r = rs >> 4;
      if (s === 0) {
        if (r < 15) {
          eobrun = receive(r) + (1 << r) - 1;
          break;
        }
        k += 16;
        continue;
      }
      k += r;
      const z = dctZigZag[k];
      component.blockData[blockOffset + z] = receiveAndExtend(s) * (1 << successive);
      k++;
    }
  }
  let successiveACState = 0,
    successiveACNextValue;
  function decodeACSuccessive(component, blockOffset) {
    let k = spectralStart;
    const e = spectralEnd;
    let r = 0;
    let s;
    let rs;
    while (k <= e) {
      const offsetZ = blockOffset + dctZigZag[k];
      const sign = component.blockData[offsetZ] < 0 ? -1 : 1;
      switch (successiveACState) {
        case 0:
          rs = decodeHuffman(component.huffmanTableAC);
          s = rs & 15;
          r = rs >> 4;
          if (s === 0) {
            if (r < 15) {
              eobrun = receive(r) + (1 << r);
              successiveACState = 4;
            } else {
              r = 16;
              successiveACState = 1;
            }
          } else {
            if (s !== 1) {
              throw new JpegError("invalid ACn encoding");
            }
            successiveACNextValue = receiveAndExtend(s);
            successiveACState = r ? 2 : 3;
          }
          continue;
        case 1:
        case 2:
          if (component.blockData[offsetZ]) {
            component.blockData[offsetZ] += sign * (readBit() << successive);
          } else {
            r--;
            if (r === 0) {
              successiveACState = successiveACState === 2 ? 3 : 0;
            }
          }
          break;
        case 3:
          if (component.blockData[offsetZ]) {
            component.blockData[offsetZ] += sign * (readBit() << successive);
          } else {
            component.blockData[offsetZ] = successiveACNextValue << successive;
            successiveACState = 0;
          }
          break;
        case 4:
          if (component.blockData[offsetZ]) {
            component.blockData[offsetZ] += sign * (readBit() << successive);
          }
          break;
      }
      k++;
    }
    if (successiveACState === 4) {
      eobrun--;
      if (eobrun === 0) {
        successiveACState = 0;
      }
    }
  }
  let blockRow = 0;
  function decodeMcu(component, decode, mcu, row, col) {
    const mcuRow = mcu / mcusPerLine | 0;
    const mcuCol = mcu % mcusPerLine;
    blockRow = mcuRow * component.v + row;
    const blockCol = mcuCol * component.h + col;
    const blockOffset = getBlockBufferOffset(component, blockRow, blockCol);
    decode(component, blockOffset);
  }
  function decodeBlock(component, decode, mcu) {
    blockRow = mcu / component.blocksPerLine | 0;
    const blockCol = mcu % component.blocksPerLine;
    const blockOffset = getBlockBufferOffset(component, blockRow, blockCol);
    decode(component, blockOffset);
  }
  const componentsLength = components.length;
  let component, i, j, k, n;
  let decodeFn;
  if (progressive) {
    if (spectralStart === 0) {
      decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
    } else {
      decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
    }
  } else {
    decodeFn = decodeBaseline;
  }
  let mcu = 0,
    fileMarker;
  const mcuExpected = componentsLength === 1 ? components[0].blocksPerLine * components[0].blocksPerColumn : mcusPerLine * frame.mcusPerColumn;
  let h, v;
  while (mcu <= mcuExpected) {
    const mcuToRead = resetInterval ? Math.min(mcuExpected - mcu, resetInterval) : mcuExpected;
    if (mcuToRead > 0) {
      for (i = 0; i < componentsLength; i++) {
        components[i].pred = 0;
      }
      eobrun = 0;
      if (componentsLength === 1) {
        component = components[0];
        for (n = 0; n < mcuToRead; n++) {
          decodeBlock(component, decodeFn, mcu);
          mcu++;
        }
      } else {
        for (n = 0; n < mcuToRead; n++) {
          for (i = 0; i < componentsLength; i++) {
            component = components[i];
            h = component.h;
            v = component.v;
            for (j = 0; j < v; j++) {
              for (k = 0; k < h; k++) {
                decodeMcu(component, decodeFn, mcu, j, k);
              }
            }
          }
          mcu++;
        }
      }
    }
    bitsCount = 0;
    fileMarker = findNextFileMarker(data, view, offset);
    if (!fileMarker) {
      break;
    }
    if (fileMarker.invalid) {
      const partialMsg = mcuToRead > 0 ? "unexpected" : "excessive";
      warn(`decodeScan - ${partialMsg} MCU data, current marker is: ${fileMarker.invalid}`);
      offset = fileMarker.offset;
    }
    if (fileMarker.marker >= 0xffd0 && fileMarker.marker <= 0xffd7) {
      offset += 2;
    } else {
      break;
    }
  }
  return offset - startOffset;
}
function quantizeAndInverse(component, blockBufferOffset, p) {
  const qt = component.quantizationTable,
    blockData = component.blockData;
  let v0, v1, v2, v3, v4, v5, v6, v7;
  let p0, p1, p2, p3, p4, p5, p6, p7;
  let t;
  if (!qt) {
    throw new JpegError("missing required Quantization Table.");
  }
  for (let row = 0; row < 64; row += 8) {
    p0 = blockData[blockBufferOffset + row];
    p1 = blockData[blockBufferOffset + row + 1];
    p2 = blockData[blockBufferOffset + row + 2];
    p3 = blockData[blockBufferOffset + row + 3];
    p4 = blockData[blockBufferOffset + row + 4];
    p5 = blockData[blockBufferOffset + row + 5];
    p6 = blockData[blockBufferOffset + row + 6];
    p7 = blockData[blockBufferOffset + row + 7];
    p0 *= qt[row];
    if ((p1 | p2 | p3 | p4 | p5 | p6 | p7) === 0) {
      t = dctSqrt2 * p0 + 512 >> 10;
      p[row] = t;
      p[row + 1] = t;
      p[row + 2] = t;
      p[row + 3] = t;
      p[row + 4] = t;
      p[row + 5] = t;
      p[row + 6] = t;
      p[row + 7] = t;
      continue;
    }
    p1 *= qt[row + 1];
    p2 *= qt[row + 2];
    p3 *= qt[row + 3];
    p4 *= qt[row + 4];
    p5 *= qt[row + 5];
    p6 *= qt[row + 6];
    p7 *= qt[row + 7];
    v0 = dctSqrt2 * p0 + 128 >> 8;
    v1 = dctSqrt2 * p4 + 128 >> 8;
    v2 = p2;
    v3 = p6;
    v4 = dctSqrt1d2 * (p1 - p7) + 128 >> 8;
    v7 = dctSqrt1d2 * (p1 + p7) + 128 >> 8;
    v5 = p3 << 4;
    v6 = p5 << 4;
    v0 = v0 + v1 + 1 >> 1;
    v1 = v0 - v1;
    t = v2 * dctSin6 + v3 * dctCos6 + 128 >> 8;
    v2 = v2 * dctCos6 - v3 * dctSin6 + 128 >> 8;
    v3 = t;
    v4 = v4 + v6 + 1 >> 1;
    v6 = v4 - v6;
    v7 = v7 + v5 + 1 >> 1;
    v5 = v7 - v5;
    v0 = v0 + v3 + 1 >> 1;
    v3 = v0 - v3;
    v1 = v1 + v2 + 1 >> 1;
    v2 = v1 - v2;
    t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
    v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
    v7 = t;
    t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
    v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
    v6 = t;
    p[row] = v0 + v7;
    p[row + 7] = v0 - v7;
    p[row + 1] = v1 + v6;
    p[row + 6] = v1 - v6;
    p[row + 2] = v2 + v5;
    p[row + 5] = v2 - v5;
    p[row + 3] = v3 + v4;
    p[row + 4] = v3 - v4;
  }
  for (let col = 0; col < 8; ++col) {
    p0 = p[col];
    p1 = p[col + 8];
    p2 = p[col + 16];
    p3 = p[col + 24];
    p4 = p[col + 32];
    p5 = p[col + 40];
    p6 = p[col + 48];
    p7 = p[col + 56];
    if ((p1 | p2 | p3 | p4 | p5 | p6 | p7) === 0) {
      t = dctSqrt2 * p0 + 8192 >> 14;
      if (t < -2040) {
        t = 0;
      } else if (t >= 2024) {
        t = 255;
      } else {
        t = t + 2056 >> 4;
      }
      blockData[blockBufferOffset + col] = t;
      blockData[blockBufferOffset + col + 8] = t;
      blockData[blockBufferOffset + col + 16] = t;
      blockData[blockBufferOffset + col + 24] = t;
      blockData[blockBufferOffset + col + 32] = t;
      blockData[blockBufferOffset + col + 40] = t;
      blockData[blockBufferOffset + col + 48] = t;
      blockData[blockBufferOffset + col + 56] = t;
      continue;
    }
    v0 = dctSqrt2 * p0 + 2048 >> 12;
    v1 = dctSqrt2 * p4 + 2048 >> 12;
    v2 = p2;
    v3 = p6;
    v4 = dctSqrt1d2 * (p1 - p7) + 2048 >> 12;
    v7 = dctSqrt1d2 * (p1 + p7) + 2048 >> 12;
    v5 = p3;
    v6 = p5;
    v0 = (v0 + v1 + 1 >> 1) + 4112;
    v1 = v0 - v1;
    t = v2 * dctSin6 + v3 * dctCos6 + 2048 >> 12;
    v2 = v2 * dctCos6 - v3 * dctSin6 + 2048 >> 12;
    v3 = t;
    v4 = v4 + v6 + 1 >> 1;
    v6 = v4 - v6;
    v7 = v7 + v5 + 1 >> 1;
    v5 = v7 - v5;
    v0 = v0 + v3 + 1 >> 1;
    v3 = v0 - v3;
    v1 = v1 + v2 + 1 >> 1;
    v2 = v1 - v2;
    t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
    v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
    v7 = t;
    t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
    v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
    v6 = t;
    p0 = v0 + v7;
    p7 = v0 - v7;
    p1 = v1 + v6;
    p6 = v1 - v6;
    p2 = v2 + v5;
    p5 = v2 - v5;
    p3 = v3 + v4;
    p4 = v3 - v4;
    if (p0 < 16) {
      p0 = 0;
    } else if (p0 >= 4080) {
      p0 = 255;
    } else {
      p0 >>= 4;
    }
    if (p1 < 16) {
      p1 = 0;
    } else if (p1 >= 4080) {
      p1 = 255;
    } else {
      p1 >>= 4;
    }
    if (p2 < 16) {
      p2 = 0;
    } else if (p2 >= 4080) {
      p2 = 255;
    } else {
      p2 >>= 4;
    }
    if (p3 < 16) {
      p3 = 0;
    } else if (p3 >= 4080) {
      p3 = 255;
    } else {
      p3 >>= 4;
    }
    if (p4 < 16) {
      p4 = 0;
    } else if (p4 >= 4080) {
      p4 = 255;
    } else {
      p4 >>= 4;
    }
    if (p5 < 16) {
      p5 = 0;
    } else if (p5 >= 4080) {
      p5 = 255;
    } else {
      p5 >>= 4;
    }
    if (p6 < 16) {
      p6 = 0;
    } else if (p6 >= 4080) {
      p6 = 255;
    } else {
      p6 >>= 4;
    }
    if (p7 < 16) {
      p7 = 0;
    } else if (p7 >= 4080) {
      p7 = 255;
    } else {
      p7 >>= 4;
    }
    blockData[blockBufferOffset + col] = p0;
    blockData[blockBufferOffset + col + 8] = p1;
    blockData[blockBufferOffset + col + 16] = p2;
    blockData[blockBufferOffset + col + 24] = p3;
    blockData[blockBufferOffset + col + 32] = p4;
    blockData[blockBufferOffset + col + 40] = p5;
    blockData[blockBufferOffset + col + 48] = p6;
    blockData[blockBufferOffset + col + 56] = p7;
  }
}
function buildComponentData(frame, component) {
  const blocksPerLine = component.blocksPerLine;
  const blocksPerColumn = component.blocksPerColumn;
  const computationBuffer = new Int16Array(64);
  for (let blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
    for (let blockCol = 0; blockCol < blocksPerLine; blockCol++) {
      const offset = getBlockBufferOffset(component, blockRow, blockCol);
      quantizeAndInverse(component, offset, computationBuffer);
    }
  }
  return component.blockData;
}
function findNextFileMarker(data, view, currentPos, startPos = currentPos) {
  const maxPos = data.length - 1;
  let newPos = startPos < currentPos ? startPos : currentPos;
  if (currentPos >= maxPos) {
    return null;
  }
  const currentMarker = view.getUint16(currentPos);
  if (currentMarker >= 0xffc0 && currentMarker <= 0xfffe) {
    return {
      invalid: null,
      marker: currentMarker,
      offset: currentPos
    };
  }
  let newMarker = view.getUint16(newPos);
  while (!(newMarker >= 0xffc0 && newMarker <= 0xfffe)) {
    if (++newPos >= maxPos) {
      return null;
    }
    newMarker = view.getUint16(newPos);
  }
  return {
    invalid: currentMarker.toString(16),
    marker: newMarker,
    offset: newPos
  };
}
function prepareComponents(frame) {
  const mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / frame.maxH);
  const mcusPerColumn = Math.ceil(frame.scanLines / 8 / frame.maxV);
  for (const component of frame.components) {
    const blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / frame.maxH);
    const blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines / 8) * component.v / frame.maxV);
    const blocksPerLineForMcu = mcusPerLine * component.h;
    const blocksPerColumnForMcu = mcusPerColumn * component.v;
    const blocksBufferSize = 64 * blocksPerColumnForMcu * (blocksPerLineForMcu + 1);
    component.blockData = new Int16Array(blocksBufferSize);
    component.blocksPerLine = blocksPerLine;
    component.blocksPerColumn = blocksPerColumn;
  }
  frame.mcusPerLine = mcusPerLine;
  frame.mcusPerColumn = mcusPerColumn;
}
function readDataBlock(data, view, offset) {
  const length = view.getUint16(offset);
  offset += 2;
  let endOffset = offset + length - 2;
  const fileMarker = findNextFileMarker(data, view, endOffset, offset);
  if (fileMarker?.invalid) {
    warn("readDataBlock - incorrect length, current marker is: " + fileMarker.invalid);
    endOffset = fileMarker.offset;
  }
  const array = data.subarray(offset, endOffset);
  return {
    appData: array,
    oldOffset: offset,
    newOffset: offset + array.length
  };
}
function skipData(data, view, offset) {
  const length = view.getUint16(offset);
  offset += 2;
  const endOffset = offset + length - 2;
  const fileMarker = findNextFileMarker(data, view, endOffset, offset);
  if (fileMarker?.invalid) {
    return fileMarker.offset;
  }
  return endOffset;
}
class JpegImage {
  constructor({
    decodeTransform = null,
    colorTransform = -1
  } = {}) {
    this._decodeTransform = decodeTransform;
    this._colorTransform = colorTransform;
  }
  static canUseImageDecoder(data, colorTransform = -1) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let exifOffsets = null;
    let offset = 0;
    let numComponents = null;
    let fileMarker = view.getUint16(offset);
    offset += 2;
    if (fileMarker !== 0xffd8) {
      throw new JpegError("SOI not found");
    }
    fileMarker = view.getUint16(offset);
    offset += 2;
    markerLoop: while (fileMarker !== 0xffd9) {
      switch (fileMarker) {
        case 0xffe1:
          const {
            appData,
            oldOffset,
            newOffset
          } = readDataBlock(data, view, offset);
          offset = newOffset;
          if (appData[0] === 0x45 && appData[1] === 0x78 && appData[2] === 0x69 && appData[3] === 0x66 && appData[4] === 0 && appData[5] === 0) {
            if (exifOffsets) {
              throw new JpegError("Duplicate EXIF-blocks found.");
            }
            exifOffsets = {
              exifStart: oldOffset + 6,
              exifEnd: newOffset
            };
          }
          fileMarker = view.getUint16(offset);
          offset += 2;
          continue;
        case 0xffc0:
        case 0xffc1:
        case 0xffc2:
          numComponents = data[offset + (2 + 1 + 2 + 2)];
          break markerLoop;
        case 0xffff:
          if (data[offset] !== 0xff) {
            offset--;
          }
          break;
      }
      offset = skipData(data, view, offset);
      fileMarker = view.getUint16(offset);
      offset += 2;
    }
    if (numComponents === 4) {
      return null;
    }
    if (numComponents === 3 && colorTransform === 0) {
      return null;
    }
    return exifOffsets || {};
  }
  parse(data, {
    dnlScanLines = null
  } = {}) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const maxOffset = data.length - 1;
    let offset = 0;
    let jfif = null;
    let adobe = null;
    let frame, resetInterval;
    let numSOSMarkers = 0;
    const quantizationTables = [];
    const huffmanTablesAC = [],
      huffmanTablesDC = [];
    let fileMarker = view.getUint16(offset);
    offset += 2;
    if (fileMarker !== 0xffd8) {
      throw new JpegError("SOI not found");
    }
    fileMarker = view.getUint16(offset);
    offset += 2;
    markerLoop: while (fileMarker !== 0xffd9) {
      let i, j, l;
      switch (fileMarker) {
        case 0xffe0:
        case 0xffe1:
        case 0xffe2:
        case 0xffe3:
        case 0xffe4:
        case 0xffe5:
        case 0xffe6:
        case 0xffe7:
        case 0xffe8:
        case 0xffe9:
        case 0xffea:
        case 0xffeb:
        case 0xffec:
        case 0xffed:
        case 0xffee:
        case 0xffef:
        case 0xfffe:
          const {
            appData,
            newOffset
          } = readDataBlock(data, view, offset);
          offset = newOffset;
          if (fileMarker === 0xffe0) {
            if (appData[0] === 0x4a && appData[1] === 0x46 && appData[2] === 0x49 && appData[3] === 0x46 && appData[4] === 0) {
              jfif = {
                version: {
                  major: appData[5],
                  minor: appData[6]
                },
                densityUnits: appData[7],
                xDensity: appData[8] << 8 | appData[9],
                yDensity: appData[10] << 8 | appData[11],
                thumbWidth: appData[12],
                thumbHeight: appData[13],
                thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
              };
            }
          }
          if (fileMarker === 0xffee) {
            if (appData[0] === 0x41 && appData[1] === 0x64 && appData[2] === 0x6f && appData[3] === 0x62 && appData[4] === 0x65) {
              adobe = {
                version: appData[5] << 8 | appData[6],
                flags0: appData[7] << 8 | appData[8],
                flags1: appData[9] << 8 | appData[10],
                transformCode: appData[11]
              };
            }
          }
          break;
        case 0xffdb:
          const quantizationTablesLength = view.getUint16(offset);
          offset += 2;
          const quantizationTablesEnd = quantizationTablesLength + offset - 2;
          let z;
          while (offset < quantizationTablesEnd) {
            const quantizationTableSpec = data[offset++];
            const tableData = new Uint16Array(64);
            if (quantizationTableSpec >> 4 === 0) {
              for (j = 0; j < 64; j++) {
                z = dctZigZag[j];
                tableData[z] = data[offset++];
              }
            } else if (quantizationTableSpec >> 4 === 1) {
              for (j = 0; j < 64; j++) {
                z = dctZigZag[j];
                tableData[z] = view.getUint16(offset);
                offset += 2;
              }
            } else {
              throw new JpegError("DQT - invalid table spec");
            }
            quantizationTables[quantizationTableSpec & 15] = tableData;
          }
          break;
        case 0xffc0:
        case 0xffc1:
        case 0xffc2:
          if (frame) {
            throw new JpegError("Only single frame JPEGs supported");
          }
          offset += 2;
          frame = {};
          frame.extended = fileMarker === 0xffc1;
          frame.progressive = fileMarker === 0xffc2;
          frame.precision = data[offset++];
          const sofScanLines = view.getUint16(offset);
          offset += 2;
          frame.scanLines = dnlScanLines || sofScanLines;
          frame.samplesPerLine = view.getUint16(offset);
          offset += 2;
          frame.components = [];
          frame.componentIds = {};
          const componentsCount = data[offset++];
          let maxH = 0,
            maxV = 0;
          for (i = 0; i < componentsCount; i++) {
            const componentId = data[offset];
            const h = data[offset + 1] >> 4;
            const v = data[offset + 1] & 15;
            if (maxH < h) {
              maxH = h;
            }
            if (maxV < v) {
              maxV = v;
            }
            const qId = data[offset + 2];
            l = frame.components.push({
              h,
              v,
              quantizationId: qId,
              quantizationTable: null
            });
            frame.componentIds[componentId] = l - 1;
            offset += 3;
          }
          frame.maxH = maxH;
          frame.maxV = maxV;
          prepareComponents(frame);
          break;
        case 0xffc4:
          const huffmanLength = view.getUint16(offset);
          offset += 2;
          for (i = 2; i < huffmanLength;) {
            const huffmanTableSpec = data[offset++];
            const codeLengths = new Uint8Array(16);
            let codeLengthSum = 0;
            for (j = 0; j < 16; j++, offset++) {
              codeLengthSum += codeLengths[j] = data[offset];
            }
            const huffmanValues = new Uint8Array(codeLengthSum);
            for (j = 0; j < codeLengthSum; j++, offset++) {
              huffmanValues[j] = data[offset];
            }
            i += 17 + codeLengthSum;
            (huffmanTableSpec >> 4 === 0 ? huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] = buildHuffmanTable(codeLengths, huffmanValues);
          }
          break;
        case 0xffdd:
          offset += 2;
          resetInterval = view.getUint16(offset);
          offset += 2;
          break;
        case 0xffda:
          const parseDNLMarker = ++numSOSMarkers === 1 && !dnlScanLines;
          offset += 2;
          const selectorsCount = data[offset++],
            components = [];
          for (i = 0; i < selectorsCount; i++) {
            const index = data[offset++];
            const componentIndex = frame.componentIds[index];
            const component = frame.components[componentIndex];
            component.index = index;
            const tableSpec = data[offset++];
            component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
            component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
            components.push(component);
          }
          const spectralStart = data[offset++],
            spectralEnd = data[offset++],
            successiveApproximation = data[offset++];
          try {
            const processed = decodeScan(data, view, offset, frame, components, resetInterval, spectralStart, spectralEnd, successiveApproximation >> 4, successiveApproximation & 15, parseDNLMarker);
            offset += processed;
          } catch (ex) {
            if (ex instanceof DNLMarkerError) {
              warn(`${ex.message} -- attempting to re-parse the JPEG image.`);
              return this.parse(data, {
                dnlScanLines: ex.scanLines
              });
            } else if (ex instanceof EOIMarkerError) {
              warn(`${ex.message} -- ignoring the rest of the image data.`);
              break markerLoop;
            }
            throw ex;
          }
          break;
        case 0xffdc:
          offset += 4;
          break;
        case 0xffff:
          if (data[offset] !== 0xff) {
            offset--;
          }
          break;
        default:
          const nextFileMarker = findNextFileMarker(data, view, offset - 2, offset - 3);
          if (nextFileMarker?.invalid) {
            warn("JpegImage.parse - unexpected data, current marker is: " + nextFileMarker.invalid);
            offset = nextFileMarker.offset;
            break;
          }
          if (!nextFileMarker || offset >= maxOffset) {
            warn("JpegImage.parse - reached the end of the image data " + "without finding an EOI marker (0xFFD9).");
            break markerLoop;
          }
          throw new JpegError("JpegImage.parse - unknown marker: " + fileMarker.toString(16));
      }
      if (offset < maxOffset) {
        fileMarker = view.getUint16(offset);
        offset += 2;
      } else {
        fileMarker = 0;
      }
    }
    if (!frame) {
      throw new JpegError("JpegImage.parse - no frame data found.");
    }
    this.width = frame.samplesPerLine;
    this.height = frame.scanLines;
    this.jfif = jfif;
    this.adobe = adobe;
    this.components = [];
    for (const component of frame.components) {
      const quantizationTable = quantizationTables[component.quantizationId];
      if (quantizationTable) {
        component.quantizationTable = quantizationTable;
      }
      this.components.push({
        index: component.index,
        output: buildComponentData(frame, component),
        scaleX: component.h / frame.maxH,
        scaleY: component.v / frame.maxV,
        blocksPerLine: component.blocksPerLine,
        blocksPerColumn: component.blocksPerColumn
      });
    }
    this.numComponents = this.components.length;
    return undefined;
  }
  #getLinearizedBlockData(width, height, isSourcePDF) {
    const scaleX = this.width / width,
      scaleY = this.height / height;
    let component, componentScaleX, componentScaleY, blocksPerScanline;
    let x, y, i, j, k;
    let index;
    let offset = 0;
    let output;
    const numComponents = this.components.length;
    const dataLength = width * height * numComponents;
    const data = new Uint8ClampedArray(dataLength);
    const xScaleBlockOffset = new Uint32Array(width);
    const mask3LSB = 0xfffffff8;
    let lastComponentScaleX;
    for (i = 0; i < numComponents; i++) {
      component = this.components[i];
      componentScaleX = component.scaleX * scaleX;
      componentScaleY = component.scaleY * scaleY;
      offset = i;
      output = component.output;
      blocksPerScanline = component.blocksPerLine + 1 << 3;
      if (componentScaleX !== lastComponentScaleX) {
        for (x = 0; x < width; x++) {
          j = 0 | x * componentScaleX;
          xScaleBlockOffset[x] = (j & mask3LSB) << 3 | j & 7;
        }
        lastComponentScaleX = componentScaleX;
      }
      for (y = 0; y < height; y++) {
        j = 0 | y * componentScaleY;
        index = blocksPerScanline * (j & mask3LSB) | (j & 7) << 3;
        for (x = 0; x < width; x++) {
          data[offset] = output[index + xScaleBlockOffset[x]];
          offset += numComponents;
        }
      }
    }
    let transform = this._decodeTransform;
    if (!isSourcePDF && numComponents === 4) {
      transform ||= new Int32Array([-256, 255, -256, 255, -256, 255, -256, 255]);
    }
    if (transform) {
      for (i = 0; i < dataLength;) {
        for (j = 0, k = 0; j < numComponents; j++, i++, k += 2) {
          data[i] = (data[i] * transform[k] >> 8) + transform[k + 1];
        }
      }
    }
    return data;
  }
  get _isColorConversionNeeded() {
    if (this.adobe) {
      return !!this.adobe.transformCode;
    }
    if (this.numComponents === 3) {
      if (this._colorTransform === 0) {
        return false;
      } else if (this.components[0].index === 0x52 && this.components[1].index === 0x47 && this.components[2].index === 0x42) {
        return false;
      }
      return true;
    }
    if (this._colorTransform === 1) {
      return true;
    }
    return false;
  }
  _convertYccToRgb(data) {
    let Y, Cb, Cr;
    for (let i = 0, ii = data.length; i < ii; i += 3) {
      Y = data[i];
      Cb = data[i + 1];
      Cr = data[i + 2];
      data[i] = Y - 179.456 + 1.402 * Cr;
      data[i + 1] = Y + 135.459 - 0.344 * Cb - 0.714 * Cr;
      data[i + 2] = Y - 226.816 + 1.772 * Cb;
    }
    return data;
  }
  _convertYccToRgba(data, out) {
    for (let i = 0, j = 0, ii = data.length; i < ii; i += 3, j += 4) {
      const Y = data[i];
      const Cb = data[i + 1];
      const Cr = data[i + 2];
      out[j] = Y - 179.456 + 1.402 * Cr;
      out[j + 1] = Y + 135.459 - 0.344 * Cb - 0.714 * Cr;
      out[j + 2] = Y - 226.816 + 1.772 * Cb;
      out[j + 3] = 255;
    }
    return out;
  }
  _convertYcckToRgb(data) {
    this._convertYcckToCmyk(data);
    return this._convertCmykToRgb(data);
  }
  _convertYcckToRgba(data) {
    this._convertYcckToCmyk(data);
    return this._convertCmykToRgba(data);
  }
  _convertYcckToCmyk(data) {
    let Y, Cb, Cr;
    for (let i = 0, ii = data.length; i < ii; i += 4) {
      Y = data[i];
      Cb = data[i + 1];
      Cr = data[i + 2];
      data[i] = 434.456 - Y - 1.402 * Cr;
      data[i + 1] = 119.541 - Y + 0.344 * Cb + 0.714 * Cr;
      data[i + 2] = 481.816 - Y - 1.772 * Cb;
    }
    return data;
  }
  _convertCmykToRgb(data) {
    const count = data.length / 4;
    ColorSpaceUtils.cmyk.getRgbBuffer(data, 0, count, data, 0, 8, 0);
    return data.subarray(0, count * 3);
  }
  _convertCmykToRgba(data) {
    ColorSpaceUtils.cmyk.getRgbBuffer(data, 0, data.length / 4, data, 0, 8, 1);
    if (ColorSpaceUtils.cmyk instanceof DeviceCmykCS) {
      for (let i = 3, ii = data.length; i < ii; i += 4) {
        data[i] = 255;
      }
    }
    return data;
  }
  getData({
    width,
    height,
    forceRGBA = false,
    forceRGB = false,
    isSourcePDF = false
  }) {
    if (this.numComponents > 4) {
      throw new JpegError("Unsupported color mode");
    }
    const data = this.#getLinearizedBlockData(width, height, isSourcePDF);
    if (this.numComponents === 1 && (forceRGBA || forceRGB)) {
      const len = data.length * (forceRGBA ? 4 : 3);
      const rgbaData = new Uint8ClampedArray(len);
      let offset = 0;
      if (forceRGBA) {
        grayToRGBA(data, new Uint32Array(rgbaData.buffer));
      } else {
        for (const grayColor of data) {
          rgbaData[offset++] = grayColor;
          rgbaData[offset++] = grayColor;
          rgbaData[offset++] = grayColor;
        }
      }
      return rgbaData;
    } else if (this.numComponents === 3 && this._isColorConversionNeeded) {
      if (forceRGBA) {
        const rgbaData = new Uint8ClampedArray(data.length / 3 * 4);
        return this._convertYccToRgba(data, rgbaData);
      }
      return this._convertYccToRgb(data);
    } else if (this.numComponents === 4) {
      if (this._isColorConversionNeeded) {
        if (forceRGBA) {
          return this._convertYcckToRgba(data);
        }
        if (forceRGB) {
          return this._convertYcckToRgb(data);
        }
        return this._convertYcckToCmyk(data);
      } else if (forceRGBA) {
        return this._convertCmykToRgba(data);
      } else if (forceRGB) {
        return this._convertCmykToRgb(data);
      }
    }
    return data;
  }
}

;// ./external/openjpeg/openjpeg.js
async function OpenJPEG(moduleArg = {}) {
  var moduleRtn;
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = true;
  var ENVIRONMENT_IS_WORKER = false;
  var arguments_ = [];
  var thisProgram = "./this.program";
  var quit_ = (status, toThrow) => {
    throw toThrow;
  };
  var _scriptName = import.meta.url;
  var scriptDirectory = "";
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL(".", _scriptName).href;
    } catch {}
    readAsync = async url => {
      var response = await fetch(url, {
        credentials: "same-origin"
      });
      if (response.ok) {
        return response.arrayBuffer();
      }
      throw new Error(response.status + " : " + response.url);
    };
  } else {}
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  var wasmBinary;
  var ABORT = false;
  var EXITSTATUS;
  class EmscriptenEH {}
  class EmscriptenSjLj extends EmscriptenEH {}
  var readyPromiseResolve, readyPromiseReject;
  var runtimeInitialized = false;
  function updateMemoryViews() {
    var b = wasmMemory.buffer;
    HEAP8 = new Int8Array(b);
    HEAP16 = new Int16Array(b);
    HEAPU8 = new Uint8Array(b);
    HEAPU16 = new Uint16Array(b);
    HEAP32 = new Int32Array(b);
    HEAPU32 = new Uint32Array(b);
    HEAPF32 = new Float32Array(b);
    HEAPF64 = new Float64Array(b);
    HEAP64 = new BigInt64Array(b);
    HEAPU64 = new BigUint64Array(b);
  }
  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }
    callRuntimeCallbacks(onPreRuns);
  }
  function initRuntime() {
    runtimeInitialized = true;
    wasmExports["s"]();
  }
  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }
    callRuntimeCallbacks(onPostRuns);
  }
  function abort(what) {
    Module["onAbort"]?.(what);
    what = `Aborted(${what})`;
    err(what);
    ABORT = true;
    what += ". Build with -sASSERTIONS for more info.";
    var e = new WebAssembly.RuntimeError(what);
    readyPromiseReject?.(e);
    throw e;
  }
  var wasmBinaryFile;
  function getWasmImports() {
    var imports = {
      a: wasmImports
    };
    return imports;
  }
  async function createWasm() {
    function receiveInstance(instance, module) {
      wasmExports = instance.exports;
      assignWasmExports(wasmExports);
      updateMemoryViews();
      return wasmExports;
    }
    var info = getWasmImports();
    return new Promise((resolve, reject) => {
      Module["instantiateWasm"](info, (inst, mod) => {
        resolve(receiveInstance(inst, mod));
      });
    });
  }
  class ExitStatus {
    name = "ExitStatus";
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var HEAP16;
  var HEAP32;
  var HEAP64;
  var HEAP8;
  var HEAPF32;
  var HEAPF64;
  var HEAPU16;
  var HEAPU32;
  var HEAPU64;
  var HEAPU8;
  var callRuntimeCallbacks = callbacks => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  };
  var onPostRuns = [];
  var addOnPostRun = cb => onPostRuns.push(cb);
  var onPreRuns = [];
  var addOnPreRun = cb => onPreRuns.push(cb);
  var noExitRuntime = true;
  var __abort_js = () => abort("");
  var runtimeKeepaliveCounter = 0;
  var __emscripten_runtime_keepalive_clear = () => {
    noExitRuntime = false;
    runtimeKeepaliveCounter = 0;
  };
  var timers = {};
  var handleException = e => {
    if (e instanceof ExitStatus || e == "unwind") {
      return EXITSTATUS;
    }
    quit_(1, e);
  };
  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  var _proc_exit = code => {
    EXITSTATUS = code;
    if (!keepRuntimeAlive()) {
      Module["onExit"]?.(code);
      ABORT = true;
    }
    quit_(code, new ExitStatus(code));
  };
  var exitJS = (status, implicit) => {
    EXITSTATUS = status;
    _proc_exit(status);
  };
  var _exit = exitJS;
  var maybeExit = () => {
    if (!keepRuntimeAlive()) {
      try {
        _exit(EXITSTATUS);
      } catch (e) {
        handleException(e);
      }
    }
  };
  var callUserCallback = func => {
    if (ABORT) {
      return;
    }
    try {
      return func();
    } catch (e) {
      handleException(e);
    } finally {
      maybeExit();
    }
  };
  var _emscripten_get_now = () => performance.now();
  var __setitimer_js = (which, timeout_ms) => {
    if (timers[which]) {
      clearTimeout(timers[which].id);
      delete timers[which];
    }
    if (!timeout_ms) return 0;
    var id = setTimeout(() => {
      delete timers[which];
      callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
    }, timeout_ms);
    timers[which] = {
      id,
      timeout_ms
    };
    return 0;
  };
  function _copy_pixels_1(compG_ptr, nb_pixels) {
    compG_ptr >>= 2;
    const imageData = Module.imageData = new Uint8ClampedArray(nb_pixels);
    const compG = HEAP32.subarray(compG_ptr, compG_ptr + nb_pixels);
    imageData.set(compG);
  }
  function _copy_pixels_3(compR_ptr, compG_ptr, compB_ptr, nb_pixels) {
    compR_ptr >>= 2;
    compG_ptr >>= 2;
    compB_ptr >>= 2;
    const imageData = Module.imageData = new Uint8ClampedArray(nb_pixels * 3);
    const compR = HEAP32.subarray(compR_ptr, compR_ptr + nb_pixels);
    const compG = HEAP32.subarray(compG_ptr, compG_ptr + nb_pixels);
    const compB = HEAP32.subarray(compB_ptr, compB_ptr + nb_pixels);
    for (let i = 0; i < nb_pixels; i++) {
      imageData[3 * i] = compR[i];
      imageData[3 * i + 1] = compG[i];
      imageData[3 * i + 2] = compB[i];
    }
  }
  function _copy_pixels_4(compR_ptr, compG_ptr, compB_ptr, compA_ptr, nb_pixels) {
    compR_ptr >>= 2;
    compG_ptr >>= 2;
    compB_ptr >>= 2;
    compA_ptr >>= 2;
    const imageData = Module.imageData = new Uint8ClampedArray(nb_pixels * 4);
    const compR = HEAP32.subarray(compR_ptr, compR_ptr + nb_pixels);
    const compG = HEAP32.subarray(compG_ptr, compG_ptr + nb_pixels);
    const compB = HEAP32.subarray(compB_ptr, compB_ptr + nb_pixels);
    const compA = HEAP32.subarray(compA_ptr, compA_ptr + nb_pixels);
    for (let i = 0; i < nb_pixels; i++) {
      imageData[4 * i] = compR[i];
      imageData[4 * i + 1] = compG[i];
      imageData[4 * i + 2] = compB[i];
      imageData[4 * i + 3] = compA[i];
    }
  }
  var getHeapMax = () => 2147483648;
  var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
  var growMemory = size => {
    var oldHeapSize = wasmMemory.buffer.byteLength;
    var pages = (size - oldHeapSize + 65535) / 65536 | 0;
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return 1;
    } catch (e) {}
  };
  var _emscripten_resize_heap = requestedSize => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    var maxHeapSize = getHeapMax();
    if (requestedSize > maxHeapSize) {
      return false;
    }
    for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
      var overGrownHeapSize = oldSize * (1 + .2 / cutDown);
      overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
      var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
      var replacement = growMemory(newSize);
      if (replacement) {
        return true;
      }
    }
    return false;
  };
  var ENV = {};
  var getExecutableName = () => thisProgram || "./this.program";
  var getEnvStrings = () => {
    if (!getEnvStrings.strings) {
      var lang = (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8";
      var env = {
        USER: "web_user",
        LOGNAME: "web_user",
        PATH: "/",
        PWD: "/",
        HOME: "/home/web_user",
        LANG: lang,
        _: getExecutableName()
      };
      for (var x in ENV) {
        if (ENV[x] === undefined) delete env[x];else env[x] = ENV[x];
      }
      var strings = [];
      for (var x in env) {
        strings.push(`${x}=${env[x]}`);
      }
      getEnvStrings.strings = strings;
    }
    return getEnvStrings.strings;
  };
  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i = 0; i < str.length; ++i) {
      var u = str.codePointAt(i);
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 192 | u >> 6;
        heap[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 224 | u >> 12;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 3 >= endIdx) break;
        heap[outIdx++] = 240 | u >> 18;
        heap[outIdx++] = 128 | u >> 12 & 63;
        heap[outIdx++] = 128 | u >> 6 & 63;
        heap[outIdx++] = 128 | u & 63;
        i++;
      }
    }
    heap[outIdx] = 0;
    return outIdx - startIdx;
  };
  var stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  var _environ_get = (__environ, environ_buf) => {
    var bufSize = 0;
    var envp = 0;
    for (var string of getEnvStrings()) {
      var ptr = environ_buf + bufSize;
      HEAPU32[__environ + envp >> 2] = ptr;
      bufSize += stringToUTF8(string, ptr, Infinity) + 1;
      envp += 4;
    }
    return 0;
  };
  var lengthBytesUTF8 = str => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var c = str.charCodeAt(i);
      if (c <= 127) {
        len++;
      } else if (c <= 2047) {
        len += 2;
      } else if (c >= 55296 && c <= 57343) {
        len += 4;
        ++i;
      } else {
        len += 3;
      }
    }
    return len;
  };
  var _environ_sizes_get = (penviron_count, penviron_buf_size) => {
    var strings = getEnvStrings();
    HEAPU32[penviron_count >> 2] = strings.length;
    var bufSize = 0;
    for (var string of strings) {
      bufSize += lengthBytesUTF8(string) + 1;
    }
    HEAPU32[penviron_buf_size >> 2] = bufSize;
    return 0;
  };
  var INT53_MAX = 9007199254740992;
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = num => num < INT53_MIN || num > INT53_MAX ? NaN : Number(num);
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
    return 70;
  }
  var printCharBuffers = [null, [], []];
  var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();
  var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  };
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
    var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
    if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
      return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    var str = "";
    while (idx < endPtr) {
      var u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      var u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) == 192) {
        str += String.fromCharCode((u0 & 31) << 6 | u1);
        continue;
      }
      var u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = (u0 & 15) << 12 | u1 << 6 | u2;
      } else {
        u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      }
    }
    return str;
  };
  var printChar = (stream, curr) => {
    var buffer = printCharBuffers[stream];
    if (curr === 0 || curr === 10) {
      (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  };
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "";
  var _fd_write = (fd, iov, iovcnt, pnum) => {
    var num = 0;
    for (var i = 0; i < iovcnt; i++) {
      var ptr = HEAPU32[iov >> 2];
      var len = HEAPU32[iov + 4 >> 2];
      iov += 8;
      for (var j = 0; j < len; j++) {
        printChar(fd, HEAPU8[ptr + j]);
      }
      num += len;
    }
    HEAPU32[pnum >> 2] = num;
    return 0;
  };
  function _gray_to_rgba(compG_ptr, nb_pixels) {
    compG_ptr >>= 2;
    const imageData = Module.imageData = new Uint8ClampedArray(nb_pixels * 4);
    const compG = HEAP32.subarray(compG_ptr, compG_ptr + nb_pixels);
    for (let i = 0; i < nb_pixels; i++) {
      imageData[4 * i] = imageData[4 * i + 1] = imageData[4 * i + 2] = compG[i];
      imageData[4 * i + 3] = 255;
    }
  }
  function _graya_to_rgba(compG_ptr, compA_ptr, nb_pixels) {
    compG_ptr >>= 2;
    compA_ptr >>= 2;
    const imageData = Module.imageData = new Uint8ClampedArray(nb_pixels * 4);
    const compG = HEAP32.subarray(compG_ptr, compG_ptr + nb_pixels);
    const compA = HEAP32.subarray(compA_ptr, compA_ptr + nb_pixels);
    for (let i = 0; i < nb_pixels; i++) {
      imageData[4 * i] = imageData[4 * i + 1] = imageData[4 * i + 2] = compG[i];
      imageData[4 * i + 3] = compA[i];
    }
  }
  function _jsPrintWarning(message_ptr) {
    const message = UTF8ToString(message_ptr);
    (Module.warn || console.warn)(`OpenJPEG: ${message}`);
  }
  function _rgb_to_rgba(compR_ptr, compG_ptr, compB_ptr, nb_pixels) {
    compR_ptr >>= 2;
    compG_ptr >>= 2;
    compB_ptr >>= 2;
    const imageData = Module.imageData = new Uint8ClampedArray(nb_pixels * 4);
    const compR = HEAP32.subarray(compR_ptr, compR_ptr + nb_pixels);
    const compG = HEAP32.subarray(compG_ptr, compG_ptr + nb_pixels);
    const compB = HEAP32.subarray(compB_ptr, compB_ptr + nb_pixels);
    for (let i = 0; i < nb_pixels; i++) {
      imageData[4 * i] = compR[i];
      imageData[4 * i + 1] = compG[i];
      imageData[4 * i + 2] = compB[i];
      imageData[4 * i + 3] = 255;
    }
  }
  function _storeErrorMessage(message_ptr) {
    const message = UTF8ToString(message_ptr);
    if (!Module.errorMessages) {
      Module.errorMessages = message;
    } else {
      Module.errorMessages += "\n" + message;
    }
  }
  var writeArrayToMemory = (array, buffer) => {
    HEAP8.set(array, buffer);
  };
  if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
  if (Module["print"]) out = Module["print"];
  if (Module["printErr"]) err = Module["printErr"];
  if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
  if (Module["arguments"]) arguments_ = Module["arguments"];
  if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
  if (Module["preInit"]) {
    if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
    while (Module["preInit"].length > 0) {
      Module["preInit"].shift()();
    }
  }
  Module["writeArrayToMemory"] = writeArrayToMemory;
  var _malloc, _free, _jp2_decode, __emscripten_timeout, memory, __indirect_function_table, wasmMemory;
  function assignWasmExports(wasmExports) {
    _malloc = Module["_malloc"] = wasmExports["t"];
    _free = Module["_free"] = wasmExports["u"];
    _jp2_decode = Module["_jp2_decode"] = wasmExports["v"];
    __emscripten_timeout = wasmExports["w"];
    memory = wasmMemory = wasmExports["r"];
    __indirect_function_table = wasmExports["__indirect_function_table"];
  }
  var wasmImports = {
    m: __abort_js,
    l: __emscripten_runtime_keepalive_clear,
    i: __setitimer_js,
    f: _copy_pixels_1,
    e: _copy_pixels_3,
    d: _copy_pixels_4,
    j: _emscripten_resize_heap,
    o: _environ_get,
    p: _environ_sizes_get,
    n: _fd_seek,
    b: _fd_write,
    q: _gray_to_rgba,
    h: _graya_to_rgba,
    c: _jsPrintWarning,
    k: _proc_exit,
    g: _rgb_to_rgba,
    a: _storeErrorMessage
  };
  function run() {
    preRun();
    function doRun() {
      Module["calledRun"] = true;
      if (ABORT) return;
      initRuntime();
      readyPromiseResolve?.(Module);
      Module["onRuntimeInitialized"]?.();
      postRun();
    }
    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(() => {
        setTimeout(() => Module["setStatus"](""), 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }
  var wasmExports;
  wasmExports = await createWasm();
  run();
  if (runtimeInitialized) {
    moduleRtn = Module;
  } else {
    moduleRtn = new Promise((resolve, reject) => {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
  }
  return moduleRtn;
}
/* harmony default export */ const openjpeg = (OpenJPEG);
;// ./src/core/stream.js


class Stream extends BaseStream {
  constructor(arrayBuffer, start, length, dict) {
    super();
    this.bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    this.start = start || 0;
    this.pos = this.start;
    this.end = start + length || this.bytes.length;
    this.dict = dict;
  }
  get length() {
    return this.end - this.start;
  }
  get isEmpty() {
    return this.length === 0;
  }
  getByte() {
    if (this.pos >= this.end) {
      return -1;
    }
    return this.bytes[this.pos++];
  }
  getBytes(length) {
    const pos = this.pos;
    const endPos = !length ? this.end : Math.min(pos + length, this.end);
    this.pos = endPos;
    return this.bytes.subarray(pos, endPos);
  }
  getByteRange(begin, end) {
    if (begin < 0) {
      begin = 0;
    }
    if (end > this.end) {
      end = this.end;
    }
    return this.bytes.subarray(begin, end);
  }
  reset() {
    this.pos = this.start;
  }
  moveStart() {
    this.start = this.pos;
  }
  makeSubStream(start, length, dict = null) {
    return new Stream(this.bytes.buffer, start, length, dict);
  }
  clone() {
    return new Stream(this.bytes.buffer, this.start, this.length, this.dict?.clone());
  }
}
class StringStream extends Stream {
  constructor(str, dict = null) {
    super(stringToBytes(str), NaN, NaN, dict);
  }
}
class NullStream extends Stream {
  constructor() {
    super(new Uint8Array(0));
  }
}

;// ./src/core/jpx.js




class JpxError extends BaseException {
  constructor(msg) {
    super(msg, "JpxError");
  }
}
class JpxImage extends WasmImage {
  _filename = "openjpeg.wasm";
  _noWasmFilename = "openjpeg_nowasm_fallback.js";
  static get instance() {
    return shadow(this, "instance", new JpxImage(true));
  }
  async decode(bytes, {
    numComponents = 4,
    isIndexedColormap = false,
    smaskInData = false,
    reducePower = 0
  } = {}) {
    const module = await this._getModule(openjpeg);
    if (!module) {
      throw new JpxError("OpenJPEG failed to initialize");
    }
    let ptr;
    try {
      const size = bytes.length;
      ptr = module._malloc(size);
      module.writeArrayToMemory(bytes, ptr);
      const ret = module._jp2_decode(ptr, size, numComponents > 0 ? numComponents : 0, !!isIndexedColormap, !!smaskInData, reducePower);
      if (ret) {
        const {
          errorMessages
        } = module;
        if (errorMessages) {
          delete module.errorMessages;
          throw new JpxError(errorMessages);
        }
        throw new JpxError("Unknown error");
      }
      const {
        imageData
      } = module;
      module.imageData = null;
      return imageData;
    } finally {
      if (ptr) {
        module._free(ptr);
      }
    }
  }
  static parseImageProperties(stream) {
    if (stream instanceof ArrayBuffer || ArrayBuffer.isView(stream)) {
      stream = new Stream(stream);
    } else {
      throw new JpxError("Invalid data format, must be a TypedArray.");
    }
    let newByte = stream.getByte();
    while (newByte >= 0) {
      const oldByte = newByte;
      newByte = stream.getByte();
      const code = oldByte << 8 | newByte;
      if (code === 0xff51) {
        stream.skip(4);
        const Xsiz = stream.getInt32() >>> 0;
        const Ysiz = stream.getInt32() >>> 0;
        const XOsiz = stream.getInt32() >>> 0;
        const YOsiz = stream.getInt32() >>> 0;
        stream.skip(16);
        const Csiz = stream.getUint16();
        return {
          width: Xsiz - XOsiz,
          height: Ysiz - YOsiz,
          bitsPerComponent: 8,
          componentsCount: Csiz
        };
      }
    }
    throw new JpxError("No size marker found in JPX stream");
  }
}

;// ./src/pdf.image_decoders.js




globalThis.pdfjsImageDecoders = {
  getVerbosityLevel: getVerbosityLevel,
  Jbig2Error: Jbig2Error,
  Jbig2Image: JBig2CCITTFaxImage,
  JpegError: JpegError,
  JpegImage: JpegImage,
  JpxError: JpxError,
  JpxImage: JpxImage,
  setVerbosityLevel: setVerbosityLevel,
  VerbosityLevel: VerbosityLevel
};

export { Jbig2Error, JBig2CCITTFaxImage as Jbig2Image, JpegError, JpegImage, JpxError, JpxImage, VerbosityLevel, getVerbosityLevel, setVerbosityLevel };

//# sourceMappingURL=pdf.image_decoders.mjs.map