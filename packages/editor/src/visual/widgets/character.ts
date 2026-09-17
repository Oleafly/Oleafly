import { InlineWidget } from "./base";

const SYMBOLS: Record<string, string> = {
  "\\": " ",
  "%": "%",
  _: "_",
  "{": "{",
  "}": "}",
  "&": "&",
  "#": "#",
  $: "$",
  textbackslash: "\\",
  textasciicircum: "^",
  textasciitilde: "~",
  textless: "<",
  textgreater: ">",
  textbar: "|",
  textbardbl: "‖",
  textbraceleft: "{",
  textbraceright: "}",
  textunderscore: "_",
  textdollar: "$",
  textquotedbl: '"',
  textquotesingle: "'",
  textquotedblleft: "“",
  textquotedblright: "”",
  textquoteleft: "‘",
  textquoteright: "’",
  quotedblbase: "„",
  quotesinglbase: "‚",
  guillemetleft: "«",
  guillemetright: "»",
  guillemotleft: "«",
  guillemotright: "»",
  guilsinglleft: "‹",
  guilsinglright: "›",
  textendash: "–",
  textemdash: "—",
  textthreequartersemdash: "—",
  texttwelveudash: "—",
  textellipsis: "…",
  ldots: "…",
  dots: "…",
  textbullet: "•",
  textopenbullet: "◦",
  textperiodcentered: "·",
  textasteriskcentered: "⁎",
  textvisiblespace: "␣",
  textblank: "␢",
  textexclamdown: "¡",
  textquestiondown: "¿",
  textinterrobang: "‽",
  textinterrobangdown: "⸘",
  textordfeminine: "ª",
  textordmasculine: "º",
  textcopyright: "©",
  copyright: "©",
  textregistered: "®",
  texttrademark: "™",
  textservicemark: "℠",
  textcircledP: "℗",
  textsection: "§",
  S: "§",
  textparagraph: "¶",
  textpilcrow: "¶",
  P: "¶",
  textdagger: "†",
  dag: "†",
  textdaggerdbl: "‡",
  ddag: "‡",
  textperthousand: "‰",
  textpertenthousand: "‱",
  textdegree: "°",
  textmu: "µ",
  textbrokenbar: "¦",
  textnumero: "№",
  textreferencemark: "※",
  textrecipe: "℞",
  textestimated: "℮",
  textdiscount: "⁒",
  textdblhyphen: "⹀",
  textdblhyphenchar: "⹀",
  texttildelow: "˷",
  textsterling: "£",
  pounds: "£",
  texteuro: "€",
  textyen: "¥",
  textcent: "¢",
  textcentoldstyle: "¢",
  textcurrency: "¤",
  textflorin: "ƒ",
  textlira: "₤",
  textwon: "₩",
  textnaira: "₦",
  textpeso: "₱",
  textdong: "₫",
  textbaht: "฿",
  textcolonmonetary: "₡",
  aa: "å",
  AA: "Å",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  o: "ø",
  O: "Ø",
  ss: "ß",
  SS: "ẞ",
  l: "ł",
  L: "Ł",
  dh: "ð",
  DH: "Ð",
  th: "þ",
  TH: "Þ",
  ng: "ŋ",
  NG: "Ŋ",
  dj: "đ",
  DJ: "Đ",
  ij: "ĳ",
  IJ: "Ĳ",
  i: "ı",
  j: "ȷ",
};

function symbolKey(command: string): string {
  if (command === "\\") return command;
  return command.startsWith("\\") ? command.slice(1) : command;
}

export function characterSubstitution(command: string): string | undefined {
  return SYMBOLS[symbolKey(command)];
}

export function hasCharacterSubstitution(command: string): boolean {
  return characterSubstitution(command) !== undefined;
}

export class CharacterWidget extends InlineWidget {
  constructor(readonly content: string) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-character";
    element.textContent = this.content;
    return element;
  }

  eq(other: CharacterWidget): boolean {
    return other.content === this.content;
  }

  updateDOM(element: HTMLElement): boolean {
    element.textContent = this.content;
    return true;
  }
}

export function createCharacterWidget(command: string): CharacterWidget | null {
  const symbol = characterSubstitution(command);
  return symbol === undefined ? null : new CharacterWidget(symbol);
}
