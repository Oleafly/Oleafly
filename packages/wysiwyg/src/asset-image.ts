import { wysiwygMessage } from "./messages";
import type { AssetUnavailable, AssetUrlResolver } from "./options";

export interface AssetImage {
  image: HTMLImageElement;
  placeholder: HTMLDivElement;
  show(source: string, alt?: string): void;
  destroy(): void;
}

type PlaceholderMessage =
  | "figure.imageLoading"
  | "figure.imageUnavailable"
  | "figure.imageOutside"
  | "figure.imageUnreadable";

const UNAVAILABLE_MESSAGE: Readonly<Record<AssetUnavailable["reason"], PlaceholderMessage>> = {
  outside: "figure.imageOutside",
  unreadable: "figure.imageUnreadable",
};

function part(className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  return span;
}

function splitPath(path: string): [folder: string, name: string] {
  const end = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  return [path.slice(0, end), path.slice(end)];
}

export function assetImage(
  resolveAssetUrl: AssetUrlResolver | null,
  projectPath: (source: string) => string | null = (source) => source,
): AssetImage {
  const image = document.createElement("img");
  image.hidden = true;
  const placeholder = document.createElement("div");
  placeholder.className = "figure-placeholder";
  const message = part("figure-placeholder-message");
  const where = part("figure-placeholder-path");
  const folder = part("figure-placeholder-folder");
  const name = part("figure-placeholder-name");
  const described = part("figure-placeholder-alt");
  where.append(folder, name);
  placeholder.append(message, where, described);
  let shown: string | null = null;
  let alt = "";
  let state: { key: PlaceholderMessage; path: string } | null = null;
  let generation = 0;
  let destroyed = false;

  const paint = () => {
    if (!state) return;
    message.textContent = wysiwygMessage(state.key);
    const [folderText, nameText] = splitPath(state.path);
    folder.textContent = folderText;
    name.textContent = nameText;
    where.title = state.path;
    where.hidden = state.path === "";
    described.textContent = alt ? wysiwygMessage("figure.imageAltText", { alt }) : "";
    described.title = alt;
    described.hidden = alt === "";
  };
  const showPlaceholder = (key: PlaceholderMessage, path: string) => {
    state = { key, path };
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
    placeholder.dataset.state = key === "figure.imageLoading" ? "loading" : "unavailable";
    paint();
  };
  const showUrl = (url: string) => {
    state = null;
    image.src = url;
    image.hidden = false;
    placeholder.hidden = true;
  };
  const showResult = (path: string, result: Awaited<ReturnType<AssetUrlResolver>>) => {
    if (typeof result === "string") showUrl(result);
    else showPlaceholder(result ? UNAVAILABLE_MESSAGE[result.reason] : "figure.imageUnavailable", path);
  };

  return {
    image,
    placeholder,
    show(source, nextAlt = "") {
      if (nextAlt !== alt) {
        alt = nextAlt;
        paint();
      }
      if (source === shown) return;
      shown = source;
      const request = ++generation;
      const path = projectPath(source);
      if (path === null) {
        showUrl(source);
        return;
      }
      if (!resolveAssetUrl || path === "") {
        showPlaceholder("figure.imageUnavailable", path);
        return;
      }
      showPlaceholder("figure.imageLoading", path);
      resolveAssetUrl(path).then(
        (result) => {
          if (!destroyed && request === generation) showResult(path, result);
        },
        () => {
          if (!destroyed && request === generation) showPlaceholder("figure.imageUnreadable", path);
        },
      );
    },
    destroy() {
      destroyed = true;
    },
  };
}
