// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { ParsedDesignSystem } from '../parser/spec.js';
import type {
  ModelSpec,
  ModelResult,
  ResolvedColor,
  ResolvedDimension,
  ResolvedTypography,
  ResolvedShadow,
  ResolvedValue,
  ComponentDef,
  Finding,
} from './spec.js';

import { isValidColor, isParseableDimension, isTokenReference, parseDimensionParts } from './spec.js';
import { COMPONENT_SUB_TOKEN_VALIDATORS } from '../component-validators.js';

const MAX_REFERENCE_DEPTH = 10;

/**
 * Builds a resolved DesignSystemState from parsed YAML tokens.
 * Handles color parsing, dimension parsing, typography construction,
 * and chained token reference resolution with cycle detection.
 * Never throws — all errors returned as ModelResult failures.
 */
export class ModelHandler implements ModelSpec {
  execute(input: ParsedDesignSystem): ModelResult {
    try {
      const findings: Finding[] = [];
      const symbolTable = new Map<string, ResolvedValue>();
      const colors = new Map<string, ResolvedColor>();
      const typography = new Map<string, ResolvedTypography>();
      const rounded = new Map<string, ResolvedDimension>();
      const spacing = new Map<string, ResolvedDimension>();
      const elevation = new Map<string, ResolvedShadow>();

      // ── Phase 1: Resolve primitive tokens ──────────────────────────
      // Colors
      if (input.colors) {
        for (const [name, raw] of Object.entries(input.colors)) {
          if (isTokenReference(raw)) {
            // Store raw reference for later resolution
            symbolTable.set(`colors.${name}`, raw);
          } else if (isValidColor(raw)) {
            const resolved = parseColor(raw);
            colors.set(name, resolved);
            symbolTable.set(`colors.${name}`, resolved);
          } else {
            findings.push({
              severity: 'error',
              path: `colors.${name}`,
              message: `'${raw}' is not a valid color. Expected a hex color code (e.g., #ffffff).`,
            });
            // Store as-is for fallback
            symbolTable.set(`colors.${name}`, raw);
          }
        }
      }

      // Typography
      if (input.typography) {
        for (const [name, props] of Object.entries(input.typography)) {
          const resolved = parseTypography(props, `typography.${name}`, findings);
          typography.set(name, resolved);
          symbolTable.set(`typography.${name}`, resolved);
        }
      }

      // Rounded
      if (input.rounded) {
        for (const [name, raw] of Object.entries(input.rounded)) {
          if (typeof raw === 'string') {
            if (isParseableDimension(raw)) {
              const resolved = parseDimension(raw);
              if (resolved.unit !== 'px' && resolved.unit !== 'rem' && resolved.unit !== 'em') {
                findings.push({
                  severity: 'error',
                  path: `rounded.${name}`,
                  message: `'${raw}' has an invalid unit '${resolved.unit}'. Only px, rem, and em are allowed.`,
                });
              }
              rounded.set(name, resolved);
              symbolTable.set(`rounded.${name}`, resolved);
            } else if (!isTokenReference(raw)) {
              findings.push({
                severity: 'error',
                path: `rounded.${name}`,
                message: `'${raw}' is not a valid dimension.`,
              });
              symbolTable.set(`rounded.${name}`, raw);
            } else {
              symbolTable.set(`rounded.${name}`, raw);
            }
          }
        }
      }

      // Spacing
      if (input.spacing) {
        for (const [name, raw] of Object.entries(input.spacing)) {
          if (isParseableDimension(raw)) {
            const resolved = parseDimension(raw);
            spacing.set(name, resolved);
            symbolTable.set(`spacing.${name}`, resolved);
          } else {
            symbolTable.set(`spacing.${name}`, raw);
          }
        }
      }

      // Elevation — semantic shadow tokens (resting / raised / overlay / modal).
      // Values are CSS shadow strings; validation is generous to match the
      // wide CSS shadow grammar.
      if (input.elevation) {
        for (const [name, raw] of Object.entries(input.elevation)) {
          if (typeof raw !== 'string') continue;
          if (isTokenReference(raw)) {
            symbolTable.set(`elevation.${name}`, raw);
          } else {
            const shadow: ResolvedShadow = { type: 'shadow', raw };
            elevation.set(name, shadow);
            symbolTable.set(`elevation.${name}`, shadow);
          }
        }
      }

      // ── Phase 2: Resolve chained color references ──────────────────
      // Iterate color entries that are still raw references and resolve them
      if (input.colors) {
        for (const [name, raw] of Object.entries(input.colors)) {
          if (isTokenReference(raw)) {
            const resolved = resolveReference(symbolTable, raw.slice(1, -1), new Set());
            if (resolved !== null && typeof resolved === 'object' && 'type' in resolved && resolved.type === 'color') {
              colors.set(name, resolved as ResolvedColor);
              symbolTable.set(`colors.${name}`, resolved);
            }
          }
        }
      }

      // Resolve chained rounded references
      if (input.rounded) {
        for (const [name, raw] of Object.entries(input.rounded)) {
          if (typeof raw === 'string' && isTokenReference(raw)) {
            const resolved = resolveReference(symbolTable, raw.slice(1, -1), new Set());
            if (
              resolved !== null &&
              typeof resolved === 'object' &&
              'type' in resolved &&
              resolved.type === 'dimension'
            ) {
              rounded.set(name, resolved as ResolvedDimension);
              symbolTable.set(`rounded.${name}`, resolved);
            }
          }
        }
      }

      // Resolve chained spacing references
      if (input.spacing) {
        for (const [name, raw] of Object.entries(input.spacing)) {
          if (typeof raw === 'string' && isTokenReference(raw)) {
            const resolved = resolveReference(symbolTable, raw.slice(1, -1), new Set());
            if (
              resolved !== null &&
              typeof resolved === 'object' &&
              'type' in resolved &&
              resolved.type === 'dimension'
            ) {
              spacing.set(name, resolved as ResolvedDimension);
              symbolTable.set(`spacing.${name}`, resolved);
            }
          }
        }
      }

      // Resolve chained elevation references
      if (input.elevation) {
        for (const [name, raw] of Object.entries(input.elevation)) {
          if (typeof raw === 'string' && isTokenReference(raw)) {
            const resolved = resolveReference(symbolTable, raw.slice(1, -1), new Set());
            if (
              resolved !== null &&
              typeof resolved === 'object' &&
              'type' in resolved &&
              resolved.type === 'shadow'
            ) {
              elevation.set(name, resolved as ResolvedShadow);
              symbolTable.set(`elevation.${name}`, resolved);
            }
          }
        }
      }

      // ── Phase 3: Build components ──────────────────────────────────
      const components = new Map<string, ComponentDef>();
      if (input.components) {
        for (const [compName, props] of Object.entries(input.components)) {
          const properties = new Map<string, ResolvedValue>();
          const unresolvedRefs: string[] = [];

          for (const [propName, rawValue] of Object.entries(props)) {
            // Validate the raw author input against the typed schema.
            // Token references and resolution failures are not validated
            // here — those are handled by the broken-ref rule.
            const validator = COMPONENT_SUB_TOKEN_VALIDATORS.get(propName);
            if (validator && typeof rawValue === 'string') {
              const result = validator(rawValue);
              if (!result.ok) {
                findings.push({
                  severity: 'error',
                  path: `components.${compName}.${propName}`,
                  message: result.error ?? `Invalid value for '${propName}'.`,
                });
              }
            }

            // `elevation: raised` (bare semantic name) → look up in the
            // elevation map even though the author didn't write a {ref}.
            if (propName === 'elevation' && typeof rawValue === 'string'
                && !isTokenReference(rawValue) && !isValidColor(rawValue)
                && !isParseableDimension(rawValue)) {
              const resolved = symbolTable.get(`elevation.${rawValue.trim()}`);
              if (resolved !== undefined) {
                properties.set(propName, resolved);
                continue;
              }
            }

            if (isTokenReference(rawValue)) {
              const refPath = rawValue.slice(1, -1);
              const resolved = resolveReference(symbolTable, refPath, new Set());
              if (resolved !== null) {
                properties.set(propName, resolved);
              } else {
                unresolvedRefs.push(rawValue);
                properties.set(propName, rawValue);
              }
            } else if (isValidColor(rawValue)) {
              properties.set(propName, parseColor(rawValue));
            } else if (isParseableDimension(rawValue)) {
              properties.set(propName, parseDimension(rawValue));
            } else {
              properties.set(propName, rawValue);
            }
          }

          components.set(compName, { properties, unresolvedRefs });
        }
      }

      return {
        designSystem: {
          name: input.name,
          description: input.description,
          colors,
          typography,
          rounded,
          spacing,
          elevation,
          components,
          symbolTable,
          sections: input.sections,
        },
        findings,
      };
    } catch (error) {
      return {
        designSystem: {
          colors: new Map(),
          typography: new Map(),
          rounded: new Map(),
          spacing: new Map(),
          elevation: new Map(),
          components: new Map(),
          symbolTable: new Map(),
        },
        findings: [
          {
            severity: 'error',
            message: `Unexpected error during model building: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
}

// ── Pure utility functions ─────────────────────────────────────────

/**
 * Parse a hex color string into a ResolvedColor with RGB + WCAG luminance.
 */
export function parseColor(raw: string): ResolvedColor {
  let hex = raw;

  // Normalize #RGB to #RRGGBB
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  // Normalize #RGBA to #RRGGBBAA
  if (hex.length === 5) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${hex[4]}${hex[4]}`;
  }

  hex = hex.toLowerCase();

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  let a: number | undefined;
  if (hex.length === 9) {
    a = parseInt(hex.slice(7, 9), 16) / 255;
  }

  const luminance = computeLuminance(r, g, b);

  return { type: 'color', hex, r, g, b, a, luminance };
}

/**
 * Compute WCAG 2.1 relative luminance.
 * Uses sRGB linearization.
 */
function computeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Parse a dimension string like "42px" or "1.5rem".
 */
function parseDimension(raw: string): ResolvedDimension {
  const parts = parseDimensionParts(raw);
  if (!parts) {
    throw new Error(`Invalid dimension: ${raw}`);
  }
  return {
    type: 'dimension',
    value: parts.value,
    unit: parts.unit,
  };
}

/**
 * Parse a typography properties object into a ResolvedTypography.
 */
function parseTypography(props: Record<string, string | number>, path: string, findings: Finding[]): ResolvedTypography {
  const result: ResolvedTypography = { type: 'typography' };

  if (typeof props['fontFamily'] === 'string') {
    const ff = props['fontFamily'];
    if (isValidColor(ff)) {
      findings.push({
        severity: 'error',
        path: `${path}.fontFamily`,
        message: `'${ff}' appears to be a color, not a valid font family.`,
      });
    }
    result.fontFamily = ff;
  }
  if (props['fontWeight'] !== undefined) {
    const fw = props['fontWeight'];
    let fwValue: number | undefined;

    if (typeof fw === 'number') {
      fwValue = fw;
    } else if (typeof fw === 'string') {
      const parsed = Number(fw);
      if (!isNaN(parsed)) {
        fwValue = parsed;
      }
    }

    if (fwValue === undefined) {
      findings.push({
        severity: 'error',
        path: `${path}.fontWeight`,
        message: `'${fw}' is not a valid font weight. Expected a number.`,
      });
    } else {
      result.fontWeight = fwValue;
    }
  }
  if (typeof props['fontFeature'] === 'string') result.fontFeature = props['fontFeature'];
  if (typeof props['fontVariation'] === 'string') result.fontVariation = props['fontVariation'];

  const dimensionProps = ['fontSize', 'lineHeight', 'letterSpacing'] as const;
  for (const prop of dimensionProps) {
    const raw = props[prop];
    if (typeof raw === 'string') {
      if (isParseableDimension(raw)) {
        const parsed = parseDimension(raw);
        if (parsed.unit !== 'px' && parsed.unit !== 'rem' && parsed.unit !== 'em') {
          findings.push({
            severity: 'error',
            path: `${path}.${prop}`,
            message: `'${raw}' has an invalid unit '${parsed.unit}'. Only px, rem, and em are allowed.`,
          });
        }
        result[prop] = parsed;
      } else if (prop === 'lineHeight' && /^\d*\.?\d+$/.test(raw)) {
        result[prop] = {
          type: 'dimension',
          value: parseFloat(raw),
          unit: '',
        };
      } else if (!isTokenReference(raw)) {
        findings.push({
          severity: 'error',
          path: `${path}.${prop}`,
          message: `'${raw}' is not a valid dimension.`,
        });
      }
    }
  }

  return result;
}

/**
 * Resolve a token reference with chained resolution and cycle detection.
 * Returns null if the reference cannot be resolved (not found or circular).
 */
function resolveReference(
  symbolTable: Map<string, ResolvedValue>,
  path: string,
  visited: Set<string>,
  depth: number = 0,
): ResolvedValue | null {
  if (depth > MAX_REFERENCE_DEPTH) return null;
  if (visited.has(path)) return null; // Circular reference
  visited.add(path);

  const value = symbolTable.get(path);
  if (value === undefined) return null;

  // If the value is itself a reference string, follow the chain
  if (typeof value === 'string' && isTokenReference(value)) {
    const innerPath = value.slice(1, -1);
    return resolveReference(symbolTable, innerPath, visited, depth + 1);
  }

  return value;
}

/**
 * WCAG 2.1 contrast ratio between two resolved colors.
 */
export function contrastRatio(a: ResolvedColor, b: ResolvedColor): number {
  const L1 = Math.max(a.luminance, b.luminance);
  const L2 = Math.min(a.luminance, b.luminance);
  return (L1 + 0.05) / (L2 + 0.05);
}