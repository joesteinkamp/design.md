// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

/**
 * Vision-judge layer. SDKs are loaded lazily so they're only required when
 * the corresponding `--vision-provider` is selected.
 */

import type { ParsedDesign } from './formats.js';
import type { Task } from './types.js';

export type VisionProvider = 'claude' | 'openai' | 'gemini';

export interface VisionOptions {
  provider?: VisionProvider;
  /** Override the default model for the chosen provider. */
  model?: string;
}

const SYSTEM_PROMPT =
  'You are a brand-fidelity judge. Score how faithfully the rendered UI honors the supplied design system on a scale of 0 to 1, where 1.0 means every color, type choice, spacing, and component treatment comes from the system and 0.0 means none of it does. Respond with only valid JSON of the form {"score": number, "rationale": string}. Do not include any other text.';

const DEFAULT_MODELS: Record<VisionProvider, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
};

let anthropicPromise: Promise<any> | undefined;
let openaiPromise: Promise<any> | undefined;
let geminiPromise: Promise<any> | undefined;

export async function scoreVision(
  png: Buffer,
  design: ParsedDesign,
  task: Task,
  opts: VisionOptions = {},
): Promise<{ score: number; rationale: string; provider: VisionProvider; model: string }> {
  const provider = opts.provider ?? 'claude';
  const model = opts.model ?? DEFAULT_MODELS[provider];
  const text = await callJudge(provider, model, png, design, task);
  const { score, rationale } = parseJudgeResponse(text);
  return { score, rationale, provider, model };
}

async function callJudge(
  provider: VisionProvider,
  model: string,
  png: Buffer,
  design: ParsedDesign,
  task: Task,
): Promise<string> {
  const base64 = png.toString('base64');
  const userText = `<task>${task.prompt}</task>\n<design_system>\n${design.raw}\n</design_system>`;
  switch (provider) {
    case 'claude':
      return callClaude(model, base64, userText);
    case 'openai':
      return callOpenAI(model, base64, userText);
    case 'gemini':
      return callGemini(model, base64, userText);
  }
}

async function callClaude(model: string, base64: string, userText: string): Promise<string> {
  const client = await getAnthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: userText, cache_control: { type: 'ephemeral' } },
        ],
      },
    ],
  });
  return (response.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text as string)
    .join('');
}

async function callOpenAI(model: string, base64: string, userText: string): Promise<string> {
  const client = await getOpenAI();
  const completion = await client.chat.completions.create({
    model,
    max_completion_tokens: 512,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          { type: 'text', text: userText },
        ],
      },
    ],
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

async function callGemini(model: string, base64: string, userText: string): Promise<string> {
  const client = await getGemini();
  const response = await client.models.generateContent({
    model,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64 } },
          { text: userText },
        ],
      },
    ],
  });
  return typeof response.text === 'string'
    ? response.text
    : (response.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p.text ?? '')
        .join('');
}

function parseJudgeResponse(text: string): { score: number; rationale: string } {
  const cleaned = text.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    const score = clampUnit(Number(parsed.score));
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : '';
    return { score, rationale };
  } catch {
    return { score: 0, rationale: `unparseable judge response: ${text.slice(0, 200)}` };
  }
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

async function getAnthropic(): Promise<any> {
  if (!anthropicPromise) {
    anthropicPromise = (async () => {
      const mod = await import('@anthropic-ai/sdk');
      const Anthropic = (mod as any).default ?? (mod as any).Anthropic;
      return new Anthropic();
    })();
  }
  return anthropicPromise;
}

async function getOpenAI(): Promise<any> {
  if (!openaiPromise) {
    openaiPromise = (async () => {
      const mod = await import('openai');
      const OpenAI = (mod as any).default ?? (mod as any).OpenAI;
      return new OpenAI();
    })();
  }
  return openaiPromise;
}

async function getGemini(): Promise<any> {
  if (!geminiPromise) {
    geminiPromise = (async () => {
      const mod = await import('@google/genai');
      const GoogleGenAI = (mod as any).GoogleGenAI;
      const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
      return new GoogleGenAI({ apiKey });
    })();
  }
  return geminiPromise;
}
