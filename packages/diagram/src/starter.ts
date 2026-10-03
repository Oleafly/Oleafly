import { type DiagramModel, type EdgeRouting, newId } from "@oleafly/latex";

export function starterModel(): DiagramModel {
  const STROKE = "#1e293b";
  const INK = "#0f172a";
  const PINK = "#f9d7d9";
  const ORANGE = "#fde3c7";
  const YELLOW_GREEN = "#eef2c3";
  const BLUE = "#cfe8f8";
  const PURPLE = "#dad2f0";
  const GREEN = "#cdedd0";
  const GREY = "#e9e9ec";

  const BW = 170, BH = 46;
  const ENC_CX = 250, DEC_CX = 650;
  const box = (
    cx: number,
    y: number,
    label: string,
    fill: string,
    w = BW,
    h = BH,
  ) => ({
    id: newId(),
    shape: "rectangle" as const,
    x: cx - w / 2,
    y,
    w,
    h,
    label,
    fill,
    stroke: STROKE,
    textColor: INK,
    radius: 4,
  });
  const text = (cx: number, y: number, label: string, w = 170, h = 40) => ({
    id: newId(),
    shape: "text" as const,
    x: cx - w / 2,
    y,
    w,
    h,
    label,
    fill: "",
    stroke: "",
    textColor: INK,
  });
  const circle = (cx: number, y: number, label = "") => ({
    id: newId(),
    shape: "circle" as const,
    x: cx - 17,
    y,
    w: 34,
    h: 34,
    label,
    fill: "#ffffff",
    stroke: STROKE,
    textColor: INK,
  });
  const bg = (x: number, y: number, w: number, h: number) => ({
    id: newId(),
    shape: "roundrect" as const,
    x,
    y,
    w,
    h,
    label: "",
    fill: GREY,
    stroke: "#c7c7cc",
    textColor: INK,
    radius: 16,
  });

  const encInputs = text(ENC_CX, 850, "Inputs");
  const encEmbed = box(ENC_CX, 780, "Input Embedding", PINK);
  const encPosCircle = circle(ENC_CX - 80, 710);
  const encPlusCircle = circle(ENC_CX, 710, "+");
  const encPosText = text(ENC_CX - 145, 755, "Positional Encoding", 140, 40);
  const encMHA = box(ENC_CX, 630, "Multi-Head Attention", ORANGE);
  const encAddNorm1 = box(ENC_CX, 560, "Add & Norm", YELLOW_GREEN);
  const encFF = box(ENC_CX, 480, "Feed Forward", BLUE);
  const encAddNorm2 = box(ENC_CX, 410, "Add & Norm", YELLOW_GREEN);
  const encNxBg = bg(ENC_CX - BW / 2 - 25, 390, BW + 50, 306);
  const encNxLabel = text(ENC_CX - BW / 2 - 90, 528, "N×", 50, 30);

  const decOutputs = text(DEC_CX, 850, "Outputs (shifted right)");
  const decEmbed = box(DEC_CX, 780, "Output Embedding", PINK);
  const decPlusCircle = circle(DEC_CX, 710, "+");
  const decPosCircle = circle(DEC_CX + 80, 710);
  const decPosText = text(DEC_CX + 145, 755, "Positional Encoding", 140, 40);
  const decMaskedMHA = box(DEC_CX, 630, "Masked Multi-Head Attention", ORANGE);
  const decAddNorm1 = box(DEC_CX, 560, "Add & Norm", YELLOW_GREEN);
  const decMHA = box(DEC_CX, 480, "Multi-Head Attention", ORANGE);
  const decAddNorm2 = box(DEC_CX, 410, "Add & Norm", YELLOW_GREEN);
  const decFF = box(DEC_CX, 330, "Feed Forward", BLUE);
  const decAddNorm3 = box(DEC_CX, 260, "Add & Norm", YELLOW_GREEN);
  const decNxBg = bg(DEC_CX - BW / 2 - 25, 240, BW + 50, 456);
  const decNxLabel = text(DEC_CX + BW / 2 + 40, 458, "N×", 50, 30);
  const decLinear = box(DEC_CX, 170, "Linear", PURPLE, BW, 44);
  const decSoftmax = box(DEC_CX, 90, "Softmax", GREEN, BW, 44);
  const decOutputProbs = text(DEC_CX, 10, "Output Probabilities", 180, 50);

  const nodes = [
    encNxBg,
    decNxBg,
    encInputs,
    encEmbed,
    encPosCircle,
    encPlusCircle,
    encPosText,
    encMHA,
    encAddNorm1,
    encFF,
    encAddNorm2,
    encNxLabel,
    decOutputs,
    decEmbed,
    decPlusCircle,
    decPosCircle,
    decPosText,
    decMaskedMHA,
    decAddNorm1,
    decMHA,
    decAddNorm2,
    decFF,
    decAddNorm3,
    decNxLabel,
    decLinear,
    decSoftmax,
    decOutputProbs,
  ];

  const link = (
    source: { id: string },
    target: { id: string },
    opts: { routing?: EdgeRouting; sourceHandle?: string; targetHandle?: string } = {},
  ) => ({
    id: newId("e"),
    source: source.id,
    target: target.id,
    routing: opts.routing ?? ("orthogonal" as EdgeRouting),
    arrow: "forward" as const,
    style: "solid" as const,
    sourceHandle: opts.sourceHandle ?? "t",
    targetHandle: opts.targetHandle ?? "b",
  });

  const edges = [
    link(encInputs, encEmbed),
    link(encEmbed, encPlusCircle),
    link(encPosCircle, encPlusCircle, { routing: "curved", sourceHandle: "r", targetHandle: "l" }),
    link(encPlusCircle, encMHA),
    link(encMHA, encAddNorm1),
    link(encAddNorm1, encFF),
    link(encFF, encAddNorm2),
    link(decOutputs, decEmbed),
    link(decEmbed, decPlusCircle),
    link(decPosCircle, decPlusCircle, { routing: "curved", sourceHandle: "l", targetHandle: "r" }),
    link(decPlusCircle, decMaskedMHA),
    link(decMaskedMHA, decAddNorm1),
    link(decAddNorm1, decMHA),
    link(decMHA, decAddNorm2),
    link(decAddNorm2, decFF),
    link(decFF, decAddNorm3),
    link(decAddNorm3, decLinear),
    link(decLinear, decSoftmax),
    link(decSoftmax, decOutputProbs),
    link(encAddNorm2, decMHA, { sourceHandle: "r", targetHandle: "l" }),
    link(encPlusCircle, encAddNorm1, { sourceHandle: "l", targetHandle: "l" }),
    link(encAddNorm1, encAddNorm2, { sourceHandle: "l", targetHandle: "l" }),
    link(decPlusCircle, decAddNorm1, { sourceHandle: "r", targetHandle: "r" }),
    link(decAddNorm1, decAddNorm2, { sourceHandle: "r", targetHandle: "r" }),
    link(decAddNorm2, decAddNorm3, { sourceHandle: "r", targetHandle: "r" }),
  ];

  return { version: 1, nodes, edges };
}

