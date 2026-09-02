import type { ChatMessage } from "@/store/chats";

export const HEAVY_CONVERSATION_COUNTS = {
  assistantMessages: 6,
  displayEquations: 84,
  mermaidDiagrams: 8,
  codeBlocks: 12,
} as const;

const EQUATIONS = [
  String.raw`\operatorname{Attention}(Q,K,V)=\operatorname{softmax}\!\left(\frac{QK^{\mathsf T}}{\sqrt{d_k}}\right)V`,
  String.raw`m_i^{(t)}=\max\!\left(m_i^{(t-1)},\max_{j\in B_t} s_{ij}\right)`,
  String.raw`\ell_i^{(t)}=e^{m_i^{(t-1)}-m_i^{(t)}}\ell_i^{(t-1)}+\sum_{j\in B_t}e^{s_{ij}-m_i^{(t)}}`,
  String.raw`\mathbb E_{x\sim p(x)}\!\left[\left(\frac{\sum_{i=1}^{n}x_i^2}{\sqrt{1+e^{-\alpha x^2}}}\right)^{\!\beta}\right]`,
  String.raw`\mathcal L(\theta)=-\frac{1}{N}\sum_{n=1}^{N}\sum_{t=1}^{T_n}\log p_\theta\!\left(y_{n,t}\mid y_{n,<t},x_n\right)`,
  String.raw`\begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix}\begin{pmatrix} x \\ y \\ z \end{pmatrix}=\begin{pmatrix} b_1 \\ b_2 \\ b_3 \end{pmatrix}`,
  String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,dx=\sqrt{\pi}\qquad \int_0^1 \frac{\ln(1+x)}{x}\,dx=\frac{\pi^2}{12}`,
  String.raw`\nabla_\theta J(\theta)=\mathbb E_{\tau\sim\pi_\theta}\!\left[\sum_{t=0}^{T}\nabla_\theta\log\pi_\theta(a_t\mid s_t)\,\hat A_t\right]`,
  String.raw`\hat\beta=(X^{\mathsf T}X)^{-1}X^{\mathsf T}y,\qquad \operatorname{Var}(\hat\beta)=\sigma^2(X^{\mathsf T}X)^{-1}`,
  String.raw`\frac{\partial u}{\partial t}=\kappa\left(\frac{\partial^2 u}{\partial x^2}+\frac{\partial^2 u}{\partial y^2}\right)+f(x,y,t)`,
  String.raw`P(A\mid B)=\frac{P(B\mid A)\,P(A)}{\sum_{k} P(B\mid A_k)\,P(A_k)}`,
  String.raw`\lim_{n\to\infty}\left(1+\frac{x}{n}\right)^{n}=\sum_{k=0}^{\infty}\frac{x^k}{k!}=e^{x}`,
  String.raw`\mathbf{h}_t=\sigma\!\left(W_{xh}\mathbf{x}_t+W_{hh}\mathbf{h}_{t-1}+\mathbf{b}_h\right),\quad \mathbf{y}_t=W_{hy}\mathbf{h}_t+\mathbf{b}_y`,
  String.raw`\operatorname{KL}(p\,\|\,q)=\sum_{x}p(x)\log\frac{p(x)}{q(x)}\ge 0`,
];

const DIAGRAMS = [
  "flowchart TD\n  A[Load corpus] --> B{Tokenize}\n  B --> C[Embed]\n  C --> D[Attention stack]\n  D --> E[Decode]\n  E --> F[Evaluate]",
  "sequenceDiagram\n  participant U as User\n  participant A as Assistant\n  participant C as Compiler\n  U->>A: Fix the citation\n  A->>C: compile\n  C-->>A: log\n  A-->>U: summary",
  "flowchart LR\n  S[Source .tex] --> P[Preflight]\n  P --> T[Tectonic]\n  T --> PDF[PDF]\n  PDF --> V[Verify pages]",
  "classDiagram\n  class Engine {\n    +compile()\n    +features\n  }\n  class LaTeX\n  class Typst\n  Engine <|-- LaTeX\n  Engine <|-- Typst",
  "flowchart TD\n  Q[Query] --> R[Retriever]\n  R --> K[Top-k chunks]\n  K --> G[Generator]\n  G --> O[Answer]",
  "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Streaming: send\n  Streaming --> Idle: done\n  Streaming --> Stopped: abort\n  Stopped --> [*]",
  "flowchart LR\n  a((x)) --> b[Encoder]\n  b --> c[Latent z]\n  c --> d[Decoder]\n  d --> e((x'))",
  "gantt\n  title Revision plan\n  dateFormat YYYY-MM-DD\n  section Draft\n  Related work :a1, 2026-09-01, 3d\n  Experiments :a2, after a1, 4d",
];

const CODE_BLOCKS = [
  {
    language: "tex",
    body: String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,graphicx}
\begin{document}
\section{Attention}
The scaled dot-product attention is
\begin{equation}
  \mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
\end{equation}
\end{document}`,
  },
  {
    language: "bib",
    body: `@article{vaswani2017attention,
  title   = {Attention is all you need},
  author  = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  journal = {Advances in Neural Information Processing Systems},
  volume  = {30},
  year    = {2017}
}`,
  },
  {
    language: "js",
    body: `export function softmax(scores) {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}`,
  },
  {
    language: "txt",
    body: `run 1: loss 2.41 ppl 11.1
run 2: loss 2.02 ppl 7.5
run 3: loss 1.88 ppl 6.6
run 4: loss 1.79 ppl 6.0`,
  },
  {
    language: "cls",
    body: String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{labnote}[2026/09/01 Lab notes]
\LoadClass[11pt]{article}
\RequirePackage{geometry}
\geometry{margin=1in}
\newcommand{\experiment}[1]{\section*{Experiment: #1}}`,
  },
  {
    language: "tex",
    body: String.raw`\begin{table}[t]
  \centering
  \begin{tabular}{lcc}
    \toprule
    Model & BLEU & Params \\
    \midrule
    Base & 27.3 & 65M \\
    Big & 28.4 & 213M \\
    \bottomrule
  \end{tabular}
  \caption{Translation quality on WMT14.}
\end{table}`,
  },
];

function equationBlock(index: number) {
  const body = EQUATIONS[index % EQUATIONS.length];
  return `$$\n${body}\\tag{${index + 1}}\n$$`;
}

function codeFence(index: number) {
  const block = CODE_BLOCKS[index % CODE_BLOCKS.length];
  return `\`\`\`${block.language}\n${block.body}\n\`\`\``;
}

function diagramFence(index: number) {
  return `\`\`\`mermaid\n${DIAGRAMS[index % DIAGRAMS.length]}\n\`\`\``;
}

function share(count: number, messageIndex: number, total: number) {
  return {
    from: Math.floor((messageIndex * count) / total),
    to: Math.floor(((messageIndex + 1) * count) / total),
  };
}

function assistantReply(messageIndex: number, total: number) {
  const equations = share(HEAVY_CONVERSATION_COUNTS.displayEquations, messageIndex, total);
  const diagrams = share(HEAVY_CONVERSATION_COUNTS.mermaidDiagrams, messageIndex, total);
  const codes = share(HEAVY_CONVERSATION_COUNTS.codeBlocks, messageIndex, total);
  const parts: string[] = [];
  parts.push(`## Section ${messageIndex + 1}: derivation and setup`);
  parts.push(
    `Here is the derivation you asked for, with the intermediate steps kept explicit so each line is checkable. The inline form $x_i^{(t)}$ refers to the running estimate and $\\ell_i^{(t)}$ to the normalizer.`,
  );
  let diagram = diagrams.from;
  let code = codes.from;
  for (let equation = equations.from; equation < equations.to; equation++) {
    const step = equation - equations.from;
    parts.push(`**Step ${step + 1}.** Substituting the previous bound and simplifying gives`);
    parts.push(equationBlock(equation));
    if ((step === 3 || step === 8) && diagram < diagrams.to) {
      parts.push("The data flow for this stage is:");
      parts.push(diagramFence(diagram++));
    }
    if ((step === 6 || step === 10) && code < codes.to) {
      parts.push("The corresponding source is:");
      parts.push(codeFence(code++));
    }
  }
  while (diagram < diagrams.to) parts.push(diagramFence(diagram++));
  while (code < codes.to) parts.push(codeFence(code++));
  parts.push("| Quantity | Symbol | Notes |\n| --- | --- | --- |\n| Learning rate | $\\eta$ | warm up over 4k steps |\n| Batch size | $B$ | tokens per step |");
  parts.push("- Verify the tagged equation numbers match the manuscript.\n- Recompile after the table edit.\n- Re-run `verify_pdf_pages` on the affected pages.");
  return parts.join("\n\n");
}

export function buildHeavyConversation(): ChatMessage[] {
  const total = HEAVY_CONVERSATION_COUNTS.assistantMessages;
  const messages: ChatMessage[] = [];
  const base = Date.UTC(2026, 8, 1, 9, 0, 0);
  for (let index = 0; index < total; index++) {
    messages.push({
      id: `user-${index}`,
      role: "user",
      content: `Walk me through section ${index + 1} with every step written out, and include the diagrams and source.`,
      createdAt: base + index * 120_000,
    });
    messages.push({
      id: `assistant-${index}`,
      role: "assistant",
      content: assistantReply(index, total),
      createdAt: base + index * 120_000 + 60_000,
      reasoningBlocks: [
        { id: `reasoning-${index}`, text: "Check the bound, then write the steps.", ms: 1400, beforeTool: 0 },
      ],
      toolCalls: [
        { id: `tool-${index}`, name: "read_file", status: "done", output: '{"success": true, "content": "..."}' },
      ],
    });
  }
  return messages;
}
