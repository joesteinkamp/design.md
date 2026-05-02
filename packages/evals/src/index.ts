// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { offBrandMockAgent, tokenAwareMockAgent } from './agents.js';
import { selectAgents, selectVisionProvider } from './cli-helpers.js';
import { run } from './runner.js';
import { TASKS } from './tasks.js';
import type { DesignFixture, Format, LayerToggles, Score } from './types.js';
import type { VisionProvider } from './vision.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const DEFAULT_DESIGNS: DesignFixture[] = [
  { id: 'paws-and-paths', path: join(REPO_ROOT, 'examples/paws-and-paths/DESIGN.md') },
  { id: 'atmospheric-glass', path: join(REPO_ROOT, 'examples/atmospheric-glass/DESIGN.md') },
  { id: 'totality-festival', path: join(REPO_ROOT, 'examples/totality-festival/DESIGN.md') },
];

const DEFAULT_FORMATS: Format[] = ['designmd', 'prose', 'dtcg', 'none'];

const ALL_LAYERS = ['copy', 'semantic', 'structural', 'screenshot', 'vision'] as const;
type LayerName = (typeof ALL_LAYERS)[number];

function parseLayers(arg: string): LayerToggles {
  const tokens = arg.split(',').map((s) => s.trim()).filter(Boolean);
  const out: LayerToggles = { copy: false, semantic: false, structural: false, screenshot: false, vision: false };
  for (const t of tokens) {
    if ((ALL_LAYERS as readonly string[]).includes(t)) {
      out[t as LayerName] = true;
    } else {
      throw new Error(`Unknown layer '${t}'. Known: ${ALL_LAYERS.join(', ')}`);
    }
  }
  if (out.vision) out.screenshot = true;
  return out;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main() {
  const args = process.argv.slice(2);
  const outPath = flag(args, '--out') ?? 'eval-report.json';
  const layersArg = flag(args, '--layers');
  const layers: LayerToggles = layersArg ? parseLayers(layersArg) : { copy: true, semantic: true, structural: true };
  const screenshotsExplicit = hasFlag(args, '--screenshots');
  if (screenshotsExplicit) layers.screenshot = true;

  const visionProviderArg = flag(args, '--vision-provider') as VisionProvider | undefined;
  const visionModelArg = flag(args, '--vision-model');
  if (hasFlag(args, '--vision-judge')) {
    layers.vision = true;
    layers.screenshot = true;
  }

  const env = (k: string): string | undefined => process.env[k];

  let resolvedVisionProvider: VisionProvider | undefined;
  if (layers.vision) {
    const requested = visionProviderArg ?? 'claude';
    const result = selectVisionProvider(requested, env);
    for (const w of result.warnings) console.warn(`warn: ${w}`);
    if (!result.provider) {
      layers.vision = false;
      if (!screenshotsExplicit) layers.screenshot = false;
    } else {
      resolvedVisionProvider = result.provider;
    }
  }

  const agentsArg = flag(args, '--agents');
  const requestedAgentIds = agentsArg
    ? agentsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  let agents;
  if (requestedAgentIds) {
    const result = selectAgents(requestedAgentIds, env);
    for (const w of result.warnings) console.warn(`warn: ${w}`);
    if (result.agents.length === 0) {
      throw new Error('No agents available to run. Set the missing API keys or pick a mock agent.');
    }
    agents = result.agents;
  } else {
    agents = [tokenAwareMockAgent, offBrandMockAgent];
  }

  const reportsDir = dirname(resolve(outPath));

  const visionOptions = layers.vision && resolvedVisionProvider
    ? {
        provider: resolvedVisionProvider,
        ...(visionModelArg ? { model: visionModelArg } : {}),
      }
    : undefined;

  const report = await run({
    designs: DEFAULT_DESIGNS,
    tasks: TASKS,
    formats: DEFAULT_FORMATS,
    agents,
    layers,
    reportsDir,
    ...(visionOptions ? { vision: visionOptions } : {}),
  });

  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Wrote ${report.runs.length} runs to ${outPath}`);
  console.log('Mean scores by format:');
  for (const [format, { count, mean }] of Object.entries(report.byFormat)) {
    console.log(`  ${format.padEnd(10)} n=${String(count).padEnd(3)} ${formatMean(mean)}`);
  }
}

function formatMean(m: Score): string {
  const cells: string[] = [
    `agg=${m.aggregate.toFixed(3)}`,
    `color=${m.colorScore.toFixed(3)}`,
    `type=${m.typographyScore.toFixed(3)}`,
    `space=${m.spacingScore.toFixed(3)}`,
  ];
  if (typeof m.copyScore === 'number') cells.push(`copy=${m.copyScore.toFixed(3)}`);
  if (typeof m.semanticScore === 'number') cells.push(`sem=${m.semanticScore.toFixed(3)}`);
  if (typeof m.structuralScore === 'number') cells.push(`struct=${m.structuralScore.toFixed(3)}`);
  if (typeof m.visionScore === 'number') cells.push(`vis=${m.visionScore.toFixed(3)}`);
  return cells.join(' ');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
