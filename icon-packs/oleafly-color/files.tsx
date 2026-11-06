import { FileSheet, FOLD, icon, SHEET } from "./base";

// File types and the export menu. Each file type is a sheet with a coloured tile in the corner.

export const OiFileZip = icon("file-zip", (
  <FileSheet hue="k">
    <path className="wh thick" d="M14.7 12.3v2.5" />
    <rect className="wf" x="13.9" y="15" width="1.6" height="1.9" rx="0.4" />
  </FileSheet>
));

export const OiFilePdf = icon("file-pdf", (
  <FileSheet hue="r">
    <path className="wh thick" d="M13 13.6h3.4M13 15.6h2.2" />
  </FileSheet>
));

export const OiFileImage = icon("file-image", (
  <FileSheet hue="g">
    <path className="wh" d="M12.4 16.8l2-2.2 1.3 1.3 1.1-1 1.4 1.9" />
    <circle className="wf" cx="16.3" cy="13.3" r="0.7" />
  </FileSheet>
));

export const OiFileWord = icon("file-word", (
  <FileSheet hue="b">
    <path className="wh" d="M13 13.2h3.4M13 14.8h3.4M13 16.4h2.2" />
  </FileSheet>
));

export const OiFileHtml = icon("file-html", (
  <FileSheet hue="b">
    <circle className="wh" cx="14.7" cy="14.7" r="2.3" />
    <path className="wh" d="M12.4 14.7h4.6M14.7 12.4c-1.1 1.4-1.1 3.2 0 4.6M14.7 12.4c1.1 1.4 1.1 3.2 0 4.6" />
  </FileSheet>
));

export const OiFileMarkdown = icon("file-markdown", (
  <FileSheet hue="k">
    <path className="wh" d="M12.6 16.4v-3.2l1.2 1.4 1.2-1.4v3.2M16.6 13.2v3.2M15.8 15.6l.8.8.8-.8" />
  </FileSheet>
));

export const OiFileTypst = icon("file-typst", (
  <FileSheet hue="b">
    <path className="wh thick" d="M14.2 12.4v3.2a1.1 1.1 0 0 0 1.1 1.1h.9M13 13.8h3" />
  </FileSheet>
));

export const OiFileLatex = icon("file-latex", (
  <FileSheet hue="g">
    <path className="wh thick" d="M13 16.6l1.7-4.2 1.7 4.2" />
  </FileSheet>
));

export const OiFileText = icon("file-text", (
  <FileSheet hue="k">
    <path className="wh" d="M13 13.2h3.4M13 14.8h3.4M13 16.4h2.2" />
  </FileSheet>
));

export const OiFileSlides = icon("file-slides", (
  <FileSheet hue="n">
    <path className="wf" d="M14.5 12.4v2.4h2.4a2.4 2.4 0 1 1-2.4-2.4z" />
  </FileSheet>
));

export const OiTemplate = icon("template", (
  <>
    <rect className="of" x="2.4" y="2.4" width="15.2" height="15.2" rx="1.8" />
    <rect className="bs" x="4.4" y="4.4" width="11.2" height="3.2" rx="0.8" />
    <rect className="nw" x="4.4" y="9.4" width="5" height="6.2" rx="0.8" />
    <path className="o ln thick" d="M11.4 10.2h4.2M11.4 12.6h4.2M11.4 15h2.8" />
  </>
));

export const OiFigure = icon("figure", (
  <>
    <rect className="bf" x="2" y="3.4" width="16" height="13.2" rx="1.8" />
    <path className="gs" d="M2 14.2c2.8-3.6 5.8-4.6 8.8-2.6 1.7-1.5 4.3-2 7.2.3v2.9a1.8 1.8 0 0 1-1.8 1.8H3.8A1.8 1.8 0 0 1 2 14.8z" />
    <circle className="ys" cx="6.4" cy="7.6" r="1.7" />
    <rect className="b edge" x="2" y="3.4" width="16" height="13.2" rx="1.8" />
  </>
));

export const OiEpub = icon("epub", (
  <>
    <path className="ps" d="M1.8 5.4v11.2c3.6-.4 6.4 0 8.2 1.2 1.8-1.2 4.6-1.6 8.2-1.2V5.4z" />
    <path className="of" d="M10 5.2C8.4 4 6 3.6 2.6 3.8v11.4c3.4-.2 5.8.2 7.4 1.4z" />
    <path className="of" d="M10 5.2c1.6-1.2 4-1.6 7.4-1.4v11.4c-3.4-.2-5.8.2-7.4 1.4z" />
    <path className="o ln thick" d="M4.4 7h3.6M4.4 9.4h3.6M12 7h3.6M12 9.4h3.6M12 11.8h2.4" />
  </>
));

export const OiZen = icon("zen", (
  <>
    <path className="o thick" d="M2.6 6.4V4.2a1.6 1.6 0 0 1 1.6-1.6h2.2M13.6 2.6h2.2a1.6 1.6 0 0 1 1.6 1.6v2.2M17.4 13.6v2.2a1.6 1.6 0 0 1-1.6 1.6h-2.2M6.4 17.4H4.2a1.6 1.6 0 0 1-1.6-1.6v-2.2" />
    <circle className="ps" cx="10" cy="10" r="3.6" />
    <path className="gl" d="M7.9 9.4a2.2 2.2 0 0 1 1.3-1.4" />
  </>
));

export const OiFile = icon("file", (
  <>
    <path className="of" d={SHEET} />
    <path className="of" d={FOLD} />
    <path className="o ln thick" d="M5.3 6.2h4.2M5.3 8.8h5.4M5.3 11.4h5.4M5.3 14h3.4" />
  </>
));

export const OiFileBib = icon("file-bib", (
  <FileSheet hue="n">
    <path className="wh thick" d="M13.4 16c.7-.4 1-.9 1-1.8v-.9M15.9 16c.7-.4 1-.9 1-1.8v-.9" />
  </FileSheet>
));

export const OiFileJson = icon("file-json", (
  <FileSheet hue="y">
    <path className="wh" d="M14 12.4c-.8 0-1.1.4-1.1 1v.5c0 .5-.3.8-.8.8.5 0 .8.3.8.8v.5c0 .6.3 1 1.1 1M15.4 12.4c.8 0 1.1.4 1.1 1v.5c0 .5.3.8.8.8-.5 0-.8.3-.8.8v.5c0 .6-.3 1-1.1 1" />
  </FileSheet>
));

export const OiFileCode = icon("file-code", (
  <FileSheet hue="p">
    <path className="wh thick" d="M13.4 13.2 12 14.7l1.4 1.5M16 13.2l1.4 1.5-1.4 1.5" />
  </FileSheet>
));

export const OiFileConfig = icon("file-config", (
  <FileSheet hue="r">
    <path className="wh" d="M12.6 13.6h4.2M12.6 15.9h4.2" />
    <circle className="wf" cx="13.9" cy="13.6" r="0.75" />
    <circle className="wf" cx="15.6" cy="15.9" r="0.75" />
  </FileSheet>
));

export const OiFileGit = icon("file-git", (
  <FileSheet hue="n">
    <path className="wh" d="M13.5 13v3.4M13.5 14.6c1.7 0 2.6-.5 2.6-1.6" />
    <circle className="wf" cx="13.5" cy="12.9" r="0.7" />
    <circle className="wf" cx="13.5" cy="16.5" r="0.7" />
    <circle className="wf" cx="16.1" cy="12.9" r="0.7" />
  </FileSheet>
));
