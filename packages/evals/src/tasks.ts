// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License").

import type { Task } from './types.js';

export const TASKS: Task[] = [
  {
    id: 'marketing-hero',
    prompt:
      'Build a marketing hero section. It must contain an H1, a one-sentence subhead, and a primary CTA button. Output a complete self-contained HTML document with inline CSS — no external resources, no comments, no explanation prose.',
    expectedElements: ['h1', 'p', 'button'],
    assertions: [
      {
        selector: 'button',
        role: 'primary-cta',
        expect: {
          backgroundColor: '{colors.primary}',
          color: '{colors.on-primary}',
        },
      },
      {
        selector: 'body',
        role: 'page-surface',
        expect: {
          backgroundColor: '{colors.surface}',
        },
      },
    ],
  },
  {
    id: 'pricing-card',
    prompt:
      'Build a single pricing card. It must contain a tier name, a price, three feature bullets, and a primary CTA button. Output a complete self-contained HTML document with inline CSS — no external resources, no comments, no explanation prose.',
    expectedElements: ['h2', 'ul', 'li', 'button'],
    assertions: [
      {
        selector: 'button',
        role: 'primary-cta',
        expect: {
          backgroundColor: '{colors.primary}',
          color: '{colors.on-primary}',
        },
      },
      {
        selector: 'ul',
        role: 'features',
        expect: {
          minChildren: 3,
        },
      },
    ],
  },
  {
    id: 'app-shell-topbar',
    prompt:
      'Build an app-shell top bar. It must contain a brand mark on the left, three nav links in the middle, and a user avatar circle on the right. Output a complete self-contained HTML document with inline CSS — no external resources, no comments, no explanation prose.',
    expectedElements: ['header', 'nav', 'nav a'],
    assertions: [
      {
        selector: 'header',
        role: 'topbar',
        expect: {
          backgroundColor: '{colors.surface}',
        },
      },
      {
        selector: 'nav',
        role: 'main-nav',
        expect: {
          minChildren: 3,
        },
      },
    ],
  },
];
