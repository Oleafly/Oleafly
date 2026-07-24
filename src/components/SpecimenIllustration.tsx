export function SpecimenIllustration() {
  const layerCount = 13;
  const depth = 130;
  const top = { x: 210, y: 75 };
  const right = { x: 340, y: 140 };
  const bottom = { x: 210, y: 205 };
  const left = { x: 80, y: 140 };

  const rightLines = Array.from({ length: layerCount }, (_, i) => {
    const t = ((i + 1) / (layerCount + 1)) * depth;
    return { x1: right.x, y1: right.y + t, x2: bottom.x, y2: bottom.y + t };
  });
  const leftLines = Array.from({ length: layerCount }, (_, i) => {
    const t = ((i + 1) / (layerCount + 1)) * depth;
    return { x1: left.x, y1: left.y + t, x2: bottom.x, y2: bottom.y + t };
  });

  const leafPath =
    "M0,-72 C22,-60 34,-30 32,-4 C30,20 20,42 8,60 C4,66 2,70 0,74 C-2,70 -4,66 -8,60 C-20,42 -30,20 -32,-4 C-34,-30 -22,-60 0,-72 Z";
  const veinPath =
    "M0,-72 L0,88 M0,-30 L24,-8 M0,-30 L-24,-8 M0,0 L28,20 M0,0 L-28,20 M0,28 L22,44 M0,28 L-22,44";

  return (
    <svg viewBox="0 0 420 420" className="h-full w-full" role="img" aria-label="Decorative specimen diagram">
      <g stroke="white" strokeOpacity="0.5" strokeWidth="1" fill="none">
        <path d={`M${top.x},${top.y} L${right.x},${right.y} L${bottom.x},${bottom.y} L${left.x},${left.y} Z`} />
        <path
          d={`M${right.x},${right.y} L${bottom.x},${bottom.y} L${bottom.x},${bottom.y + depth} L${right.x},${right.y + depth} Z`}
          strokeOpacity="0.3"
        />
        <path
          d={`M${left.x},${left.y} L${bottom.x},${bottom.y} L${bottom.x},${bottom.y + depth} L${left.x},${left.y + depth} Z`}
          strokeOpacity="0.3"
        />
        {rightLines.map((l) => (
          <line key={`r-${l.y1}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeOpacity="0.15" />
        ))}
        {leftLines.map((l) => (
          <line key={`l-${l.y1}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeOpacity="0.15" />
        ))}
        <line x1={bottom.x} y1={bottom.y} x2={bottom.x} y2={bottom.y + depth} strokeOpacity="0.3" />
      </g>

      <g transform={`translate(${top.x},${(top.y + bottom.y) / 2 - 4}) scale(1,0.62)`}>
        <path d={leafPath} stroke="white" strokeOpacity="0.85" strokeWidth="1.1" fill="none" />
        <path d={veinPath} stroke="white" strokeOpacity="0.5" strokeWidth="0.6" />
      </g>

      <g fill="white" fillOpacity="0.7">
        <circle cx="205" cy="70" r="2" />
        <circle cx="300" cy="112" r="2" />
        <circle cx="110" cy="128" r="2" />
        <circle cx="185" cy="140" r="2" />
        <circle cx="298" cy="238" r="2" />
        <circle cx="211" cy="330" r="2" />
      </g>
      <g stroke="white" strokeOpacity="0.35" strokeWidth="0.75">
        <line x1="205" y1="70" x2="235" y2="55" />
        <line x1="300" y1="112" x2="345" y2="98" />
        <line x1="110" y1="128" x2="55" y2="128" />
        <line x1="298" y1="238" x2="345" y2="238" />
        <line x1="211" y1="330" x2="255" y2="345" />
      </g>

      <g fontFamily="ui-monospace, monospace" fontSize="9" fill="white" fillOpacity="0.65" letterSpacing="0.05em">
        <text x="240" y="52">A1</text>
        <text x="349" y="94">P5</text>
        <text x="352" y="107" fillOpacity="0.45" fontStyle="italic">
          *Quercus L.
        </text>
        <text x="15" y="124">SPECIMEN:</text>
        <text x="15" y="136" fillOpacity="0.45" fontStyle="italic">
          *Quercus L.
        </text>
        <text x="0" y="168">VEIN DENSITY:</text>
        <text x="0" y="180" fillOpacity="0.45">
          19.5 mm/mm²
        </text>
        <text x="349" y="234">S9</text>
        <text x="349" y="246" fillOpacity="0.45">
          LAYER 9/15
        </text>
        <text x="259" y="348">L12</text>
        <text x="259" y="360" fillOpacity="0.45">
          TRANSVERSE PLANE
        </text>
        <text x="259" y="372" fillOpacity="0.45">
          45x85mm
        </text>
      </g>
    </svg>
  );
}
