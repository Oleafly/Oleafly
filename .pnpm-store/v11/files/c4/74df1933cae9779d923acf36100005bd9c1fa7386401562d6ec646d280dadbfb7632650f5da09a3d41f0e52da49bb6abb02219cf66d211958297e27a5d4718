"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isSupportPath2d = exports.getMarginSize = exports.getImageSettings = exports.generatePath = exports.excavateModules = exports.SPEC_MARGIN_SIZE = exports.ERROR_LEVEL_MAP = exports.DEFAULT_SIZE = exports.DEFAULT_NEED_MARGIN = exports.DEFAULT_MINVERSION = exports.DEFAULT_MARGIN_SIZE = exports.DEFAULT_LEVEL = exports.DEFAULT_IMG_SCALE = exports.DEFAULT_FRONT_COLOR = exports.DEFAULT_BACKGROUND_COLOR = void 0;
var _qrcodegen = require("./libs/qrcodegen");
// Part logic is from `qrcode.react`. (ISC License)
// https://github.com/zpao/qrcode.react

// ==========================================================

// =================== ERROR_LEVEL ==========================
const ERROR_LEVEL_MAP = exports.ERROR_LEVEL_MAP = {
  L: _qrcodegen.Ecc.LOW,
  M: _qrcodegen.Ecc.MEDIUM,
  Q: _qrcodegen.Ecc.QUARTILE,
  H: _qrcodegen.Ecc.HIGH
};

// =================== DEFAULT_VALUE ==========================
const DEFAULT_SIZE = exports.DEFAULT_SIZE = 128;
const DEFAULT_LEVEL = exports.DEFAULT_LEVEL = 'L';
const DEFAULT_BACKGROUND_COLOR = exports.DEFAULT_BACKGROUND_COLOR = '#FFFFFF';
const DEFAULT_FRONT_COLOR = exports.DEFAULT_FRONT_COLOR = '#000000';
const DEFAULT_NEED_MARGIN = exports.DEFAULT_NEED_MARGIN = false;
const DEFAULT_MINVERSION = exports.DEFAULT_MINVERSION = 1;
const SPEC_MARGIN_SIZE = exports.SPEC_MARGIN_SIZE = 4;
const DEFAULT_MARGIN_SIZE = exports.DEFAULT_MARGIN_SIZE = 0;
const DEFAULT_IMG_SCALE = exports.DEFAULT_IMG_SCALE = 0.1;

// =================== UTILS ==========================
/**
 * Generate a path string from modules
 * @param modules
 * @param margin
 * @returns
 */
const generatePath = (modules, margin = 0) => {
  const ops = [];
  modules.forEach((row, y) => {
    let start = null;
    row.forEach((cell, x) => {
      if (!cell && start !== null) {
        ops.push(`M${start + margin} ${y + margin}h${x - start}v1H${start + margin}z`);
        start = null;
        return;
      }
      if (x === row.length - 1) {
        if (!cell) {
          return;
        }
        if (start === null) {
          ops.push(`M${x + margin},${y + margin} h1v1H${x + margin}z`);
        } else {
          ops.push(`M${start + margin},${y + margin} h${x + 1 - start}v1H${start + margin}z`);
        }
        return;
      }
      if (cell && start === null) {
        start = x;
      }
    });
  });
  return ops.join('');
};

/**
 * Excavate modules
 * @param modules
 * @param excavation
 * @returns
 */
exports.generatePath = generatePath;
const excavateModules = (modules, excavation) => {
  return modules.slice().map((row, y) => {
    if (y < excavation.y || y >= excavation.y + excavation.h) {
      return row;
    }
    return row.map((cell, x) => {
      if (x < excavation.x || x >= excavation.x + excavation.w) {
        return cell;
      }
      return false;
    });
  });
};

/**
 * Get image settings
 * @param cells The modules of the QR code
 * @param size The size of the QR code
 * @param margin
 * @param imageSettings
 * @returns
 */
exports.excavateModules = excavateModules;
const getImageSettings = (cells, size, margin, imageSettings) => {
  if (imageSettings == null) {
    return null;
  }
  const numCells = cells.length + margin * 2;
  const defaultSize = Math.floor(size * DEFAULT_IMG_SCALE);
  const scale = numCells / size;
  const w = (imageSettings.width || defaultSize) * scale;
  const h = (imageSettings.height || defaultSize) * scale;
  const x = imageSettings.x == null ? cells.length / 2 - w / 2 : imageSettings.x * scale;
  const y = imageSettings.y == null ? cells.length / 2 - h / 2 : imageSettings.y * scale;
  const opacity = imageSettings.opacity == null ? 1 : imageSettings.opacity;
  let excavation = null;
  if (imageSettings.excavate) {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const ceilW = Math.ceil(w + x - floorX);
    const ceilH = Math.ceil(h + y - floorY);
    excavation = {
      x: floorX,
      y: floorY,
      w: ceilW,
      h: ceilH
    };
  }
  const crossOrigin = imageSettings.crossOrigin;
  return {
    x,
    y,
    h,
    w,
    excavation,
    opacity,
    crossOrigin
  };
};

/**
 * Get margin size
 * @param needMargin Whether need margin
 * @param marginSize Custom margin size
 * @returns
 */
exports.getImageSettings = getImageSettings;
const getMarginSize = (needMargin, marginSize) => {
  if (marginSize != null) {
    return Math.max(Math.floor(marginSize), 0);
  }
  return needMargin ? SPEC_MARGIN_SIZE : DEFAULT_MARGIN_SIZE;
};

/**
 * Check if Path2D is supported
 */
exports.getMarginSize = getMarginSize;
const isSupportPath2d = exports.isSupportPath2d = (() => {
  try {
    new Path2D().addPath(new Path2D());
  } catch {
    return false;
  }
  return true;
})();