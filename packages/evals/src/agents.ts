// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import type { Agent, Task } from './types.js';

const FONT_FAMILY_RE = /fontFamily\s*[:=]\s*["']?([^"'\n,;}]+)/g;

const OFF_BRAND_PALETTE = ['#ff00ff', '#00ff00', '#ffff00', '#1abc9c', '#e74c3c'];
const OFF_BRAND_FONTS = ['Comic Sans MS', 'Impact', 'Times New Roman'];

interface TokenPalette {
  surface: string;
  onSurface: string;
  primary: string;
  onPrimary: string;
  font: string;
  /** Concrete pixel sizes pulled from the context's spacing/rounded scale. */
  space: number;
  radius: number;
  big: number;
}

/**
 * Locate a named color token in the supplied context. Recognizes both
 * DESIGN.md frontmatter (`primary: "#abcdef"`) and DTCG (`"primary": { ...
 * "$value": "#abcdef" }`) shapes. Returns undefined when the name is absent —
 * which is how `prose` / `none` formats end up off-brand.
 */
function findColorToken(context: string, name: string): string | undefined {
  const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const yamlRe = new RegExp(`(^|\\n)\\s*${escaped}\\s*:\\s*"?(#[0-9a-fA-F]{3,8})`);
  const yamlMatch = yamlRe.exec(context);
  if (yamlMatch) return yamlMatch[2];
  const dtcgRe = new RegExp(`"${escaped}"\\s*:\\s*\\{[^}]*"\\$value"\\s*:\\s*"(#[0-9a-fA-F]{3,8})"`);
  const dtcgMatch = dtcgRe.exec(context);
  if (dtcgMatch) return dtcgMatch[1];
  return undefined;
}

function findFirstFont(context: string): string | undefined {
  for (const m of context.matchAll(FONT_FAMILY_RE)) {
    const family = (m[1] ?? '').trim();
    if (family) return family;
  }
  return undefined;
}

function findFirstPx(context: string, after: number): number | undefined {
  const re = /(\d+(?:\.\d+)?)px/g;
  for (const m of context.matchAll(re)) {
    const n = parseFloat(m[1]!);
    if (n >= after) return n;
  }
  return undefined;
}

function pickTokenPalette(context: string): TokenPalette | undefined {
  const surface = findColorToken(context, 'surface');
  const onSurface = findColorToken(context, 'on-surface');
  const primary = findColorToken(context, 'primary');
  const onPrimary = findColorToken(context, 'on-primary');
  if (!surface || !onSurface || !primary || !onPrimary) return undefined;
  const font = findFirstFont(context) ?? 'system-ui';
  const space = findFirstPx(context, 4) ?? 16;
  const radius = findFirstPx(context, 2) ?? 8;
  const big = findFirstPx(context, 24) ?? 32;
  return { surface, onSurface, primary, onPrimary, font, space, radius, big };
}

function offBrandPalette(): TokenPalette {
  return {
    surface: OFF_BRAND_PALETTE[0]!,
    onSurface: OFF_BRAND_PALETTE[1]!,
    primary: OFF_BRAND_PALETTE[2]!,
    onPrimary: OFF_BRAND_PALETTE[3]!,
    font: OFF_BRAND_FONTS[0]!,
    space: 11,
    radius: 13,
    big: 23,
  };
}

function renderHtml(task: Task, p: TokenPalette): string {
  const ff = `${p.font}, system-ui, sans-serif`;
  const styleBase = `font-family: ${ff}; background: ${p.surface}; color: ${p.onSurface}; padding: ${p.big}px;`;
  const btn = `background: ${p.primary}; color: ${p.onPrimary}; padding: ${p.space}px ${p.big}px; border: 0; border-radius: ${p.radius}px; font-family: ${ff};`;
  switch (task.id) {
    case 'marketing-hero':
      return `<!doctype html><html><body style="${styleBase}"><h1 style="font-family:${ff}">Ship faster</h1><p style="font-family:${ff}">A one-sentence pitch about the product.</p><button style="${btn}">Get started</button></body></html>`;
    case 'pricing-card':
      return `<!doctype html><html><body style="${styleBase}"><div style="background:${p.surface};color:${p.onSurface};padding:${p.big}px;border-radius:${p.radius}px;font-family:${ff}"><h2 style="font-family:${ff}">Pro</h2><p style="font-family:${ff};font-size:32px">$29 / mo</p><ul style="font-family:${ff}"><li>Unlimited projects</li><li>Priority support</li><li>SSO</li></ul><button style="${btn}">Choose Pro</button></div></body></html>`;
    case 'app-shell-topbar':
      return `<!doctype html><html><body style="${styleBase}"><header style="display:flex;gap:${p.space}px;padding:${p.space}px;background:${p.surface};color:${p.onSurface};font-family:${ff}"><span style="font-family:${ff}">Brand</span><nav style="display:flex;gap:${p.space}px;flex:1;font-family:${ff}"><a style="color:${p.onSurface};font-family:${ff}">Home</a><a style="color:${p.onSurface};font-family:${ff}">Docs</a><a style="color:${p.onSurface};font-family:${ff}">Pricing</a></nav><div style="width:${p.big}px;height:${p.big}px;border-radius:${p.big}px;background:${p.primary}"></div></header></body></html>`;
    default:
      return `<!doctype html><html><body style="${styleBase}"></body></html>`;
  }
}

export const tokenAwareMockAgent: Agent = {
  id: 'mock-token-aware',
  async render(task, context) {
    const palette = pickTokenPalette(context) ?? offBrandPalette();
    return renderHtml(task, palette);
  },
};

export const offBrandMockAgent: Agent = {
  id: 'mock-off-brand',
  async render(task, _context) {
    return renderHtml(task, offBrandPalette());
  },
};

/**
 * Real LLM agent. Wire in @anthropic-ai/sdk (or any SDK) here.
 * The system prompt should instruct the model to honor the provided context
 * and emit only HTML.
 */
export const claudeAgent: Agent = {
  id: 'claude',
  async render(_task, _context) {
    throw new Error(
      'claudeAgent: not wired. Add @anthropic-ai/sdk and replace this body with a messages.create call.',
    );
  },
};
