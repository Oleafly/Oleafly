export var roundToEven = function roundToEven(number) {
  return number % 2 === 0 ? number : number - 1;
};
export var getAvatarShadow = function getAvatarShadow(isDarkMode, background) {
  if (!background) return;
  if (isDarkMode && background === '#000') {
    return '0 0 0 1px rgba(255,255,255,0.1) inset';
  } else if (!isDarkMode && background === '#fff') {
    return '0 0 0 1px rgba(0,0,0,0.05) inset';
  }
  return;
};