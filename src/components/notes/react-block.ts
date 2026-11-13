import { Component } from "lucide-react";
import { i18n } from "@/i18n";
import type { NoteBlockKind } from "./note-blocks";
import { paintScripted } from "./scripted-paint";

export const REACT_TEMPLATE = `import { useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function Growth() {
  const [rate, setRate] = useState(5);
  const points = Array.from({ length: 11 }, (_, year) => ({
    year,
    value: Math.round(100 * (1 + rate / 100) ** year),
  }));
  return (
    <div className="space-y-3 p-4">
      <label className="flex items-center gap-3 text-sm">
        Rate {rate}%
        <input type="range" min="0" max="20" value={rate} onChange={(event) => setRate(Number(event.target.value))} />
      </label>
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={points}>
            <XAxis dataKey="year" />
            <YAxis />
            <Tooltip />
            <Line dataKey="value" stroke="#2563eb" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}`;

export const reactBlock: NoteBlockKind = {
  name: "jsx",
  aliases: ["react", "tsx"],
  label: () => "React",
  icon: Component,
  paint: (preview, source, context) =>
    paintScripted(preview, source, context, {
      kind: "react",
      label: "React",
      scripted: true,
      loadingText: i18n.t(($) => $.notes.blocks.artifact.loading),
      failedText: i18n.t(($) => $.notes.blocks.artifact.loadFailed),
    }),
  still: "card",
  interactive: true,
  scripted: true,
  template: () => ({ info: "jsx", source: REACT_TEMPLATE }),
};
