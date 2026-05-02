// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import { describe, expect, test } from 'bun:test';

import { selectAgents, selectVisionProvider } from './cli-helpers.js';

const noEnv = (_k: string) => undefined;
const env = (map: Record<string, string>) => (k: string) => map[k];

describe('selectAgents', () => {
  test('mock agents need no API keys', () => {
    const result = selectAgents(['mock-token-aware', 'mock-off-brand'], noEnv);
    expect(result.agents.map((a) => a.id)).toEqual(['mock-token-aware', 'mock-off-brand']);
    expect(result.warnings).toHaveLength(0);
  });

  test('provider agent without API key is skipped with a warning', () => {
    const result = selectAgents(['mock-token-aware', 'claude'], noEnv);
    expect(result.agents.map((a) => a.id)).toEqual(['mock-token-aware']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude');
    expect(result.warnings[0]).toContain('ANTHROPIC_API_KEY');
  });

  test('provider agent with API key is included', () => {
    const result = selectAgents(['claude'], env({ ANTHROPIC_API_KEY: 'sk-test' }));
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.id).toContain('claude');
    expect(result.warnings).toHaveLength(0);
  });

  test('Gemini accepts either GEMINI_API_KEY or GOOGLE_API_KEY', () => {
    const r1 = selectAgents(['gemini'], env({ GEMINI_API_KEY: 'g' }));
    const r2 = selectAgents(['gemini'], env({ GOOGLE_API_KEY: 'g' }));
    expect(r1.agents).toHaveLength(1);
    expect(r2.agents).toHaveLength(1);
  });

  test('unknown agent ids throw', () => {
    expect(() => selectAgents(['nope'], noEnv)).toThrow(/Unknown agent/);
  });

  test('mixing one provider with key and one without', () => {
    const result = selectAgents(['claude', 'openai'], env({ ANTHROPIC_API_KEY: 'sk' }));
    expect(result.agents.map((a) => a.id.split(':')[0])).toEqual(['claude']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('openai');
  });
});

describe('selectVisionProvider', () => {
  test('returns provider when key is present', () => {
    const result = selectVisionProvider('openai', env({ OPENAI_API_KEY: 'sk-test' }));
    expect(result.provider).toBe('openai');
    expect(result.warnings).toHaveLength(0);
  });

  test('drops provider with a warning when key is missing', () => {
    const result = selectVisionProvider('claude', noEnv);
    expect(result.provider).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('claude');
    expect(result.warnings[0]).toContain('ANTHROPIC_API_KEY');
  });

  test('throws on an unknown provider', () => {
    expect(() => selectVisionProvider('bogus' as 'claude', noEnv)).toThrow(/Unknown --vision-provider/);
  });
});
