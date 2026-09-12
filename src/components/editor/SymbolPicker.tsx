import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Omega } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "@/components/editor/cm/controller";

export interface ToolbarSymbol {
  char: string;
  latex: string;
  name: () => string;
}

export interface SymbolCategory {
  id: string;
  label: () => string;
  items: ToolbarSymbol[];
}

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    id: "greek-lower",
    label: () => i18n.t(($) => $.symbols.categories.greekLower),
    items: [
      { char: "α", latex: String.raw`\alpha`, name: () => i18n.t(($) => $.symbols.names.greekLower.alpha) },
      { char: "β", latex: String.raw`\beta`, name: () => i18n.t(($) => $.symbols.names.greekLower.beta) },
      { char: "γ", latex: String.raw`\gamma`, name: () => i18n.t(($) => $.symbols.names.greekLower.gamma) },
      { char: "δ", latex: String.raw`\delta`, name: () => i18n.t(($) => $.symbols.names.greekLower.delta) },
      { char: "ϵ", latex: String.raw`\epsilon`, name: () => i18n.t(($) => $.symbols.names.greekLower.epsilon) },
      { char: "ε", latex: String.raw`\varepsilon`, name: () => i18n.t(($) => $.symbols.names.greekLower.varepsilon) },
      { char: "ζ", latex: String.raw`\zeta`, name: () => i18n.t(($) => $.symbols.names.greekLower.zeta) },
      { char: "η", latex: String.raw`\eta`, name: () => i18n.t(($) => $.symbols.names.greekLower.eta) },
      { char: "θ", latex: String.raw`\theta`, name: () => i18n.t(($) => $.symbols.names.greekLower.theta) },
      { char: "ϑ", latex: String.raw`\vartheta`, name: () => i18n.t(($) => $.symbols.names.greekLower.vartheta) },
      { char: "ι", latex: String.raw`\iota`, name: () => i18n.t(($) => $.symbols.names.greekLower.iota) },
      { char: "κ", latex: String.raw`\kappa`, name: () => i18n.t(($) => $.symbols.names.greekLower.kappa) },
      { char: "λ", latex: String.raw`\lambda`, name: () => i18n.t(($) => $.symbols.names.greekLower.lambda) },
      { char: "μ", latex: String.raw`\mu`, name: () => i18n.t(($) => $.symbols.names.greekLower.mu) },
      { char: "ν", latex: String.raw`\nu`, name: () => i18n.t(($) => $.symbols.names.greekLower.nu) },
      { char: "ξ", latex: String.raw`\xi`, name: () => i18n.t(($) => $.symbols.names.greekLower.xi) },
      { char: "π", latex: String.raw`\pi`, name: () => i18n.t(($) => $.symbols.names.greekLower.pi) },
      { char: "ϖ", latex: String.raw`\varpi`, name: () => i18n.t(($) => $.symbols.names.greekLower.varpi) },
      { char: "ρ", latex: String.raw`\rho`, name: () => i18n.t(($) => $.symbols.names.greekLower.rho) },
      { char: "ϱ", latex: String.raw`\varrho`, name: () => i18n.t(($) => $.symbols.names.greekLower.varrho) },
      { char: "σ", latex: String.raw`\sigma`, name: () => i18n.t(($) => $.symbols.names.greekLower.sigma) },
      { char: "ς", latex: String.raw`\varsigma`, name: () => i18n.t(($) => $.symbols.names.greekLower.varsigma) },
      { char: "τ", latex: String.raw`\tau`, name: () => i18n.t(($) => $.symbols.names.greekLower.tau) },
      { char: "υ", latex: String.raw`\upsilon`, name: () => i18n.t(($) => $.symbols.names.greekLower.upsilon) },
      { char: "ϕ", latex: String.raw`\phi`, name: () => i18n.t(($) => $.symbols.names.greekLower.phi) },
      { char: "φ", latex: String.raw`\varphi`, name: () => i18n.t(($) => $.symbols.names.greekLower.varphi) },
      { char: "χ", latex: String.raw`\chi`, name: () => i18n.t(($) => $.symbols.names.greekLower.chi) },
      { char: "ψ", latex: String.raw`\psi`, name: () => i18n.t(($) => $.symbols.names.greekLower.psi) },
      { char: "ω", latex: String.raw`\omega`, name: () => i18n.t(($) => $.symbols.names.greekLower.omega) },
    ],
  },
  {
    id: "greek-upper",
    label: () => i18n.t(($) => $.symbols.categories.greekUpper),
    items: [
      { char: "Γ", latex: String.raw`\Gamma`, name: () => i18n.t(($) => $.symbols.names.greekUpper.gamma) },
      { char: "Δ", latex: String.raw`\Delta`, name: () => i18n.t(($) => $.symbols.names.greekUpper.delta) },
      { char: "Θ", latex: String.raw`\Theta`, name: () => i18n.t(($) => $.symbols.names.greekUpper.theta) },
      { char: "Λ", latex: String.raw`\Lambda`, name: () => i18n.t(($) => $.symbols.names.greekUpper.lambda) },
      { char: "Ξ", latex: String.raw`\Xi`, name: () => i18n.t(($) => $.symbols.names.greekUpper.xi) },
      { char: "Π", latex: String.raw`\Pi`, name: () => i18n.t(($) => $.symbols.names.greekUpper.pi) },
      { char: "Σ", latex: String.raw`\Sigma`, name: () => i18n.t(($) => $.symbols.names.greekUpper.sigma) },
      { char: "Υ", latex: String.raw`\Upsilon`, name: () => i18n.t(($) => $.symbols.names.greekUpper.upsilon) },
      { char: "Φ", latex: String.raw`\Phi`, name: () => i18n.t(($) => $.symbols.names.greekUpper.phi) },
      { char: "Ψ", latex: String.raw`\Psi`, name: () => i18n.t(($) => $.symbols.names.greekUpper.psi) },
      { char: "Ω", latex: String.raw`\Omega`, name: () => i18n.t(($) => $.symbols.names.greekUpper.omega) },
    ],
  },
  {
    id: "operators",
    label: () => i18n.t(($) => $.symbols.categories.operators),
    items: [
      { char: "+", latex: "+", name: () => i18n.t(($) => $.symbols.names.operators.plus) },
      { char: "−", latex: "-", name: () => i18n.t(($) => $.symbols.names.operators.minus) },
      { char: "×", latex: String.raw`\times`, name: () => i18n.t(($) => $.symbols.names.operators.times) },
      { char: "÷", latex: String.raw`\div`, name: () => i18n.t(($) => $.symbols.names.operators.division) },
      { char: "⋅", latex: String.raw`\cdot`, name: () => i18n.t(($) => $.symbols.names.operators.centeredDot) },
      { char: "±", latex: String.raw`\pm`, name: () => i18n.t(($) => $.symbols.names.operators.plusMinus) },
      { char: "∓", latex: String.raw`\mp`, name: () => i18n.t(($) => $.symbols.names.operators.minusPlus) },
      { char: "∗", latex: String.raw`\ast`, name: () => i18n.t(($) => $.symbols.names.operators.asterisk) },
      { char: "⋆", latex: String.raw`\star`, name: () => i18n.t(($) => $.symbols.names.operators.star) },
      { char: "∘", latex: String.raw`\circ`, name: () => i18n.t(($) => $.symbols.names.operators.circle) },
      { char: "•", latex: String.raw`\bullet`, name: () => i18n.t(($) => $.symbols.names.operators.bullet) },
      { char: "⊕", latex: String.raw`\oplus`, name: () => i18n.t(($) => $.symbols.names.operators.circledPlus) },
      { char: "⊖", latex: String.raw`\ominus`, name: () => i18n.t(($) => $.symbols.names.operators.circledMinus) },
      { char: "⊗", latex: String.raw`\otimes`, name: () => i18n.t(($) => $.symbols.names.operators.circledTimes) },
      { char: "⊙", latex: String.raw`\odot`, name: () => i18n.t(($) => $.symbols.names.operators.circledDot) },
      { char: "†", latex: String.raw`\dagger`, name: () => i18n.t(($) => $.symbols.names.operators.dagger) },
      { char: "‡", latex: String.raw`\ddagger`, name: () => i18n.t(($) => $.symbols.names.operators.doubleDagger) },
      { char: "∇", latex: String.raw`\nabla`, name: () => i18n.t(($) => $.symbols.names.operators.nablaDel) },
      { char: "∂", latex: String.raw`\partial`, name: () => i18n.t(($) => $.symbols.names.operators.partialDerivative) },
    ],
  },
  {
    id: "relations",
    label: () => i18n.t(($) => $.symbols.categories.relations),
    items: [
      { char: "=", latex: "=", name: () => i18n.t(($) => $.symbols.names.relations.equals) },
      { char: "≠", latex: String.raw`\neq`, name: () => i18n.t(($) => $.symbols.names.relations.notEqual) },
      { char: "<", latex: "<", name: () => i18n.t(($) => $.symbols.names.relations.lessThan) },
      { char: ">", latex: ">", name: () => i18n.t(($) => $.symbols.names.relations.greaterThan) },
      { char: "≤", latex: String.raw`\leq`, name: () => i18n.t(($) => $.symbols.names.relations.lessOrEqual) },
      { char: "≥", latex: String.raw`\geq`, name: () => i18n.t(($) => $.symbols.names.relations.greaterOrEqual) },
      { char: "≪", latex: String.raw`\ll`, name: () => i18n.t(($) => $.symbols.names.relations.muchLess) },
      { char: "≫", latex: String.raw`\gg`, name: () => i18n.t(($) => $.symbols.names.relations.muchGreater) },
      { char: "≈", latex: String.raw`\approx`, name: () => i18n.t(($) => $.symbols.names.relations.approximately) },
      { char: "∼", latex: String.raw`\sim`, name: () => i18n.t(($) => $.symbols.names.relations.similarTilde) },
      { char: "≃", latex: String.raw`\simeq`, name: () => i18n.t(($) => $.symbols.names.relations.asymptoticallyEqual) },
      { char: "≅", latex: String.raw`\cong`, name: () => i18n.t(($) => $.symbols.names.relations.congruent) },
      { char: "≡", latex: String.raw`\equiv`, name: () => i18n.t(($) => $.symbols.names.relations.identicalEquivalent) },
      { char: "∝", latex: String.raw`\propto`, name: () => i18n.t(($) => $.symbols.names.relations.proportionalTo) },
      { char: "≺", latex: String.raw`\prec`, name: () => i18n.t(($) => $.symbols.names.relations.precedes) },
      { char: "≻", latex: String.raw`\succ`, name: () => i18n.t(($) => $.symbols.names.relations.succeeds) },
      { char: "⪯", latex: String.raw`\preceq`, name: () => i18n.t(($) => $.symbols.names.relations.precedesOrEqual) },
      { char: "⪰", latex: String.raw`\succeq`, name: () => i18n.t(($) => $.symbols.names.relations.succeedsOrEqual) },
      { char: "⊥", latex: String.raw`\perp`, name: () => i18n.t(($) => $.symbols.names.relations.perpendicular) },
      { char: "∥", latex: String.raw`\parallel`, name: () => i18n.t(($) => $.symbols.names.relations.parallel) },
      { char: "∣", latex: String.raw`\mid`, name: () => i18n.t(($) => $.symbols.names.relations.dividesMid) },
    ],
  },
  {
    id: "arrows",
    label: () => i18n.t(($) => $.symbols.categories.arrows),
    items: [
      { char: "←", latex: String.raw`\leftarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.leftArrow) },
      { char: "→", latex: String.raw`\rightarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.rightArrow) },
      { char: "↑", latex: String.raw`\uparrow`, name: () => i18n.t(($) => $.symbols.names.arrows.upArrow) },
      { char: "↓", latex: String.raw`\downarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.downArrow) },
      { char: "↔", latex: String.raw`\leftrightarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.leftRightArrow) },
      { char: "⇐", latex: String.raw`\Leftarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.doubleLeftArrow) },
      { char: "⇒", latex: String.raw`\Rightarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.doubleRightArrowImplies) },
      { char: "⇑", latex: String.raw`\Uparrow`, name: () => i18n.t(($) => $.symbols.names.arrows.doubleUpArrow) },
      { char: "⇓", latex: String.raw`\Downarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.doubleDownArrow) },
      { char: "⇔", latex: String.raw`\Leftrightarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.doubleLeftRightIff) },
      { char: "↦", latex: String.raw`\mapsto`, name: () => i18n.t(($) => $.symbols.names.arrows.mapsTo) },
      { char: "⟼", latex: String.raw`\longmapsto`, name: () => i18n.t(($) => $.symbols.names.arrows.longMapsTo) },
      { char: "⟶", latex: String.raw`\longrightarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.longRightArrow) },
      { char: "⟵", latex: String.raw`\longleftarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.longLeftArrow) },
      { char: "↪", latex: String.raw`\hookrightarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.hookRightArrow) },
      { char: "↩", latex: String.raw`\hookleftarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.hookLeftArrow) },
      { char: "↗", latex: String.raw`\nearrow`, name: () => i18n.t(($) => $.symbols.names.arrows.neArrow) },
      { char: "↘", latex: String.raw`\searrow`, name: () => i18n.t(($) => $.symbols.names.arrows.seArrow) },
      { char: "↖", latex: String.raw`\nwarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.nwArrow) },
      { char: "↙", latex: String.raw`\swarrow`, name: () => i18n.t(($) => $.symbols.names.arrows.swArrow) },
      { char: "⇌", latex: String.raw`\rightleftharpoons`, name: () => i18n.t(($) => $.symbols.names.arrows.equilibriumHarpoons) },
      { char: "↼", latex: String.raw`\leftharpoonup`, name: () => i18n.t(($) => $.symbols.names.arrows.leftHarpoon) },
      { char: "⇀", latex: String.raw`\rightharpoonup`, name: () => i18n.t(($) => $.symbols.names.arrows.rightHarpoon) },
    ],
  },
  {
    id: "sets",
    label: () => i18n.t(($) => $.symbols.categories.sets),
    items: [
      { char: "∈", latex: String.raw`\in`, name: () => i18n.t(($) => $.symbols.names.sets.elementOf) },
      { char: "∉", latex: String.raw`\notin`, name: () => i18n.t(($) => $.symbols.names.sets.notElementOf) },
      { char: "∋", latex: String.raw`\ni`, name: () => i18n.t(($) => $.symbols.names.sets.containsAsMember) },
      { char: "⊂", latex: String.raw`\subset`, name: () => i18n.t(($) => $.symbols.names.sets.subset) },
      { char: "⊃", latex: String.raw`\supset`, name: () => i18n.t(($) => $.symbols.names.sets.superset) },
      { char: "⊆", latex: String.raw`\subseteq`, name: () => i18n.t(($) => $.symbols.names.sets.subsetOrEqual) },
      { char: "⊇", latex: String.raw`\supseteq`, name: () => i18n.t(($) => $.symbols.names.sets.supersetOrEqual) },
      { char: "∪", latex: String.raw`\cup`, name: () => i18n.t(($) => $.symbols.names.sets.union) },
      { char: "∩", latex: String.raw`\cap`, name: () => i18n.t(($) => $.symbols.names.sets.intersection) },
      { char: "⋃", latex: String.raw`\bigcup`, name: () => i18n.t(($) => $.symbols.names.sets.bigUnion) },
      { char: "⋂", latex: String.raw`\bigcap`, name: () => i18n.t(($) => $.symbols.names.sets.bigIntersection) },
      { char: "∖", latex: String.raw`\setminus`, name: () => i18n.t(($) => $.symbols.names.sets.setMinus) },
      { char: "∅", latex: String.raw`\emptyset`, name: () => i18n.t(($) => $.symbols.names.sets.emptySet) },
      { char: "∅", latex: String.raw`\varnothing`, name: () => i18n.t(($) => $.symbols.names.sets.emptySetVariant) },
      { char: "ℕ", latex: String.raw`\mathbb{N}`, name: () => i18n.t(($) => $.symbols.names.sets.naturalNumbers) },
      { char: "ℤ", latex: String.raw`\mathbb{Z}`, name: () => i18n.t(($) => $.symbols.names.sets.integers) },
      { char: "ℚ", latex: String.raw`\mathbb{Q}`, name: () => i18n.t(($) => $.symbols.names.sets.rationals) },
      { char: "ℝ", latex: String.raw`\mathbb{R}`, name: () => i18n.t(($) => $.symbols.names.sets.realNumbers) },
      { char: "ℂ", latex: String.raw`\mathbb{C}`, name: () => i18n.t(($) => $.symbols.names.sets.complexNumbers) },
    ],
  },
  {
    id: "logic",
    label: () => i18n.t(($) => $.symbols.categories.logic),
    items: [
      { char: "∀", latex: String.raw`\forall`, name: () => i18n.t(($) => $.symbols.names.logic.forAll) },
      { char: "∃", latex: String.raw`\exists`, name: () => i18n.t(($) => $.symbols.names.logic.exists) },
      { char: "∄", latex: String.raw`\nexists`, name: () => i18n.t(($) => $.symbols.names.logic.doesNotExist) },
      { char: "¬", latex: String.raw`\neg`, name: () => i18n.t(($) => $.symbols.names.logic.negation) },
      { char: "∧", latex: String.raw`\land`, name: () => i18n.t(($) => $.symbols.names.logic.logicalAnd) },
      { char: "∨", latex: String.raw`\lor`, name: () => i18n.t(($) => $.symbols.names.logic.logicalOr) },
      { char: "∧", latex: String.raw`\wedge`, name: () => i18n.t(($) => $.symbols.names.logic.wedge) },
      { char: "∨", latex: String.raw`\vee`, name: () => i18n.t(($) => $.symbols.names.logic.vee) },
      { char: "⟹", latex: String.raw`\implies`, name: () => i18n.t(($) => $.symbols.names.logic.implies) },
      { char: "⟺", latex: String.raw`\iff`, name: () => i18n.t(($) => $.symbols.names.logic.ifAndOnlyIf) },
      { char: "∴", latex: String.raw`\therefore`, name: () => i18n.t(($) => $.symbols.names.logic.therefore) },
      { char: "∵", latex: String.raw`\because`, name: () => i18n.t(($) => $.symbols.names.logic.because) },
      { char: "⊤", latex: String.raw`\top`, name: () => i18n.t(($) => $.symbols.names.logic.topTrue) },
      { char: "⊥", latex: String.raw`\bot`, name: () => i18n.t(($) => $.symbols.names.logic.bottomFalse) },
      { char: "⊢", latex: String.raw`\vdash`, name: () => i18n.t(($) => $.symbols.names.logic.provesTurnstile) },
      { char: "⊨", latex: String.raw`\models`, name: () => i18n.t(($) => $.symbols.names.logic.modelsEntails) },
    ],
  },
  {
    id: "calculus",
    label: () => i18n.t(($) => $.symbols.categories.calculus),
    items: [
      { char: "∫", latex: String.raw`\int`, name: () => i18n.t(($) => $.symbols.names.calculus.integral) },
      { char: "∬", latex: String.raw`\iint`, name: () => i18n.t(($) => $.symbols.names.calculus.doubleIntegral) },
      { char: "∭", latex: String.raw`\iiint`, name: () => i18n.t(($) => $.symbols.names.calculus.tripleIntegral) },
      { char: "∮", latex: String.raw`\oint`, name: () => i18n.t(($) => $.symbols.names.calculus.contourIntegral) },
      { char: "∑", latex: String.raw`\sum`, name: () => i18n.t(($) => $.symbols.names.calculus.summation) },
      { char: "∏", latex: String.raw`\prod`, name: () => i18n.t(($) => $.symbols.names.calculus.product) },
      { char: "∐", latex: String.raw`\coprod`, name: () => i18n.t(($) => $.symbols.names.calculus.coproduct) },
      { char: "lim", latex: String.raw`\lim`, name: () => i18n.t(($) => $.symbols.names.calculus.limit) },
      { char: "∞", latex: String.raw`\infty`, name: () => i18n.t(($) => $.symbols.names.calculus.infinity) },
      { char: "∇", latex: String.raw`\nabla`, name: () => i18n.t(($) => $.symbols.names.calculus.nablaGradient) },
      { char: "∂", latex: String.raw`\partial`, name: () => i18n.t(($) => $.symbols.names.calculus.partial) },
      { char: "√x", latex: String.raw`\sqrt{}`, name: () => i18n.t(($) => $.symbols.names.calculus.squareRoot) },
      { char: "a/b", latex: String.raw`\frac{}{}`, name: () => i18n.t(($) => $.symbols.names.calculus.fraction) },
      { char: "C(n,k)", latex: String.raw`\binom{}{}`, name: () => i18n.t(($) => $.symbols.names.calculus.binomial) },
      { char: "sup", latex: String.raw`\sup`, name: () => i18n.t(($) => $.symbols.names.calculus.supremum) },
      { char: "inf", latex: String.raw`\inf`, name: () => i18n.t(($) => $.symbols.names.calculus.infimum) },
      { char: "max", latex: String.raw`\max`, name: () => i18n.t(($) => $.symbols.names.calculus.maximum) },
      { char: "min", latex: String.raw`\min`, name: () => i18n.t(($) => $.symbols.names.calculus.minimum) },
    ],
  },
  {
    id: "functions",
    label: () => i18n.t(($) => $.symbols.categories.functions),
    items: [
      { char: "sin", latex: String.raw`\sin`, name: () => i18n.t(($) => $.symbols.names.functions.sine) },
      { char: "cos", latex: String.raw`\cos`, name: () => i18n.t(($) => $.symbols.names.functions.cosine) },
      { char: "tan", latex: String.raw`\tan`, name: () => i18n.t(($) => $.symbols.names.functions.tangent) },
      { char: "cot", latex: String.raw`\cot`, name: () => i18n.t(($) => $.symbols.names.functions.cotangent) },
      { char: "sec", latex: String.raw`\sec`, name: () => i18n.t(($) => $.symbols.names.functions.secant) },
      { char: "csc", latex: String.raw`\csc`, name: () => i18n.t(($) => $.symbols.names.functions.cosecant) },
      { char: "arcsin", latex: String.raw`\arcsin`, name: () => i18n.t(($) => $.symbols.names.functions.arcsine) },
      { char: "arccos", latex: String.raw`\arccos`, name: () => i18n.t(($) => $.symbols.names.functions.arccosine) },
      { char: "arctan", latex: String.raw`\arctan`, name: () => i18n.t(($) => $.symbols.names.functions.arctangent) },
      { char: "sinh", latex: String.raw`\sinh`, name: () => i18n.t(($) => $.symbols.names.functions.hyperbolicSine) },
      { char: "cosh", latex: String.raw`\cosh`, name: () => i18n.t(($) => $.symbols.names.functions.hyperbolicCosine) },
      { char: "tanh", latex: String.raw`\tanh`, name: () => i18n.t(($) => $.symbols.names.functions.hyperbolicTangent) },
      { char: "log", latex: String.raw`\log`, name: () => i18n.t(($) => $.symbols.names.functions.logarithm) },
      { char: "ln", latex: String.raw`\ln`, name: () => i18n.t(($) => $.symbols.names.functions.naturalLog) },
      { char: "exp", latex: String.raw`\exp`, name: () => i18n.t(($) => $.symbols.names.functions.exponential) },
      { char: "det", latex: String.raw`\det`, name: () => i18n.t(($) => $.symbols.names.functions.determinant) },
      { char: "dim", latex: String.raw`\dim`, name: () => i18n.t(($) => $.symbols.names.functions.dimension) },
      { char: "ker", latex: String.raw`\ker`, name: () => i18n.t(($) => $.symbols.names.functions.kernel) },
      { char: "arg", latex: String.raw`\arg`, name: () => i18n.t(($) => $.symbols.names.functions.argument) },
    ],
  },
  {
    id: "brackets",
    label: () => i18n.t(($) => $.symbols.categories.brackets),
    items: [
      { char: "(", latex: "(", name: () => i18n.t(($) => $.symbols.names.brackets.leftParen) },
      { char: ")", latex: ")", name: () => i18n.t(($) => $.symbols.names.brackets.rightParen) },
      { char: "[", latex: "[", name: () => i18n.t(($) => $.symbols.names.brackets.leftBracket) },
      { char: "]", latex: "]", name: () => i18n.t(($) => $.symbols.names.brackets.rightBracket) },
      { char: "{", latex: String.raw`\{`, name: () => i18n.t(($) => $.symbols.names.brackets.leftBrace) },
      { char: "}", latex: String.raw`\}`, name: () => i18n.t(($) => $.symbols.names.brackets.rightBrace) },
      { char: "⟨", latex: String.raw`\langle`, name: () => i18n.t(($) => $.symbols.names.brackets.leftAngleBracket) },
      { char: "⟩", latex: String.raw`\rangle`, name: () => i18n.t(($) => $.symbols.names.brackets.rightAngleBracket) },
      { char: "⌊", latex: String.raw`\lfloor`, name: () => i18n.t(($) => $.symbols.names.brackets.leftFloor) },
      { char: "⌋", latex: String.raw`\rfloor`, name: () => i18n.t(($) => $.symbols.names.brackets.rightFloor) },
      { char: "⌈", latex: String.raw`\lceil`, name: () => i18n.t(($) => $.symbols.names.brackets.leftCeiling) },
      { char: "⌉", latex: String.raw`\rceil`, name: () => i18n.t(($) => $.symbols.names.brackets.rightCeiling) },
      { char: "|", latex: "|", name: () => i18n.t(($) => $.symbols.names.brackets.verticalBar) },
      { char: "‖", latex: String.raw`\|`, name: () => i18n.t(($) => $.symbols.names.brackets.doubleVerticalBarNorm) },
      { char: "( )", latex: String.raw`\left( \right)`, name: () => i18n.t(($) => $.symbols.names.brackets.autoSizedParens) },
      { char: "[ ]", latex: String.raw`\left[ \right]`, name: () => i18n.t(($) => $.symbols.names.brackets.autoSizedBrackets) },
    ],
  },
  {
    id: "accents",
    label: () => i18n.t(($) => $.symbols.categories.accents),
    items: [
      { char: "â", latex: String.raw`\hat{}`, name: () => i18n.t(($) => $.symbols.names.accents.hat) },
      { char: "ā", latex: String.raw`\bar{}`, name: () => i18n.t(($) => $.symbols.names.accents.barOverlineAccent) },
      { char: "ã", latex: String.raw`\tilde{}`, name: () => i18n.t(($) => $.symbols.names.accents.tildeAccent) },
      { char: "a⃗", latex: String.raw`\vec{}`, name: () => i18n.t(($) => $.symbols.names.accents.vectorArrow) },
      { char: "ȧ", latex: String.raw`\dot{}`, name: () => i18n.t(($) => $.symbols.names.accents.dotDerivative) },
      { char: "ä", latex: String.raw`\ddot{}`, name: () => i18n.t(($) => $.symbols.names.accents.doubleDot) },
      { char: "á", latex: String.raw`\acute{}`, name: () => i18n.t(($) => $.symbols.names.accents.acuteAccent) },
      { char: "à", latex: String.raw`\grave{}`, name: () => i18n.t(($) => $.symbols.names.accents.graveAccent) },
      { char: "ă", latex: String.raw`\breve{}`, name: () => i18n.t(($) => $.symbols.names.accents.breve) },
      { char: "ǎ", latex: String.raw`\check{}`, name: () => i18n.t(($) => $.symbols.names.accents.checkCaron) },
      { char: "a̅b̅c̅", latex: String.raw`\overline{}`, name: () => i18n.t(($) => $.symbols.names.accents.overline) },
      { char: "a̲b̲c̲", latex: String.raw`\underline{}`, name: () => i18n.t(($) => $.symbols.names.accents.underline) },
      { char: "abc⏞", latex: String.raw`\overbrace{}`, name: () => i18n.t(($) => $.symbols.names.accents.overbrace) },
      { char: "abc⏟", latex: String.raw`\underbrace{}`, name: () => i18n.t(($) => $.symbols.names.accents.underbrace) },
    ],
  },
  {
    id: "spacing",
    label: () => i18n.t(($) => $.symbols.categories.spacing),
    items: [
      { char: "⋯", latex: String.raw`\cdots`, name: () => i18n.t(($) => $.symbols.names.spacing.centeredDots) },
      { char: "…", latex: String.raw`\ldots`, name: () => i18n.t(($) => $.symbols.names.spacing.lowerDots) },
      { char: "⋮", latex: String.raw`\vdots`, name: () => i18n.t(($) => $.symbols.names.spacing.verticalDots) },
      { char: "⋱", latex: String.raw`\ddots`, name: () => i18n.t(($) => $.symbols.names.spacing.diagonalDots) },
      { char: "␣", latex: String.raw`\quad`, name: () => i18n.t(($) => $.symbols.names.spacing.quadSpace) },
      { char: "␣␣", latex: String.raw`\qquad`, name: () => i18n.t(($) => $.symbols.names.spacing.doubleQuadSpace) },
      { char: String.raw`\,`, latex: String.raw`\,`, name: () => i18n.t(($) => $.symbols.names.spacing.thinSpace) },
      { char: String.raw`\;`, latex: String.raw`\;`, name: () => i18n.t(($) => $.symbols.names.spacing.mediumSpace) },
      { char: String.raw`\!`, latex: String.raw`\!`, name: () => i18n.t(($) => $.symbols.names.spacing.negativeThinSpace) },
      { char: "text", latex: String.raw`\text{}`, name: () => i18n.t(($) => $.symbols.names.spacing.textInMathMode) },
      { char: "rm", latex: String.raw`\mathrm{}`, name: () => i18n.t(($) => $.symbols.names.spacing.romanUprightMath) },
      { char: "bf", latex: String.raw`\mathbf{}`, name: () => i18n.t(($) => $.symbols.names.spacing.boldMath) },
      { char: "𝒜", latex: String.raw`\mathcal{}`, name: () => i18n.t(($) => $.symbols.names.spacing.calligraphic) },
    ],
  },
  {
    id: "misc",
    label: () => i18n.t(($) => $.symbols.categories.misc),
    items: [
      { char: "ℏ", latex: String.raw`\hbar`, name: () => i18n.t(($) => $.symbols.names.misc.hBarPlanck) },
      { char: "ℓ", latex: String.raw`\ell`, name: () => i18n.t(($) => $.symbols.names.misc.scriptL) },
      { char: "℘", latex: String.raw`\wp`, name: () => i18n.t(($) => $.symbols.names.misc.weierstrassP) },
      { char: "ℜ", latex: String.raw`\Re`, name: () => i18n.t(($) => $.symbols.names.misc.realPart) },
      { char: "ℑ", latex: String.raw`\Im`, name: () => i18n.t(($) => $.symbols.names.misc.imaginaryPart) },
      { char: "ℵ", latex: String.raw`\aleph`, name: () => i18n.t(($) => $.symbols.names.misc.aleph) },
      { char: "∠", latex: String.raw`\angle`, name: () => i18n.t(($) => $.symbols.names.misc.angle) },
      { char: "△", latex: String.raw`\triangle`, name: () => i18n.t(($) => $.symbols.names.misc.triangle) },
      { char: "⋄", latex: String.raw`\diamond`, name: () => i18n.t(($) => $.symbols.names.misc.diamond) },
      { char: "□", latex: String.raw`\square`, name: () => i18n.t(($) => $.symbols.names.misc.square) },
      { char: "◊", latex: String.raw`\lozenge`, name: () => i18n.t(($) => $.symbols.names.misc.lozenge) },
      { char: "♣", latex: String.raw`\clubsuit`, name: () => i18n.t(($) => $.symbols.names.misc.club) },
      { char: "♢", latex: String.raw`\diamondsuit`, name: () => i18n.t(($) => $.symbols.names.misc.diamondSuit) },
      { char: "♡", latex: String.raw`\heartsuit`, name: () => i18n.t(($) => $.symbols.names.misc.heart) },
      { char: "♠", latex: String.raw`\spadesuit`, name: () => i18n.t(($) => $.symbols.names.misc.spade) },
      { char: "°", latex: String.raw`^{\circ}`, name: () => i18n.t(($) => $.symbols.names.misc.degree) },
      { char: "#", latex: String.raw`\#`, name: () => i18n.t(($) => $.symbols.names.misc.hash) },
      { char: "$", latex: String.raw`\$`, name: () => i18n.t(($) => $.symbols.names.misc.dollar) },
      { char: "%", latex: String.raw`\%`, name: () => i18n.t(($) => $.symbols.names.misc.percent) },
      { char: "&", latex: String.raw`\&`, name: () => i18n.t(($) => $.symbols.names.misc.ampersand) },
    ],
  },
];

