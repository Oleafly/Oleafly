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
      { char: "α", latex: "\\alpha", name: () => i18n.t(($) => $.symbols.names.greekLower.alpha) },
      { char: "β", latex: "\\beta", name: () => i18n.t(($) => $.symbols.names.greekLower.beta) },
      { char: "γ", latex: "\\gamma", name: () => i18n.t(($) => $.symbols.names.greekLower.gamma) },
      { char: "δ", latex: "\\delta", name: () => i18n.t(($) => $.symbols.names.greekLower.delta) },
      { char: "ϵ", latex: "\\epsilon", name: () => i18n.t(($) => $.symbols.names.greekLower.epsilon) },
      { char: "ε", latex: "\\varepsilon", name: () => i18n.t(($) => $.symbols.names.greekLower.varepsilon) },
      { char: "ζ", latex: "\\zeta", name: () => i18n.t(($) => $.symbols.names.greekLower.zeta) },
      { char: "η", latex: "\\eta", name: () => i18n.t(($) => $.symbols.names.greekLower.eta) },
      { char: "θ", latex: "\\theta", name: () => i18n.t(($) => $.symbols.names.greekLower.theta) },
      { char: "ϑ", latex: "\\vartheta", name: () => i18n.t(($) => $.symbols.names.greekLower.vartheta) },
      { char: "ι", latex: "\\iota", name: () => i18n.t(($) => $.symbols.names.greekLower.iota) },
      { char: "κ", latex: "\\kappa", name: () => i18n.t(($) => $.symbols.names.greekLower.kappa) },
      { char: "λ", latex: "\\lambda", name: () => i18n.t(($) => $.symbols.names.greekLower.lambda) },
      { char: "μ", latex: "\\mu", name: () => i18n.t(($) => $.symbols.names.greekLower.mu) },
      { char: "ν", latex: "\\nu", name: () => i18n.t(($) => $.symbols.names.greekLower.nu) },
      { char: "ξ", latex: "\\xi", name: () => i18n.t(($) => $.symbols.names.greekLower.xi) },
      { char: "π", latex: "\\pi", name: () => i18n.t(($) => $.symbols.names.greekLower.pi) },
      { char: "ϖ", latex: "\\varpi", name: () => i18n.t(($) => $.symbols.names.greekLower.varpi) },
      { char: "ρ", latex: "\\rho", name: () => i18n.t(($) => $.symbols.names.greekLower.rho) },
      { char: "ϱ", latex: "\\varrho", name: () => i18n.t(($) => $.symbols.names.greekLower.varrho) },
      { char: "σ", latex: "\\sigma", name: () => i18n.t(($) => $.symbols.names.greekLower.sigma) },
      { char: "ς", latex: "\\varsigma", name: () => i18n.t(($) => $.symbols.names.greekLower.varsigma) },
      { char: "τ", latex: "\\tau", name: () => i18n.t(($) => $.symbols.names.greekLower.tau) },
      { char: "υ", latex: "\\upsilon", name: () => i18n.t(($) => $.symbols.names.greekLower.upsilon) },
      { char: "ϕ", latex: "\\phi", name: () => i18n.t(($) => $.symbols.names.greekLower.phi) },
      { char: "φ", latex: "\\varphi", name: () => i18n.t(($) => $.symbols.names.greekLower.varphi) },
      { char: "χ", latex: "\\chi", name: () => i18n.t(($) => $.symbols.names.greekLower.chi) },
      { char: "ψ", latex: "\\psi", name: () => i18n.t(($) => $.symbols.names.greekLower.psi) },
      { char: "ω", latex: "\\omega", name: () => i18n.t(($) => $.symbols.names.greekLower.omega) },
    ],
  },
  {
    id: "greek-upper",
    label: () => i18n.t(($) => $.symbols.categories.greekUpper),
    items: [
      { char: "Γ", latex: "\\Gamma", name: () => i18n.t(($) => $.symbols.names.greekUpper.gamma) },
      { char: "Δ", latex: "\\Delta", name: () => i18n.t(($) => $.symbols.names.greekUpper.delta) },
      { char: "Θ", latex: "\\Theta", name: () => i18n.t(($) => $.symbols.names.greekUpper.theta) },
      { char: "Λ", latex: "\\Lambda", name: () => i18n.t(($) => $.symbols.names.greekUpper.lambda) },
      { char: "Ξ", latex: "\\Xi", name: () => i18n.t(($) => $.symbols.names.greekUpper.xi) },
      { char: "Π", latex: "\\Pi", name: () => i18n.t(($) => $.symbols.names.greekUpper.pi) },
      { char: "Σ", latex: "\\Sigma", name: () => i18n.t(($) => $.symbols.names.greekUpper.sigma) },
      { char: "Υ", latex: "\\Upsilon", name: () => i18n.t(($) => $.symbols.names.greekUpper.upsilon) },
      { char: "Φ", latex: "\\Phi", name: () => i18n.t(($) => $.symbols.names.greekUpper.phi) },
      { char: "Ψ", latex: "\\Psi", name: () => i18n.t(($) => $.symbols.names.greekUpper.psi) },
      { char: "Ω", latex: "\\Omega", name: () => i18n.t(($) => $.symbols.names.greekUpper.omega) },
    ],
  },
  {
    id: "operators",
    label: () => i18n.t(($) => $.symbols.categories.operators),
    items: [
      { char: "+", latex: "+", name: () => i18n.t(($) => $.symbols.names.operators.plus) },
      { char: "−", latex: "-", name: () => i18n.t(($) => $.symbols.names.operators.minus) },
      { char: "×", latex: "\\times", name: () => i18n.t(($) => $.symbols.names.operators.times) },
      { char: "÷", latex: "\\div", name: () => i18n.t(($) => $.symbols.names.operators.division) },
      { char: "⋅", latex: "\\cdot", name: () => i18n.t(($) => $.symbols.names.operators.centeredDot) },
      { char: "±", latex: "\\pm", name: () => i18n.t(($) => $.symbols.names.operators.plusMinus) },
      { char: "∓", latex: "\\mp", name: () => i18n.t(($) => $.symbols.names.operators.minusPlus) },
      { char: "∗", latex: "\\ast", name: () => i18n.t(($) => $.symbols.names.operators.asterisk) },
      { char: "⋆", latex: "\\star", name: () => i18n.t(($) => $.symbols.names.operators.star) },
      { char: "∘", latex: "\\circ", name: () => i18n.t(($) => $.symbols.names.operators.circle) },
      { char: "•", latex: "\\bullet", name: () => i18n.t(($) => $.symbols.names.operators.bullet) },
      { char: "⊕", latex: "\\oplus", name: () => i18n.t(($) => $.symbols.names.operators.circledPlus) },
      { char: "⊖", latex: "\\ominus", name: () => i18n.t(($) => $.symbols.names.operators.circledMinus) },
      { char: "⊗", latex: "\\otimes", name: () => i18n.t(($) => $.symbols.names.operators.circledTimes) },
      { char: "⊙", latex: "\\odot", name: () => i18n.t(($) => $.symbols.names.operators.circledDot) },
      { char: "†", latex: "\\dagger", name: () => i18n.t(($) => $.symbols.names.operators.dagger) },
      { char: "‡", latex: "\\ddagger", name: () => i18n.t(($) => $.symbols.names.operators.doubleDagger) },
      { char: "∇", latex: "\\nabla", name: () => i18n.t(($) => $.symbols.names.operators.nablaDel) },
      { char: "∂", latex: "\\partial", name: () => i18n.t(($) => $.symbols.names.operators.partialDerivative) },
    ],
  },
  {
    id: "relations",
    label: () => i18n.t(($) => $.symbols.categories.relations),
    items: [
      { char: "=", latex: "=", name: () => i18n.t(($) => $.symbols.names.relations.equals) },
      { char: "≠", latex: "\\neq", name: () => i18n.t(($) => $.symbols.names.relations.notEqual) },
      { char: "<", latex: "<", name: () => i18n.t(($) => $.symbols.names.relations.lessThan) },
      { char: ">", latex: ">", name: () => i18n.t(($) => $.symbols.names.relations.greaterThan) },
      { char: "≤", latex: "\\leq", name: () => i18n.t(($) => $.symbols.names.relations.lessOrEqual) },
      { char: "≥", latex: "\\geq", name: () => i18n.t(($) => $.symbols.names.relations.greaterOrEqual) },
      { char: "≪", latex: "\\ll", name: () => i18n.t(($) => $.symbols.names.relations.muchLess) },
      { char: "≫", latex: "\\gg", name: () => i18n.t(($) => $.symbols.names.relations.muchGreater) },
      { char: "≈", latex: "\\approx", name: () => i18n.t(($) => $.symbols.names.relations.approximately) },
      { char: "∼", latex: "\\sim", name: () => i18n.t(($) => $.symbols.names.relations.similarTilde) },
      { char: "≃", latex: "\\simeq", name: () => i18n.t(($) => $.symbols.names.relations.asymptoticallyEqual) },
      { char: "≅", latex: "\\cong", name: () => i18n.t(($) => $.symbols.names.relations.congruent) },
      { char: "≡", latex: "\\equiv", name: () => i18n.t(($) => $.symbols.names.relations.identicalEquivalent) },
      { char: "∝", latex: "\\propto", name: () => i18n.t(($) => $.symbols.names.relations.proportionalTo) },
      { char: "≺", latex: "\\prec", name: () => i18n.t(($) => $.symbols.names.relations.precedes) },
      { char: "≻", latex: "\\succ", name: () => i18n.t(($) => $.symbols.names.relations.succeeds) },
      { char: "⪯", latex: "\\preceq", name: () => i18n.t(($) => $.symbols.names.relations.precedesOrEqual) },
      { char: "⪰", latex: "\\succeq", name: () => i18n.t(($) => $.symbols.names.relations.succeedsOrEqual) },
      { char: "⊥", latex: "\\perp", name: () => i18n.t(($) => $.symbols.names.relations.perpendicular) },
      { char: "∥", latex: "\\parallel", name: () => i18n.t(($) => $.symbols.names.relations.parallel) },
      { char: "∣", latex: "\\mid", name: () => i18n.t(($) => $.symbols.names.relations.dividesMid) },
    ],
  },
  {
    id: "arrows",
    label: () => i18n.t(($) => $.symbols.categories.arrows),
    items: [
      { char: "←", latex: "\\leftarrow", name: () => i18n.t(($) => $.symbols.names.arrows.leftArrow) },
      { char: "→", latex: "\\rightarrow", name: () => i18n.t(($) => $.symbols.names.arrows.rightArrow) },
      { char: "↑", latex: "\\uparrow", name: () => i18n.t(($) => $.symbols.names.arrows.upArrow) },
      { char: "↓", latex: "\\downarrow", name: () => i18n.t(($) => $.symbols.names.arrows.downArrow) },
      { char: "↔", latex: "\\leftrightarrow", name: () => i18n.t(($) => $.symbols.names.arrows.leftRightArrow) },
      { char: "⇐", latex: "\\Leftarrow", name: () => i18n.t(($) => $.symbols.names.arrows.doubleLeftArrow) },
      { char: "⇒", latex: "\\Rightarrow", name: () => i18n.t(($) => $.symbols.names.arrows.doubleRightArrowImplies) },
      { char: "⇑", latex: "\\Uparrow", name: () => i18n.t(($) => $.symbols.names.arrows.doubleUpArrow) },
      { char: "⇓", latex: "\\Downarrow", name: () => i18n.t(($) => $.symbols.names.arrows.doubleDownArrow) },
      { char: "⇔", latex: "\\Leftrightarrow", name: () => i18n.t(($) => $.symbols.names.arrows.doubleLeftRightIff) },
      { char: "↦", latex: "\\mapsto", name: () => i18n.t(($) => $.symbols.names.arrows.mapsTo) },
      { char: "⟼", latex: "\\longmapsto", name: () => i18n.t(($) => $.symbols.names.arrows.longMapsTo) },
      { char: "⟶", latex: "\\longrightarrow", name: () => i18n.t(($) => $.symbols.names.arrows.longRightArrow) },
      { char: "⟵", latex: "\\longleftarrow", name: () => i18n.t(($) => $.symbols.names.arrows.longLeftArrow) },
      { char: "↪", latex: "\\hookrightarrow", name: () => i18n.t(($) => $.symbols.names.arrows.hookRightArrow) },
      { char: "↩", latex: "\\hookleftarrow", name: () => i18n.t(($) => $.symbols.names.arrows.hookLeftArrow) },
      { char: "↗", latex: "\\nearrow", name: () => i18n.t(($) => $.symbols.names.arrows.neArrow) },
      { char: "↘", latex: "\\searrow", name: () => i18n.t(($) => $.symbols.names.arrows.seArrow) },
      { char: "↖", latex: "\\nwarrow", name: () => i18n.t(($) => $.symbols.names.arrows.nwArrow) },
      { char: "↙", latex: "\\swarrow", name: () => i18n.t(($) => $.symbols.names.arrows.swArrow) },
      { char: "⇌", latex: "\\rightleftharpoons", name: () => i18n.t(($) => $.symbols.names.arrows.equilibriumHarpoons) },
      { char: "↼", latex: "\\leftharpoonup", name: () => i18n.t(($) => $.symbols.names.arrows.leftHarpoon) },
      { char: "⇀", latex: "\\rightharpoonup", name: () => i18n.t(($) => $.symbols.names.arrows.rightHarpoon) },
    ],
  },
  {
    id: "sets",
    label: () => i18n.t(($) => $.symbols.categories.sets),
    items: [
      { char: "∈", latex: "\\in", name: () => i18n.t(($) => $.symbols.names.sets.elementOf) },
      { char: "∉", latex: "\\notin", name: () => i18n.t(($) => $.symbols.names.sets.notElementOf) },
      { char: "∋", latex: "\\ni", name: () => i18n.t(($) => $.symbols.names.sets.containsAsMember) },
      { char: "⊂", latex: "\\subset", name: () => i18n.t(($) => $.symbols.names.sets.subset) },
      { char: "⊃", latex: "\\supset", name: () => i18n.t(($) => $.symbols.names.sets.superset) },
      { char: "⊆", latex: "\\subseteq", name: () => i18n.t(($) => $.symbols.names.sets.subsetOrEqual) },
      { char: "⊇", latex: "\\supseteq", name: () => i18n.t(($) => $.symbols.names.sets.supersetOrEqual) },
      { char: "∪", latex: "\\cup", name: () => i18n.t(($) => $.symbols.names.sets.union) },
      { char: "∩", latex: "\\cap", name: () => i18n.t(($) => $.symbols.names.sets.intersection) },
      { char: "⋃", latex: "\\bigcup", name: () => i18n.t(($) => $.symbols.names.sets.bigUnion) },
      { char: "⋂", latex: "\\bigcap", name: () => i18n.t(($) => $.symbols.names.sets.bigIntersection) },
      { char: "∖", latex: "\\setminus", name: () => i18n.t(($) => $.symbols.names.sets.setMinus) },
      { char: "∅", latex: "\\emptyset", name: () => i18n.t(($) => $.symbols.names.sets.emptySet) },
      { char: "∅", latex: "\\varnothing", name: () => i18n.t(($) => $.symbols.names.sets.emptySetVariant) },
      { char: "ℕ", latex: "\\mathbb{N}", name: () => i18n.t(($) => $.symbols.names.sets.naturalNumbers) },
      { char: "ℤ", latex: "\\mathbb{Z}", name: () => i18n.t(($) => $.symbols.names.sets.integers) },
      { char: "ℚ", latex: "\\mathbb{Q}", name: () => i18n.t(($) => $.symbols.names.sets.rationals) },
      { char: "ℝ", latex: "\\mathbb{R}", name: () => i18n.t(($) => $.symbols.names.sets.realNumbers) },
      { char: "ℂ", latex: "\\mathbb{C}", name: () => i18n.t(($) => $.symbols.names.sets.complexNumbers) },
    ],
  },
  {
    id: "logic",
    label: () => i18n.t(($) => $.symbols.categories.logic),
    items: [
      { char: "∀", latex: "\\forall", name: () => i18n.t(($) => $.symbols.names.logic.forAll) },
      { char: "∃", latex: "\\exists", name: () => i18n.t(($) => $.symbols.names.logic.exists) },
      { char: "∄", latex: "\\nexists", name: () => i18n.t(($) => $.symbols.names.logic.doesNotExist) },
      { char: "¬", latex: "\\neg", name: () => i18n.t(($) => $.symbols.names.logic.negation) },
      { char: "∧", latex: "\\land", name: () => i18n.t(($) => $.symbols.names.logic.logicalAnd) },
      { char: "∨", latex: "\\lor", name: () => i18n.t(($) => $.symbols.names.logic.logicalOr) },
      { char: "∧", latex: "\\wedge", name: () => i18n.t(($) => $.symbols.names.logic.wedge) },
      { char: "∨", latex: "\\vee", name: () => i18n.t(($) => $.symbols.names.logic.vee) },
      { char: "⟹", latex: "\\implies", name: () => i18n.t(($) => $.symbols.names.logic.implies) },
      { char: "⟺", latex: "\\iff", name: () => i18n.t(($) => $.symbols.names.logic.ifAndOnlyIf) },
      { char: "∴", latex: "\\therefore", name: () => i18n.t(($) => $.symbols.names.logic.therefore) },
      { char: "∵", latex: "\\because", name: () => i18n.t(($) => $.symbols.names.logic.because) },
      { char: "⊤", latex: "\\top", name: () => i18n.t(($) => $.symbols.names.logic.topTrue) },
      { char: "⊥", latex: "\\bot", name: () => i18n.t(($) => $.symbols.names.logic.bottomFalse) },
      { char: "⊢", latex: "\\vdash", name: () => i18n.t(($) => $.symbols.names.logic.provesTurnstile) },
      { char: "⊨", latex: "\\models", name: () => i18n.t(($) => $.symbols.names.logic.modelsEntails) },
    ],
  },
  {
    id: "calculus",
    label: () => i18n.t(($) => $.symbols.categories.calculus),
    items: [
      { char: "∫", latex: "\\int", name: () => i18n.t(($) => $.symbols.names.calculus.integral) },
      { char: "∬", latex: "\\iint", name: () => i18n.t(($) => $.symbols.names.calculus.doubleIntegral) },
      { char: "∭", latex: "\\iiint", name: () => i18n.t(($) => $.symbols.names.calculus.tripleIntegral) },
      { char: "∮", latex: "\\oint", name: () => i18n.t(($) => $.symbols.names.calculus.contourIntegral) },
      { char: "∑", latex: "\\sum", name: () => i18n.t(($) => $.symbols.names.calculus.summation) },
      { char: "∏", latex: "\\prod", name: () => i18n.t(($) => $.symbols.names.calculus.product) },
      { char: "∐", latex: "\\coprod", name: () => i18n.t(($) => $.symbols.names.calculus.coproduct) },
      { char: "lim", latex: "\\lim", name: () => i18n.t(($) => $.symbols.names.calculus.limit) },
      { char: "∞", latex: "\\infty", name: () => i18n.t(($) => $.symbols.names.calculus.infinity) },
      { char: "∇", latex: "\\nabla", name: () => i18n.t(($) => $.symbols.names.calculus.nablaGradient) },
      { char: "∂", latex: "\\partial", name: () => i18n.t(($) => $.symbols.names.calculus.partial) },
      { char: "√x", latex: "\\sqrt{}", name: () => i18n.t(($) => $.symbols.names.calculus.squareRoot) },
      { char: "a/b", latex: "\\frac{}{}", name: () => i18n.t(($) => $.symbols.names.calculus.fraction) },
      { char: "C(n,k)", latex: "\\binom{}{}", name: () => i18n.t(($) => $.symbols.names.calculus.binomial) },
      { char: "sup", latex: "\\sup", name: () => i18n.t(($) => $.symbols.names.calculus.supremum) },
      { char: "inf", latex: "\\inf", name: () => i18n.t(($) => $.symbols.names.calculus.infimum) },
      { char: "max", latex: "\\max", name: () => i18n.t(($) => $.symbols.names.calculus.maximum) },
      { char: "min", latex: "\\min", name: () => i18n.t(($) => $.symbols.names.calculus.minimum) },
    ],
  },
  {
    id: "functions",
    label: () => i18n.t(($) => $.symbols.categories.functions),
    items: [
      { char: "sin", latex: "\\sin", name: () => i18n.t(($) => $.symbols.names.functions.sine) },
      { char: "cos", latex: "\\cos", name: () => i18n.t(($) => $.symbols.names.functions.cosine) },
      { char: "tan", latex: "\\tan", name: () => i18n.t(($) => $.symbols.names.functions.tangent) },
      { char: "cot", latex: "\\cot", name: () => i18n.t(($) => $.symbols.names.functions.cotangent) },
      { char: "sec", latex: "\\sec", name: () => i18n.t(($) => $.symbols.names.functions.secant) },
      { char: "csc", latex: "\\csc", name: () => i18n.t(($) => $.symbols.names.functions.cosecant) },
      { char: "arcsin", latex: "\\arcsin", name: () => i18n.t(($) => $.symbols.names.functions.arcsine) },
      { char: "arccos", latex: "\\arccos", name: () => i18n.t(($) => $.symbols.names.functions.arccosine) },
      { char: "arctan", latex: "\\arctan", name: () => i18n.t(($) => $.symbols.names.functions.arctangent) },
      { char: "sinh", latex: "\\sinh", name: () => i18n.t(($) => $.symbols.names.functions.hyperbolicSine) },
      { char: "cosh", latex: "\\cosh", name: () => i18n.t(($) => $.symbols.names.functions.hyperbolicCosine) },
      { char: "tanh", latex: "\\tanh", name: () => i18n.t(($) => $.symbols.names.functions.hyperbolicTangent) },
      { char: "log", latex: "\\log", name: () => i18n.t(($) => $.symbols.names.functions.logarithm) },
      { char: "ln", latex: "\\ln", name: () => i18n.t(($) => $.symbols.names.functions.naturalLog) },
      { char: "exp", latex: "\\exp", name: () => i18n.t(($) => $.symbols.names.functions.exponential) },
      { char: "det", latex: "\\det", name: () => i18n.t(($) => $.symbols.names.functions.determinant) },
      { char: "dim", latex: "\\dim", name: () => i18n.t(($) => $.symbols.names.functions.dimension) },
      { char: "ker", latex: "\\ker", name: () => i18n.t(($) => $.symbols.names.functions.kernel) },
      { char: "arg", latex: "\\arg", name: () => i18n.t(($) => $.symbols.names.functions.argument) },
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
      { char: "{", latex: "\\{", name: () => i18n.t(($) => $.symbols.names.brackets.leftBrace) },
      { char: "}", latex: "\\}", name: () => i18n.t(($) => $.symbols.names.brackets.rightBrace) },
      { char: "⟨", latex: "\\langle", name: () => i18n.t(($) => $.symbols.names.brackets.leftAngleBracket) },
      { char: "⟩", latex: "\\rangle", name: () => i18n.t(($) => $.symbols.names.brackets.rightAngleBracket) },
      { char: "⌊", latex: "\\lfloor", name: () => i18n.t(($) => $.symbols.names.brackets.leftFloor) },
      { char: "⌋", latex: "\\rfloor", name: () => i18n.t(($) => $.symbols.names.brackets.rightFloor) },
      { char: "⌈", latex: "\\lceil", name: () => i18n.t(($) => $.symbols.names.brackets.leftCeiling) },
      { char: "⌉", latex: "\\rceil", name: () => i18n.t(($) => $.symbols.names.brackets.rightCeiling) },
      { char: "|", latex: "|", name: () => i18n.t(($) => $.symbols.names.brackets.verticalBar) },
      { char: "‖", latex: "\\|", name: () => i18n.t(($) => $.symbols.names.brackets.doubleVerticalBarNorm) },
      { char: "( )", latex: "\\left( \\right)", name: () => i18n.t(($) => $.symbols.names.brackets.autoSizedParens) },
      { char: "[ ]", latex: "\\left[ \\right]", name: () => i18n.t(($) => $.symbols.names.brackets.autoSizedBrackets) },
    ],
  },
  {
    id: "accents",
    label: () => i18n.t(($) => $.symbols.categories.accents),
    items: [
      { char: "â", latex: "\\hat{}", name: () => i18n.t(($) => $.symbols.names.accents.hat) },
      { char: "ā", latex: "\\bar{}", name: () => i18n.t(($) => $.symbols.names.accents.barOverlineAccent) },
      { char: "ã", latex: "\\tilde{}", name: () => i18n.t(($) => $.symbols.names.accents.tildeAccent) },
      { char: "a⃗", latex: "\\vec{}", name: () => i18n.t(($) => $.symbols.names.accents.vectorArrow) },
      { char: "ȧ", latex: "\\dot{}", name: () => i18n.t(($) => $.symbols.names.accents.dotDerivative) },
      { char: "ä", latex: "\\ddot{}", name: () => i18n.t(($) => $.symbols.names.accents.doubleDot) },
      { char: "á", latex: "\\acute{}", name: () => i18n.t(($) => $.symbols.names.accents.acuteAccent) },
      { char: "à", latex: "\\grave{}", name: () => i18n.t(($) => $.symbols.names.accents.graveAccent) },
      { char: "ă", latex: "\\breve{}", name: () => i18n.t(($) => $.symbols.names.accents.breve) },
      { char: "ǎ", latex: "\\check{}", name: () => i18n.t(($) => $.symbols.names.accents.checkCaron) },
      { char: "a̅b̅c̅", latex: "\\overline{}", name: () => i18n.t(($) => $.symbols.names.accents.overline) },
      { char: "a̲b̲c̲", latex: "\\underline{}", name: () => i18n.t(($) => $.symbols.names.accents.underline) },
      { char: "abc⏞", latex: "\\overbrace{}", name: () => i18n.t(($) => $.symbols.names.accents.overbrace) },
      { char: "abc⏟", latex: "\\underbrace{}", name: () => i18n.t(($) => $.symbols.names.accents.underbrace) },
    ],
  },
  {
    id: "spacing",
    label: () => i18n.t(($) => $.symbols.categories.spacing),
    items: [
      { char: "⋯", latex: "\\cdots", name: () => i18n.t(($) => $.symbols.names.spacing.centeredDots) },
      { char: "…", latex: "\\ldots", name: () => i18n.t(($) => $.symbols.names.spacing.lowerDots) },
      { char: "⋮", latex: "\\vdots", name: () => i18n.t(($) => $.symbols.names.spacing.verticalDots) },
      { char: "⋱", latex: "\\ddots", name: () => i18n.t(($) => $.symbols.names.spacing.diagonalDots) },
      { char: "␣", latex: "\\quad", name: () => i18n.t(($) => $.symbols.names.spacing.quadSpace) },
      { char: "␣␣", latex: "\\qquad", name: () => i18n.t(($) => $.symbols.names.spacing.doubleQuadSpace) },
      { char: "\\,", latex: "\\,", name: () => i18n.t(($) => $.symbols.names.spacing.thinSpace) },
      { char: "\\;", latex: "\\;", name: () => i18n.t(($) => $.symbols.names.spacing.mediumSpace) },
      { char: "\\!", latex: "\\!", name: () => i18n.t(($) => $.symbols.names.spacing.negativeThinSpace) },
      { char: "text", latex: "\\text{}", name: () => i18n.t(($) => $.symbols.names.spacing.textInMathMode) },
      { char: "rm", latex: "\\mathrm{}", name: () => i18n.t(($) => $.symbols.names.spacing.romanUprightMath) },
      { char: "bf", latex: "\\mathbf{}", name: () => i18n.t(($) => $.symbols.names.spacing.boldMath) },
      { char: "𝒜", latex: "\\mathcal{}", name: () => i18n.t(($) => $.symbols.names.spacing.calligraphic) },
    ],
  },
  {
    id: "misc",
    label: () => i18n.t(($) => $.symbols.categories.misc),
    items: [
      { char: "ℏ", latex: "\\hbar", name: () => i18n.t(($) => $.symbols.names.misc.hBarPlanck) },
      { char: "ℓ", latex: "\\ell", name: () => i18n.t(($) => $.symbols.names.misc.scriptL) },
      { char: "℘", latex: "\\wp", name: () => i18n.t(($) => $.symbols.names.misc.weierstrassP) },
      { char: "ℜ", latex: "\\Re", name: () => i18n.t(($) => $.symbols.names.misc.realPart) },
      { char: "ℑ", latex: "\\Im", name: () => i18n.t(($) => $.symbols.names.misc.imaginaryPart) },
      { char: "ℵ", latex: "\\aleph", name: () => i18n.t(($) => $.symbols.names.misc.aleph) },
      { char: "∠", latex: "\\angle", name: () => i18n.t(($) => $.symbols.names.misc.angle) },
      { char: "△", latex: "\\triangle", name: () => i18n.t(($) => $.symbols.names.misc.triangle) },
      { char: "⋄", latex: "\\diamond", name: () => i18n.t(($) => $.symbols.names.misc.diamond) },
      { char: "□", latex: "\\square", name: () => i18n.t(($) => $.symbols.names.misc.square) },
      { char: "◊", latex: "\\lozenge", name: () => i18n.t(($) => $.symbols.names.misc.lozenge) },
      { char: "♣", latex: "\\clubsuit", name: () => i18n.t(($) => $.symbols.names.misc.club) },
      { char: "♢", latex: "\\diamondsuit", name: () => i18n.t(($) => $.symbols.names.misc.diamondSuit) },
      { char: "♡", latex: "\\heartsuit", name: () => i18n.t(($) => $.symbols.names.misc.heart) },
      { char: "♠", latex: "\\spadesuit", name: () => i18n.t(($) => $.symbols.names.misc.spade) },
      { char: "°", latex: "^{\\circ}", name: () => i18n.t(($) => $.symbols.names.misc.degree) },
      { char: "#", latex: "\\#", name: () => i18n.t(($) => $.symbols.names.misc.hash) },
      { char: "$", latex: "\\$", name: () => i18n.t(($) => $.symbols.names.misc.dollar) },
      { char: "%", latex: "\\%", name: () => i18n.t(($) => $.symbols.names.misc.percent) },
      { char: "&", latex: "\\&", name: () => i18n.t(($) => $.symbols.names.misc.ampersand) },
    ],
  },
];

export function insertToolbarSymbol(symbol: ToolbarSymbol): void {
  insertAtCursor(symbol.latex);
}

function SymbolButton({ symbol }: { symbol: ToolbarSymbol }) {
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

export function SymbolPicker({ menuRow }: { menuRow?: boolean }) {
  const { t } = useTranslation(["common", "symbols"]);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const q = query.trim().toLowerCase();

  const visibleItems = q
    ? dedupeByLatex(
        SYMBOL_CATEGORIES.flatMap((c) => c.items).filter(
          (s) => s.name().toLowerCase().includes(q) || s.latex.toLowerCase().includes(q),
        ),
      )
    : activeTab === "all"
      ? ALL_SYMBOLS
      : (SYMBOL_CATEGORIES.find((c) => c.id === activeTab) ?? SYMBOL_CATEGORIES[0]).items;

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
