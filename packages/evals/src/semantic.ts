// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import { parseHTML } from 'linkedom';

import type { ParsedDesign } from './formats.js';
import { COLOR_TOLERANCE, DIM_TOLERANCE, colorDistance, normalizeHex, resolveTokenRef } from './score.js';
import type { AssertionResult, SemanticAssertion, Task } from './types.js';

/** Score per-element semantic assertions. Returns undefined when the task has none. */
export function scoreSemantic(html: string, design: ParsedDesign, task: Task): { score: number; results: AssertionResult[] } | undefined {
  if (!task.assertions || task.assertions.length === 0) return undefined;
  const { document } = parseHTML(html);
  const results: AssertionResult[] = [];
  for (const a of task.assertions) {
    results.push(evaluateAssertion(document, a, design));
  }
  const passed = results.filter((r) => r.passed).length;
  return { score: passed / results.length, results };
}

/** Score the structural-element layer. Returns undefined when no expected list. */
export function scoreStructural(html: string, task: Task): number | undefined {
  if (!task.expectedElements || task.expectedElements.length === 0) return undefined;
  const { document } = parseHTML(html);
  let hits = 0;
  for (const sel of task.expectedElements) {
    if (document.querySelector(sel)) hits++;
  }
  return hits / task.expectedElements.length;
}

function evaluateAssertion(document: Document, assertion: SemanticAssertion, design: ParsedDesign): AssertionResult {
  const result: AssertionResult = {
    selector: assertion.selector,
    ...(assertion.role !== undefined ? { role: assertion.role } : {}),
    passed: false,
    detail: '',
  };
  const el = document.querySelector(assertion.selector) as HTMLElement | null;
  if (!el) {
    result.detail = `no element matched '${assertion.selector}'`;
    return result;
  }

  const inline = parseInlineStyle(el.getAttribute('style') ?? '');

  const failures: string[] = [];

  if (assertion.expect.backgroundColor !== undefined) {
    const expected = resolveColor(assertion.expect.backgroundColor, design);
    const actual = firstHex(inline.get('background') ?? inline.get('background-color') ?? '');
    if (!actual || !expected || colorDistance(actual, expected) > COLOR_TOLERANCE) {
      failures.push(`background ${actual ?? '(none)'} ≁ ${assertion.expect.backgroundColor}`);
    }
  }

  if (assertion.expect.color !== undefined) {
    const expected = resolveColor(assertion.expect.color, design);
    const actual = firstHex(inline.get('color') ?? '');
    if (!actual || !expected || colorDistance(actual, expected) > COLOR_TOLERANCE) {
      failures.push(`color ${actual ?? '(none)'} ≁ ${assertion.expect.color}`);
    }
  }

  if (assertion.expect.fontFamily !== undefined) {
    const expected = resolveFontFamily(assertion.expect.fontFamily, design);
    const actual = firstFamily(inline.get('font-family') ?? '');
    if (!actual || !expected || actual.toLowerCase() !== expected.toLowerCase()) {
      failures.push(`font-family ${actual ?? '(none)'} ≠ ${expected ?? assertion.expect.fontFamily}`);
    }
  }

  if (assertion.expect.minFontSize !== undefined) {
    const expected = resolveDimensionPx(assertion.expect.minFontSize, design);
    const actual = parsePx(inline.get('font-size') ?? '');
    if (expected === undefined || actual === undefined || actual + DIM_TOLERANCE < expected) {
      failures.push(`font-size ${actual ?? '(none)'} < ${expected ?? assertion.expect.minFontSize}`);
    }
  }

  if (assertion.expect.textPattern) {
    const text = (el.textContent ?? '').trim();
    if (!assertion.expect.textPattern.test(text)) {
      failures.push(`text '${text.slice(0, 40)}' did not match ${assertion.expect.textPattern}`);
    }
  }

  if (assertion.expect.minChildren !== undefined) {
    const count = el.children.length;
    if (count < assertion.expect.minChildren) {
      failures.push(`children ${count} < ${assertion.expect.minChildren}`);
    }
  }

  result.passed = failures.length === 0;
  result.detail = failures.length === 0 ? 'ok' : failures.join('; ');
  return result;
}

function parseInlineStyle(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const k = decl.slice(0, idx).trim().toLowerCase();
    const v = decl.slice(idx + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}

function firstHex(value: string): string | undefined {
  const m = /#[0-9a-fA-F]{3,8}\b/.exec(value);
  return m ? normalizeHex(m[0]) : undefined;
}

function firstFamily(value: string): string | undefined {
  const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first || undefined;
}

function parsePx(value: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)px\b/.exec(value);
  if (m) return parseFloat(m[1]!);
  const r = /(\d+(?:\.\d+)?)rem\b/.exec(value);
  if (r) return parseFloat(r[1]!) * 16;
  return undefined;
}

function resolveColor(ref: string, design: ParsedDesign): string | undefined {
  if (ref.startsWith('#')) return normalizeHex(ref);
  const v = resolveTokenRef(ref, design.frontmatter);
  return typeof v === 'string' && v.startsWith('#') ? normalizeHex(v) : undefined;
}

function resolveFontFamily(ref: string, design: ParsedDesign): string | undefined {
  if (!ref.startsWith('{')) return ref;
  const v = resolveTokenRef(ref, design.frontmatter);
  if (typeof v === 'string') return v.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  if (v && typeof v === 'object' && 'fontFamily' in v) {
    const family = (v as { fontFamily?: string }).fontFamily;
    return family?.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

function resolveDimensionPx(ref: string, design: ParsedDesign): number | undefined {
  if (!ref.startsWith('{')) return parsePx(ref);
  const v = resolveTokenRef(ref, design.frontmatter);
  if (typeof v === 'string') return parsePx(v);
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'fontSize' in v) {
    const fs = (v as { fontSize?: string | number }).fontSize;
    if (typeof fs === 'string') return parsePx(fs);
    if (typeof fs === 'number') return fs;
  }
  return undefined;
}
