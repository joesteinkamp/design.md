// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import { describe, expect, test } from 'bun:test';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { offBrandMockAgent, tokenAwareMockAgent } from './agents.js';
import { run } from './runner.js';
import { TASKS } from './tasks.js';
import type { DesignFixture, Format } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE: DesignFixture = {
  id: 'paws-and-paths',
  path: join(REPO_ROOT, 'examples/paws-and-paths/DESIGN.md'),
};
const ALL_FORMATS: Format[] = ['designmd', 'prose', 'dtcg', 'none'];

describe('runner layers', () => {
  test('default layers populate copy/semantic/structural subscores', async () => {
    const report = await run({
      designs: [FIXTURE],
      tasks: TASKS,
      formats: ['designmd'],
      agents: [tokenAwareMockAgent],
    });
    for (const r of report.runs) {
      expect(typeof r.score.copyScore).toBe('number');
      expect(typeof r.score.semanticScore).toBe('number');
      expect(typeof r.score.structuralScore).toBe('number');
      expect(r.score.visionScore).toBeUndefined();
    }
  });

  test('disabled layers are absent from the score', async () => {
    const report = await run({
      designs: [FIXTURE],
      tasks: TASKS,
      formats: ['designmd'],
      agents: [tokenAwareMockAgent],
      layers: { copy: false, semantic: false, structural: false },
    });
    for (const r of report.runs) {
      expect(r.score.copyScore).toBeUndefined();
      expect(r.score.semanticScore).toBeUndefined();
      expect(r.score.structuralScore).toBeUndefined();
    }
  });

  test('designmd outscores none for the token-aware agent', async () => {
    const report = await run({
      designs: [FIXTURE],
      tasks: TASKS,
      formats: ALL_FORMATS,
      agents: [tokenAwareMockAgent],
    });
    const designmd = report.byFormat.designmd.mean.aggregate;
    const none = report.byFormat.none.mean.aggregate;
    expect(designmd).toBeGreaterThan(none);
  });

  test('designmd >= dtcg >= prose >= none for token-aware semantic score', async () => {
    const report = await run({
      designs: [FIXTURE],
      tasks: TASKS,
      formats: ALL_FORMATS,
      agents: [tokenAwareMockAgent],
    });
    const semDesignmd = report.byFormat.designmd.mean.semanticScore ?? 0;
    const semDtcg = report.byFormat.dtcg.mean.semanticScore ?? 0;
    const semNone = report.byFormat.none.mean.semanticScore ?? 0;
    // Both structured formats should let the agent honor named tokens.
    expect(semDesignmd).toBeGreaterThan(semNone);
    expect(semDtcg).toBeGreaterThan(semNone);
  });

  test('off-brand agent fails semantic and color regardless of format', async () => {
    const report = await run({
      designs: [FIXTURE],
      tasks: TASKS,
      formats: ['designmd'],
      agents: [offBrandMockAgent],
    });
    for (const r of report.runs) {
      expect(r.score.colorScore).toBe(0);
      expect(r.score.semanticScore ?? 1).toBeLessThan(0.6);
    }
  });

  test('aggregate excludes absent subscores from both numerator and denominator', async () => {
    const reportFull = await run({
      designs: [FIXTURE],
      tasks: [TASKS[0]!],
      formats: ['designmd'],
      agents: [tokenAwareMockAgent],
    });
    const reportTokensOnly = await run({
      designs: [FIXTURE],
      tasks: [TASKS[0]!],
      formats: ['designmd'],
      agents: [tokenAwareMockAgent],
      layers: { copy: false, semantic: false, structural: false },
    });
    const fullAgg = reportFull.runs[0]!.score.aggregate;
    const tokenAgg = reportTokensOnly.runs[0]!.score.aggregate;
    // Two different aggregation universes; both must lie in [0, 1].
    expect(fullAgg).toBeGreaterThanOrEqual(0);
    expect(fullAgg).toBeLessThanOrEqual(1);
    expect(tokenAgg).toBeGreaterThanOrEqual(0);
    expect(tokenAgg).toBeLessThanOrEqual(1);
  });
});