export function insertToolbarSymbol(symbol: ToolbarSymbol): void {
  insertAtCursor(symbol.latex);
}

function SymbolButton({ symbol }: Readonly<{ symbol: ToolbarSymbol }>) {
  const { t } = useTranslation(["common", "symbols"]);
  const name = symbol.name();
  return (
    <Tooltip
      label={
        <Trans
          ns="symbols"
          i18nKey={($) => $.symbols.picker.tooltip}
          values={{ name, latex: symbol.latex }}
          components={{ macro: <span className="font-mono opacity-70" /> }}
        />
      }
      delay={150}
    >
      <PopoverPrimitive.Close asChild>
        <button
          type="button"
          onClick={() => insertToolbarSymbol(symbol)}
          aria-label={t(($) => $.symbols.picker.insert, { name, latex: symbol.latex })}
          className={cn(
            "flex h-9 min-w-9 items-center justify-center rounded-md bg-muted px-1.5 text-foreground transition-colors hover:bg-accent",
            symbol.char.length > 2 ? "text-xs" : "text-base",
          )}
        >
          {symbol.char}
        </button>
      </PopoverPrimitive.Close>
    </Tooltip>
  );
}

// A few macros (\nabla, \partial) live in more than one category, so the All
// tab and search results dedupe by latex to avoid showing the same chip twice.
const dedupeByLatex = (items: ToolbarSymbol[]) => [
  ...new Map(items.map((s) => [s.latex, s] as const)).values(),
];

