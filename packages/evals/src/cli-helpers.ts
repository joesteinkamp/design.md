// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

/**
 * Pure helpers used by the CLI. Kept separate from `index.ts` so they can be
 * unit tested without invoking `main()`.
 */

import {
  claudeAgent,
  geminiAgent,
  offBrandMockAgent,
  openaiAgent,
  tokenAwareMockAgent,
} from './agents.js';
import type { Agent } from './types.js';
import type { VisionProvider } from './vision.js';

export const ALL_AGENTS: Record<string, Agent> = {
  'mock-token-aware': tokenAwareMockAgent,
  'mock-off-brand': offBrandMockAgent,
  claude: claudeAgent,
  openai: openaiAgent,
  gemini: geminiAgent,
};

export const PROVIDER_KEYS: Record<string, string[]> = {
  claude: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
};

export const VISION_PROVIDERS: VisionProvider[] = ['claude', 'openai', 'gemini'];

export type EnvLookup = (key: string) => string | undefined;

export interface SelectAgentsResult {
  agents: Agent[];
  warnings: string[];
}

/**
 * Resolve a comma-separated `--agents` list into runnable agents.
 * Unknown ids throw. Provider-backed agents missing their API key are
 * dropped with a warning. The caller is responsible for failing when no
 * agents survive.
 */
export function selectAgents(ids: string[], env: EnvLookup): SelectAgentsResult {
  const agents: Agent[] = [];
  const warnings: string[] = [];
  for (const id of ids) {
    const a = ALL_AGENTS[id];
    if (!a) {
      throw new Error(`Unknown agent '${id}'. Known: ${Object.keys(ALL_AGENTS).join(', ')}`);
    }
    if (!hasProviderKey(id, env)) {
      const keys = PROVIDER_KEYS[id]!.join(', ');
      warnings.push(`Skipping agent '${id}': none of ${keys} are set.`);
      continue;
    }
    agents.push(a);
  }
  return { agents, warnings };
}

export interface SelectVisionResult {
  provider?: VisionProvider;
  warnings: string[];
}

/**
 * Validate the requested vision provider and confirm its API key is present.
 * If the key is missing the provider is dropped with a warning; the caller
 * should disable the vision layer accordingly.
 */
export function selectVisionProvider(provider: VisionProvider, env: EnvLookup): SelectVisionResult {
  if (!VISION_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown --vision-provider '${provider}'. Known: ${VISION_PROVIDERS.join(', ')}`);
  }
  if (!hasProviderKey(provider, env)) {
    const keys = PROVIDER_KEYS[provider]!.join(', ');
    return { warnings: [`Skipping vision-judge: ${provider} requires one of ${keys}.`] };
  }
  return { provider, warnings: [] };
}

function hasProviderKey(id: string, env: EnvLookup): boolean {
  const keys = PROVIDER_KEYS[id];
  if (!keys) return true;
  return keys.some((k) => Boolean(env(k)));
}
