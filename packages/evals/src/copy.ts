// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import { parseHTML } from 'linkedom';

import {
  approvedTermViolationRule,
  bannedTermInProseRule,
  buttonExceedsWordLimitRule,
  casingMismatchRule,
  errorPatternViolationRule,
  reservedNameFormRule,
} from '@google/design.md/linter';
import type {
  ComponentDef,
  DesignSystemState,
  RegistryEntry,
} from '@google/design.md/linter';
import type { DocumentSection } from '@google/design.md/linter';
import type { CopyFinding } from './types.js';

const COPY_RULE_DESCRIPTORS = [
  bannedTermInProseRule,
  approvedTermViolationRule,
  buttonExceedsWordLimitRule,
  errorPatternViolationRule,
  casingMismatchRule,
  reservedNameFormRule,
];

interface VirtualBuild {
  state: DesignSystemState;
  /** Number of label-bearing virtual components we synthesized. Used to normalize the score. */
  labelCount: number;
}

/**
 * Build a `DesignSystemState` whose `copy`/`voice`/`themes`/etc. come from the
 * cached source-design lint result, but whose `components`, `componentRegistry`,
 * and `documentSections` are synthesized from the agent's HTML output. The
 * cached state's other fields are reused unchanged so the rules see the same
 * type-shaped object the linter passes them.
 */
export function buildVirtualState(html: string, cached: DesignSystemState): VirtualBuild {
  const { document } = parseHTML(`<!doctype html><html><body>${stripDoctype(html)}</body></html>`);

  const components = new Map<string, ComponentDef>();
  const registry = new Map<string, RegistryEntry>();

  let labelCount = 0;

  // Buttons
  for (const [i, btn] of [...document.querySelectorAll('button')].entries()) {
    const name = `button-${i + 1}`;
    addComponent(components, registry, name, 'button', btn.textContent ?? '');
    labelCount++;
  }

  // Section headings
  for (const [i, h] of [...document.querySelectorAll('h1, h2, h3')].entries()) {
    const name = `heading-${i + 1}`;
    addComponent(components, registry, name, 'section-heading', h.textContent ?? '');
    labelCount++;
  }

  // Navigation links
  for (const [i, a] of [...document.querySelectorAll('nav a')].entries()) {
    const name = `nav-link-${i + 1}`;
    addComponent(components, registry, name, 'navigation', a.textContent ?? '');
    labelCount++;
  }

  // Synthesize a single document section whose content is the rendered text body.
  // Prose rules iterate over `documentSections[].content` line-by-line.
  const proseText = textOfBody(document);
  const documentSections: DocumentSection[] = [
    {
      heading: 'rendered',
      content: proseText,
      startLine: 1,
      endLine: Math.max(1, proseText.split('\n').length),
      suppressions: [],
      codeBlockRanges: [],
    },
  ];

  // Shallow clone of the cached state with our virtual fields replacing the
  // component map, registry, and sections. Type-shape parity with the original
  // state is what matters; the rules don't read tokens here.
  const state: DesignSystemState = {
    ...cached,
    components,
    componentRegistry: registry,
    documentSections,
  };

  return { state, labelCount };
}

function addComponent(
  components: Map<string, ComponentDef>,
  registry: Map<string, RegistryEntry>,
  name: string,
  kind: 'button' | 'navigation' | 'section-heading',
  label: string,
): void {
  const trimmed = label.trim();
  if (trimmed.length === 0) return;
  const properties = new Map<string, string>([['label', trimmed]]);
  components.set(name, {
    properties,
    states: new Map(),
    resolvedStates: new Map(),
    unresolvedRefs: [],
    referencedTokens: [],
    propertyRefs: new Map(),
    stateRefs: new Map(),
  } as ComponentDef);
  registry.set(name, {
    name,
    kind,
    interactive: kind === 'button' || kind === 'navigation',
    requiredProperties: [],
  });
}

function stripDoctype(html: string): string {
  return html.replace(/<!doctype[^>]*>/i, '').replace(/<\/?(html|body)[^>]*>/gi, '');
}

function textOfBody(document: Document): string {
  const body = document.querySelector('body');
  return (body?.textContent ?? '').trim();
}

/**
 * Run the six copy-rule descriptors against the agent's HTML output.
 * Returns the raw findings plus a normalized score in [0,1] where 1.0 means
 * "no findings against any synthesized label/prose unit".
 */
export function scoreCopy(html: string, cached: DesignSystemState): { score: number; findings: CopyFinding[] } {
  const { state, labelCount } = buildVirtualState(html, cached);
  const findings: CopyFinding[] = [];
  for (const desc of COPY_RULE_DESCRIPTORS) {
    for (const f of desc.run(state)) {
      findings.push({
        rule: desc.name,
        severity: f.severity ?? desc.severity,
        message: f.message,
        ...(f.path !== undefined ? { path: f.path } : {}),
      });
    }
  }
  // Score: 1 minus the rate of findings per labeled unit, floored at 0.
  // No labels and no findings = 1.0 (nothing to violate).
  const denom = Math.max(labelCount, 1);
  const score = Math.max(0, 1 - findings.length / denom);
  return { score, findings };
}
