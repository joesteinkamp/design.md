// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import type { ParsedDesign } from './formats.js';
import type { ExtractedOutput, Score, ScoreWeights } from './types.js';
import { DEFAULT_WEIGHTS } from './types.js';

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FONT_FAMILY_DECL_RE = /font-family\s*:\s*([^;"'}]+)/gi;
const PX_RE = /(\d+(?:\.\d+)?)px\b/g;
const REM_RE = /(\d+(?:\.\d+)?)rem\b/g;

export const COLOR_TOLERANCE = 0.05;
export const DIM_TOLERANCE = 0.5;

export function extract(html: string): ExtractedOutput {
  const colors = unique(html.match(HEX_RE) ?? []).map(normalizeHex);
  const fontFamilies = unique(
    [...html.matchAll(FONT_FAMILY_DECL_RE)].flatMap((m) =>
      (m[1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean),
    ),
  );
  const pxDimensions = unique([...html.matchAll(PX_RE)].map((m) => parseFloat(m[1]!)));
  const remDimensions = unique([...html.matchAll(REM_RE)].map((m) => parseFloat(m[1]!)));
  return { colors, fontFamilies, pxDimensions, remDimensions };
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function normalizeHex(h: string): string {
  let hex = h.toLowerCase().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 4) hex = hex.split('').map((c) => c + c).join('').slice(0, 8);
  return '#' + hex.slice(0, 6);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** sRGB Euclidean distance, normalized to [0,1]. Placeholder for proper deltaE. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const d = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  return d / Math.sqrt(3 * 255 ** 2);
}

export function tokenColors(fm: Record<string, any>): string[] {
  const colors = (fm['colors'] ?? {}) as Record<string, unknown>;
  return Object.values(colors)
    .filter((v): v is string => typeof v === 'string' && v.startsWith('#'))
    .map(normalizeHex);
}

function tokenFontFamilies(fm: Record<string, any>): Set<string> {
  const ff = new Set<string>();
  const typography = (fm['typography'] ?? {}) as Record<string, any>;
  for (const v of Object.values(typography)) {
    const family = (v as { fontFamily?: string })?.fontFamily;
    if (family) {
      for (const part of String(family).split(',')) {
        ff.add(part.trim().replace(/^["']|["']$/g, ''));
      }
    }
  }
  return ff;
}

function tokenPx(fm: Record<string, any>): number[] {
  const out: number[] = [];
  for (const key of ['spacing', 'rounded']) {
    const block = (fm[key] ?? {}) as Record<string, unknown>;
    for (const v of Object.values(block)) {
      if (typeof v === 'string') {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(v);
        if (m) out.push(parseFloat(m[1]!));
      }
      if (typeof v === 'number') out.push(v);
    }
  }
  return out;
}

function tokenRem(fm: Record<string, any>): number[] {
  const out: number[] = [];
  for (const key of ['spacing', 'rounded']) {
    const block = (fm[key] ?? {}) as Record<string, unknown>;
    for (const v of Object.values(block)) {
      if (typeof v === 'string') {
        const m = /^(\d+(?:\.\d+)?)rem$/.exec(v);
        if (m) out.push(parseFloat(m[1]!));
      }
    }
  }
  return out;
}

/**
 * Score the token-level extracted output against the source design system.
 * Aggregate is computed by combineScore against the (color, typography, spacing)
 * subscores only — additional layers are merged in by the runner.
 */
export function score(extracted: ExtractedOutput, design: ParsedDesign): Pick<Score, 'colorScore' | 'typographyScore' | 'spacingScore'> {
  const palette = tokenColors(design.frontmatter);
  const families = tokenFontFamilies(design.frontmatter);
  const pxScale = tokenPx(design.frontmatter);
  const remScale = tokenRem(design.frontmatter);

  const colorScore =
    extracted.colors.length === 0 || palette.length === 0
      ? 0
      : extracted.colors.filter((c) => palette.some((p) => colorDistance(c, p) <= COLOR_TOLERANCE)).length /
        extracted.colors.length;

  const typographyScore =
    extracted.fontFamilies.length === 0
      ? 0
      : extracted.fontFamilies.filter((f) => families.has(f)).length / extracted.fontFamilies.length;

  const allDims = [
    ...extracted.pxDimensions.map((d) => ({ d, scale: pxScale })),
    ...extracted.remDimensions.map((d) => ({ d, scale: remScale })),
  ];
  const spacingScore =
    allDims.length === 0
      ? 0
      : allDims.filter(({ d, scale }) => scale.some((s) => Math.abs(d - s) <= DIM_TOLERANCE)).length /
        allDims.length;

  return { colorScore, typographyScore, spacingScore };
}

/**
 * Combine subscores into a weighted aggregate. Weights for absent subscores
 * are dropped from both numerator and denominator, so disabling a layer does
 * not dilute the result.
 */
export function combineScore(parts: Partial<Score>, weights: ScoreWeights = DEFAULT_WEIGHTS): number {
  const entries: Array<[number | undefined, number]> = [
    [parts.colorScore, weights.color],
    [parts.typographyScore, weights.typography],
    [parts.spacingScore, weights.spacing],
    [parts.copyScore, weights.copy],
    [parts.semanticScore, weights.semantic],
    [parts.structuralScore, weights.structural],
    [parts.visionScore, weights.vision],
  ];
  let num = 0;
  let den = 0;
  for (const [v, w] of entries) {
    if (typeof v === 'number') {
      num += w * v;
      den += w;
    }
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Resolve a `'{tokens.path}'` reference against the parsed frontmatter.
 * Returns the resolved value (string for colors and font families, object for
 * typography blocks) or `undefined` when the reference does not resolve.
 */
export function resolveTokenRef(ref: string, fm: Record<string, any>): unknown {
  const m = /^\{([^}]+)\}$/.exec(ref.trim());
  if (!m) return undefined;
  const parts = m[1]!.split('.');
  let cur: any = fm;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Compute the per-format mean by averaging each subscore across runs that produced it. */
export function meanScore(scores: Score[]): Score {
  const empty: Score = { colorScore: 0, typographyScore: 0, spacingScore: 0, aggregate: 0 };
  if (scores.length === 0) return empty;
  const fields = ['colorScore', 'typographyScore', 'spacingScore', 'copyScore', 'semanticScore', 'structuralScore', 'visionScore', 'aggregate'] as const;
  const out: Record<string, number | undefined> = {};
  for (const f of fields) {
    const values = scores.map((s) => s[f]).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) {
      out[f] = f === 'colorScore' || f === 'typographyScore' || f === 'spacingScore' || f === 'aggregate' ? 0 : undefined;
    } else {
      out[f] = values.reduce((a, b) => a + b, 0) / values.length;
    }
  }
  return out as unknown as Score;
}
