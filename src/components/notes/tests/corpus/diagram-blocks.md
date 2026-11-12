---
title: Sensor board notes
tags: [hardware, figures]
---

# Sensor board

The pipeline below is drawn with D2; each stage hands its output on.

```d2
# Stages of the build
direction: right
vars: {
  accent: "#2563eb"
}
sensor: Sensor {shape: circle}
adc: "ADC (12 bit)"
mcu: MCU {
  style.stroke: ${accent}
  fw: |md
    **Firmware** with `ring buffer`
  |
}
sensor -> adc: analog
adc -> mcu.fw: samples
```

The front end is an RC filter:

```circuitikz
\usepackage[siunitx]{circuitikz}
% values from the bench test, 2026-11-02
\ctikzset{resistors/scale=0.8}

\begin{circuitikz}[american]
  \draw (0,0) to[sV, l=$V_\mathrm{in}$] (0,3)
    to[R, l=$R = 1\,\mathrm{k\Omega}$] (3,3)
    to[C, l_=$C$, v^=$V_\mathrm{out}$] (3,0) -- (0,0);
\end{circuitikz}
```

And the state machine, in TikZ:

```tikz
\usetikzlibrary{automata, positioning, arrows.meta}
\begin{tikzpicture}[->, >={Stealth[round]}, node distance=2.5cm, every state/.style={thick}]
  \node[state, initial] (idle) {$q_0$};
  \node[state, right=of idle] (read) {$q_1$};
  \path (idle) edge[bend left] node[above] {\texttt{start}} (read)
        (read) edge[bend left] node[below] {$\{x \mid x > 0\}$} (idle);
\end{tikzpicture}
```

Measured gain stays flat up to 1 kHz.
