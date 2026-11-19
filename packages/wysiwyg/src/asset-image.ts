import { wysiwygMessage } from "./messages";
import type { AssetUrlResolver } from "./options";

export interface AssetImage {
  image: HTMLImageElement;
  placeholder: HTMLDivElement;
  show(source: string): void;
  destroy(): void;
}

export function assetImage(
  resolveAssetUrl: AssetUrlResolver | null,
  projectPath: (source: string) => string | null = (source) => source,
): AssetImage {
  const image = document.createElement("img");
  image.hidden = true;
  const placeholder = document.createElement("div");
  placeholder.className = "figure-placeholder";
  let shown: string | null = null;
  let generation = 0;
  let destroyed = false;

  const showPlaceholder = (key: "figure.imageLoading" | "figure.imageUnavailable") => {
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
    placeholder.textContent = wysiwygMessage(key);
  };
  const showUrl = (url: string) => {
    image.src = url;
    image.hidden = false;
    placeholder.hidden = true;
  };

  return {
    image,
    placeholder,
    show(source) {
      if (source === shown) return;
      shown = source;
      const request = ++generation;
      const path = projectPath(source);
      if (path === null) {
        showUrl(source);
        return;
      }
      if (!resolveAssetUrl || path === "") {
        showPlaceholder("figure.imageUnavailable");
        return;
      }
      showPlaceholder("figure.imageLoading");
      resolveAssetUrl(path).then(
        (url) => {
          if (destroyed || request !== generation) return;
          if (url) showUrl(url);
          else showPlaceholder("figure.imageUnavailable");
        },
        () => {
          if (!destroyed && request === generation) showPlaceholder("figure.imageUnavailable");
        },
      );
    },
    destroy() {
      destroyed = true;
    },
  };
}