const ALL_SYMBOLS = dedupeByLatex(SYMBOL_CATEGORIES.flatMap((c) => c.items));

export function SymbolPicker({ menuRow }: Readonly<{ menuRow?: boolean }>) {
  const { t } = useTranslation(["common", "symbols"]);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const q = query.trim().toLowerCase();

  const tabItems =
    activeTab === "all"
      ? ALL_SYMBOLS
      : (SYMBOL_CATEGORIES.find((c) => c.id === activeTab) ?? SYMBOL_CATEGORIES[0]).items;

  const visibleItems = q
    ? dedupeByLatex(
        SYMBOL_CATEGORIES.flatMap((c) => c.items).filter(
          (s) => s.name().toLowerCase().includes(q) || s.latex.toLowerCase().includes(q),
        ),
      )
    : tabItems;

  return (
    <Popover
      ariaLabel={t(($) => $.symbols.picker.trigger)}
      className="w-[34rem] p-0"
      closeOnClick={false}
      triggerClassName={menuRow ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        menuRow ? (
          <>
            <Omega className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.symbols.picker.menuLabel)}</span>
          </>
        ) : (
          <Omega className="size-4" />
        )
      }
    >
      <div className="flex h-96">
        <div className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
          {[
            {
              id: "all",
              label: () => t(($) => $.symbols.picker.all),
              items: ALL_SYMBOLS,
            },
            ...SYMBOL_CATEGORIES,
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveTab(c.id)}
              aria-pressed={activeTab === c.id}
              className={cn(
                "flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs font-medium transition-colors",
                !q && activeTab === c.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="truncate">{c.label()}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums">
                {c.items.length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(($) => $.symbols.picker.searchPlaceholder)}
              aria-label={t(($) => $.symbols.picker.searchLabel)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-1 flex-wrap content-start gap-1 overflow-y-auto p-2">
            {visibleItems.length === 0 ? (
              <p className="w-full py-4 text-center text-xs text-muted-foreground">
                {t(($) => $.symbols.picker.empty)}
              </p>
            ) : (
              visibleItems.map((s) => <SymbolButton key={s.latex} symbol={s} />)
            )}
          </div>
        </div>
      </div>
    </Popover>
  );
}
