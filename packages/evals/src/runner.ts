// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lint } from '@google/design.md/linter';
import type { DesignSystemState } from '@google/design.md/linter';

import { scoreCopy } from './copy.js';
import { formatContext, loadDesign, type ParsedDesign } from './formats.js';
import { combineScore, extract, meanScore, score } from './score.js';
import { scoreSemantic, scoreStructural } from './semantic.js';
import {
  DEFAULT_WEIGHTS,
  type Agent,
  type DesignFixture,
  type Format,
  type LayerToggles,
  type Report,
  type RunRecord,
  type Score,
  type ScoreWeights,
  type Task,
} from './types.js';

export interface RunOptions {
  designs: DesignFixture[];
  tasks: Task[];
  formats: Format[];
  agents: Agent[];
  /** Which optional layers to run. Defaults: copy + semantic + structural enabled. */
  layers?: LayerToggles;
  /** Aggregate weights. */
  weights?: ScoreWeights;
  /** When set, screenshots and the JSON report are written under this directory. */
  reportsDir?: string;
}

const DEFAULT_LAYERS: LayerToggles = {
  copy: true,
  semantic: true,
  structural: true,
  screenshot: false,
  vision: false,
};

export async function run(options: RunOptions): Promise<Report> {
  const startedAt = new Date().toISOString();
  const layers = { ...DEFAULT_LAYERS, ...(options.layers ?? {}) };
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const runs: RunRecord[] = [];

  // Per-design lint cache: one parse + model + lint pass per design provides
  // the authoritative state.copy / componentRegistry / etc. that the copy
  // rules reuse across every cell.
  const cachedStates = new Map<string, DesignSystemState>();

  for (const design of options.designs) {
    const parsed = loadDesign(design.path);
    cachedStates.set(design.id, lint(parsed.raw).designSystem);
    for (const task of options.tasks) {
      for (const format of options.formats) {
        const context = formatContext(format, parsed);
        for (const agent of options.agents) {
          const output = await agent.render(task, context);
          const record = await scoreCell({
            output,
            parsed,
            task,
            cached: cachedStates.get(design.id)!,
            layers,
            weights,
            reportsDir: options.reportsDir,
            cellId: `${design.id}-${task.id}-${format}-${agent.id}`,
          });
          runs.push({
            designId: design.id,
            taskId: task.id,
            format,
            agentId: agent.id,
            output,
            ...record,
          });
        }
      }
    }
  }

  if (layers.screenshot || layers.vision) {
    const { shutdownRenderer } = await import('./render.js');
    await shutdownRenderer();
  }

  const byFormat = aggregateByFormat(runs, options.formats);
  return { startedAt, finishedAt: new Date().toISOString(), runs, byFormat };
}

interface CellInput {
  output: string;
  parsed: ParsedDesign;
  task: Task;
  cached: DesignSystemState;
  layers: LayerToggles;
  weights: ScoreWeights;
  reportsDir?: string | undefined;
  cellId: string;
}

async function scoreCell(input: CellInput): Promise<Omit<RunRecord, 'designId' | 'taskId' | 'format' | 'agentId' | 'output'>> {
  const extracted = extract(input.output);
  const tokenScores = score(extracted, input.parsed);
  const partial: Score = { ...tokenScores, aggregate: 0 };
  const out: Omit<RunRecord, 'designId' | 'taskId' | 'format' | 'agentId' | 'output'> = {
    extracted,
    score: partial,
  };

  if (input.layers.copy) {
    const c = scoreCopy(input.output, input.cached);
    partial.copyScore = c.score;
    out.copyFindings = c.findings;
  }

  if (input.layers.semantic) {
    const s = scoreSemantic(input.output, input.parsed, input.task);
    if (s) {
      partial.semanticScore = s.score;
      out.assertions = s.results;
    }
  }

  if (input.layers.structural) {
    const s = scoreStructural(input.output, input.task);
    if (typeof s === 'number') {
      partial.structuralScore = s;
    }
  }

  if (input.layers.screenshot || input.layers.vision) {
    const { renderToPng } = await import('./render.js');
    const png = await renderToPng(input.output);
    if (input.reportsDir) {
      const screenshotPath = join(input.reportsDir, 'screenshots', `${input.cellId}.png`);
      mkdirSync(dirname(screenshotPath), { recursive: true });
      writeFileSync(screenshotPath, png);
      out.screenshotPath = screenshotPath;
    }
    if (input.layers.vision) {
      const { scoreVision } = await import('./vision.js');
      const v = await scoreVision(png, input.parsed, input.task);
      partial.visionScore = v.score;
      out.visionRationale = v.rationale;
    }
  }

  partial.aggregate = combineScore(partial, input.weights);
  return out;
}

function aggregateByFormat(runs: RunRecord[], formats: Format[]): Report['byFormat'] {
  const out = {} as Report['byFormat'];
  for (const fmt of formats) {
    const subset = runs.filter((r) => r.format === fmt);
    const scores: Score[] = subset.map((r) => r.score);
    out[fmt] = { count: subset.length, mean: meanScore(scores) };
  }
  return out;
}
