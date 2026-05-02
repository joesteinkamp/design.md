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

// ── Real-model agents ─────────────────────────────────────────────
// All three lazy-load their SDK so the default eval (mock-only) does not
// require any provider SDK to be present at import time.

const SYSTEM_PROMPT =
  'You are a UI engineer. Use only the design system provided in <design_system>. Output only a complete self-contained HTML document with inline CSS — no external resources, no markdown fences, no commentary.';

function buildUserPrompt(taskPrompt: string, context: string): string {
  return `<design_system>\n${context}\n</design_system>\n\n${taskPrompt}`;
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

interface ProviderModelOverride {
  /** Override the default model id. */
  model?: string;
}

let anthropicClientPromise: Promise<any> | undefined;
let openaiClientPromise: Promise<any> | undefined;
let geminiClientPromise: Promise<any> | undefined;

async function getAnthropic(): Promise<any> {
  if (!anthropicClientPromise) {
    anthropicClientPromise = (async () => {
      const mod = await import('@anthropic-ai/sdk');
      const Anthropic = (mod as any).default ?? (mod as any).Anthropic;
      return new Anthropic();
    })();
  }
  return anthropicClientPromise;
}

async function getOpenAI(): Promise<any> {
  if (!openaiClientPromise) {
    openaiClientPromise = (async () => {
      const mod = await import('openai');
      const OpenAI = (mod as any).default ?? (mod as any).OpenAI;
      return new OpenAI();
    })();
  }
  return openaiClientPromise;
}

async function getGemini(): Promise<any> {
  if (!geminiClientPromise) {
    geminiClientPromise = (async () => {
      const mod = await import('@google/genai');
      const GoogleGenAI = (mod as any).GoogleGenAI;
      const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
      return new GoogleGenAI({ apiKey });
    })();
  }
  return geminiClientPromise;
}

/** Render via Anthropic Claude. Requires `ANTHROPIC_API_KEY`. */
export function makeClaudeAgent(opts: ProviderModelOverride = {}): Agent {
  const model = opts.model ?? 'claude-sonnet-4-6';
  return {
    id: `claude:${model}`,
    async render(task, context) {
      const client = await getAnthropic();
      const message = await client.messages.create({
        model,
        max_tokens: 4096,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `<design_system>\n${context}\n</design_system>`,
                cache_control: { type: 'ephemeral' },
              },
              { type: 'text', text: task.prompt },
            ],
          },
        ],
      });
      const text = (message.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string)
        .join('');
      return stripMarkdownFences(text);
    },
  };
}

/** Render via OpenAI. Requires `OPENAI_API_KEY`. */
export function makeOpenAIAgent(opts: ProviderModelOverride = {}): Agent {
  const model = opts.model ?? 'gpt-4o';
  return {
    id: `openai:${model}`,
    async render(task, context) {
      const client = await getOpenAI();
      const completion = await client.chat.completions.create({
        model,
        max_completion_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(task.prompt, context) },
        ],
      });
      const text = completion.choices?.[0]?.message?.content ?? '';
      return stripMarkdownFences(text);
    },
  };
}

/** Render via Google Gemini. Requires `GEMINI_API_KEY` or `GOOGLE_API_KEY`. */
export function makeGeminiAgent(opts: ProviderModelOverride = {}): Agent {
  const model = opts.model ?? 'gemini-2.5-flash';
  return {
    id: `gemini:${model}`,
    async render(task, context) {
      const client = await getGemini();
      const response = await client.models.generateContent({
        model,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          maxOutputTokens: 4096,
        },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(task.prompt, context) }] }],
      });
      const text =
        typeof response.text === 'string'
          ? response.text
          : (response.candidates?.[0]?.content?.parts ?? [])
              .map((p: any) => p.text ?? '')
              .join('');
      return stripMarkdownFences(text);
    },
  };
}

/** Default Claude agent at the canonical model. */
export const claudeAgent = makeClaudeAgent();

/** Default OpenAI agent at the canonical model. */
export const openaiAgent = makeOpenAIAgent();

/** Default Gemini agent at the canonical model. */
export const geminiAgent = makeGeminiAgent();
