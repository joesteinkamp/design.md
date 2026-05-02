// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

export type Format = 'designmd' | 'prose' | 'dtcg' | 'none';

export interface SemanticAssertion {
  /** CSS selector identifying the element to inspect. */
  selector: string;
  /**
   * Optional human-readable role (e.g. `'primary-cta'`). Informational; preserved
   * in `AssertionResult` so reports can explain failures.
   */
  role?: string;
  expect: {
    /** Hex literal or token reference, e.g. `'{colors.primary}'`. */
    backgroundColor?: string;
    /** Hex literal or token reference, e.g. `'{colors.on-primary}'`. */
    color?: string;
    /** Family name or token reference, e.g. `'{typography.h1.fontFamily}'`. */
    fontFamily?: string;
    /** Token reference for the minimum font-size (px or rem). */
    minFontSize?: string;
    /** Regex the element's textContent must match. */
    textPattern?: RegExp;
    /** Minimum number of children matching `selector`. */
    minChildren?: number;
  };
}

export interface Task {
  id: string;
  prompt: string;
  /** CSS selectors that must each match at least one element in the rendered HTML. */
  expectedElements?: string[];
  /** Per-element semantic checks resolved against the design system. */
  assertions?: SemanticAssertion[];
}

export interface DesignFixture {
  id: string;
  /** Absolute path to a DESIGN.md file. */
  path: string;
}

export interface Agent {
  id: string;
  /** Render the task. The harness passes the formatted context as `context`. */
  render(task: Task, context: string): Promise<string>;
}

export interface ExtractedOutput {
  colors: string[];
  fontFamilies: string[];
  pxDimensions: number[];
  remDimensions: number[];
}

export interface AssertionResult {
  selector: string;
  role?: string;
  passed: boolean;
  /** Per-failure detail, e.g. `'backgroundColor #abcdef ~ {colors.primary}=#123456'`. */
  detail: string;
}

export interface CopyFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
}

export interface Score {
  /** Mean perceptual distance between an output color and the nearest token color, normalized to [0,1]. Higher is better. */
  colorScore: number;
  /** Fraction of unique font-families in the output that appear in the design system. */
  typographyScore: number;
  /** Fraction of dimensions in the output that snap to the spacing/rounded scale (within tolerance). */
  spacingScore: number;
  /** Voice/copy linter rules applied to the rendered output. Absent when layer disabled. */
  copyScore?: number;
  /** Fraction of `task.assertions` that passed. Absent when layer disabled or task has no assertions. */
  semanticScore?: number;
  /** Fraction of `task.expectedElements` selectors that found at least one match. Absent when layer disabled. */
  structuralScore?: number;
  /** Vision-judge fidelity score (0–1). Absent unless `--vision-judge`. */
  visionScore?: number;
  /** Weighted mean of the subscores actually produced. */
  aggregate: number;
}

export interface ScoreWeights {
  color: number;
  typography: number;
  spacing: number;
  copy: number;
  semantic: number;
  structural: number;
  vision: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  color: 0.30,
  typography: 0.10,
  spacing: 0.10,
  copy: 0.15,
  semantic: 0.20,
  structural: 0.05,
  vision: 0.10,
};

export interface LayerToggles {
  copy?: boolean;
  semantic?: boolean;
  structural?: boolean;
  /** Render screenshots. Required for vision and persisted as PNGs when set. */
  screenshot?: boolean;
  /** Vision judge. Implies screenshot. */
  vision?: boolean;
}

export interface RunRecord {
  designId: string;
  taskId: string;
  format: Format;
  agentId: string;
  output: string;
  extracted: ExtractedOutput;
  score: Score;
  /** Per-assertion outcomes; populated when the semantic layer ran. */
  assertions?: AssertionResult[];
  /** Findings from the copy-rule layer. */
  copyFindings?: CopyFinding[];
  /** Vision-judge rationale, when the layer ran. */
  visionRationale?: string;
  /** Path to the persisted screenshot, if `--screenshots` was enabled. */
  screenshotPath?: string;
}

export interface Report {
  startedAt: string;
  finishedAt: string;
  runs: RunRecord[];
  /** Aggregate scores grouped by format — the A/B answer. */
  byFormat: Record<Format, { count: number; mean: Score }>;
}
