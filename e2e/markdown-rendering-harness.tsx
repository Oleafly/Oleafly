import { createRoot } from "react-dom/client";
import { Markdown } from "@/components/ui/markdown";
import "@/styles/globals.css";

const fixture = String.raw`
The attention update is

$$
\operatorname{Attention}(Q,K,V)=\operatorname{softmax}\!\left(\frac{QK^{\mathsf T}}{\sqrt{d_k}}\right)V
$$

Online softmax keeps

$$
m_i^{(t)}=\max\!\left(m_i^{(t-1)},m_{ij}^{(t)}\right)
$$

$$
\ell_i^{(t)}=e^{m_i^{(t-1)}-m_i^{(t)}}\ell_i^{(t-1)}+\sum_{j\in B_t}e^{s_{ij}-m_i^{(t)}}
$$

and the nested expectation is

$$
\mathbb E_{x\sim p(x)}\!\left[\left(\frac{\sum_{i=1}^{n}x_i^2}{\sqrt{1+e^{-\alpha x^2}}}\right)^{\!\beta}\right].
$$`;

const root = document.getElementById("root");
if (!root) throw new Error("Markdown fixture root is missing");

createRoot(root).render(
  <main className="mx-auto w-[48rem] max-w-full p-6 text-sm">
    <Markdown className="chat-markdown">{fixture}</Markdown>
  </main>,
);
document.body.dataset.fixtureState = "mounted";
