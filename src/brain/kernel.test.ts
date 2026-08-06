import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { BrainKernel } from './index.js';
import type { BrainKernelError } from './index.js';

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const FIXED_NOW = new Date('2026-08-06T20:00:00.000Z');
const temporaryDirectories: string[] = [];

function concept(
  title: string,
  options: {
    description?: string;
    type?: string;
    tags?: readonly string[];
    extraFrontmatter?: string;
    body?: string;
  } = {},
): string {
  const tags = options.tags ?? ['test'];
  return `---
type: ${options.type ?? 'Test Concept'}
title: ${title}
description: ${options.description ?? `Grounded information about ${title}.`}
tags: [${tags.join(', ')}]
status: stable
generated: { by: process:test, at: "2026-08-06T10:00:00Z" }
stale_after: "2026-09-06"
owner: team:test
visibility: internal
publication:
  status: prohibited
${options.extraFrontmatter ?? ''}---
# ${title}

${options.body ?? `${title} helps the company operate with reliable facts.`}
`;
}

async function createFixture(): Promise<{
  repository: string;
  root: string;
  kernel: BrainKernel;
}> {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'company-brain-kernel-'));
  temporaryDirectories.push(repository);
  const root = path.join(repository, 'brain');
  await mkdir(path.join(root, 'product'), { recursive: true });
  await writeFile(
    path.join(root, 'index.md'),
    `---
okf_version: "0.2"
---
# Test Brain

- [Product](product/)
`,
  );
  await writeFile(
    path.join(root, 'product', 'index.md'),
    `# Product

- [Alpha](alpha.md)
- [Beta](beta.md)
`,
  );
  await writeFile(
    path.join(root, 'product', 'alpha.md'),
    concept('Alpha assistant', {
      description: 'Fast Allegro support automation for sellers.',
      type: 'Product Knowledge',
      tags: ['product', 'allegro', 'support'],
      body: `## Promise

Alpha gives Allegro sellers practical operational control.

## Evidence

Every public claim needs a source. See [Beta](beta.md#workflow).`,
    }),
  );
  await writeFile(
    path.join(root, 'product', 'beta.md'),
    concept('Beta workflow', {
      description: 'A calm workflow for support teams.',
      type: 'Operating Practice',
      tags: ['product', 'workflow'],
      body: `## Workflow

Support teams review grounded answers before publication.`,
    }),
  );
  const kernel = new BrainKernel({
    rootDir: root,
    repositoryRoot: repository,
    now: () => FIXED_NOW,
  });
  await kernel.refresh();
  return { repository, root, kernel };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('BrainKernel discovery and retrieval', () => {
  it('discovers the real Company Brain profile and derives IDs and domains from paths', async () => {
    const kernel = new BrainKernel({
      rootDir: path.join(REPOSITORY_ROOT, 'brain'),
      repositoryRoot: REPOSITORY_ROOT,
      now: () => FIXED_NOW,
    });

    await kernel.refresh();

    expect(kernel.health().indexedConceptCount).toBeGreaterThanOrEqual(27);
    expect(kernel.validate().errors).toBe(0);
    expect(kernel.concepts.find((item) => item.id === 'company/identity')).toMatchObject({
      domain: 'company',
      sourcePath: 'brain/company/identity.md',
      type: 'Company Profile',
    });
    expect(kernel.concepts.some((item) => item.id.endsWith('/index'))).toBe(false);
  });

  it('gets concepts by ID or repository path and returns a selected heading only', async () => {
    const { kernel } = await createFixture();

    const byId = kernel.get({ conceptId: 'product/alpha', heading: 'Promise' });
    const byPath = kernel.get({ path: 'brain/product/alpha.md', heading: '#promise' });

    expect(byId.content).toContain('Alpha gives Allegro sellers');
    expect(byId.content).not.toContain('Every public claim');
    expect(byPath.content).toBe(byId.content);
    expect(byId.citations[0]).toEqual({
      path: 'brain/product/alpha.md',
      anchor: 'promise',
    });
  });

  it('rejects traversal and ambiguous request shapes without exposing outside files', async () => {
    const { kernel } = await createFixture();

    expect(() => kernel.get({ path: '../secret.md' })).toThrow(
      expect.objectContaining<Partial<BrainKernelError>>({ code: 'UNSAFE_PATH' }),
    );
    expect(() => kernel.get({ path: '/etc/passwd' })).toThrow(
      expect.objectContaining<Partial<BrainKernelError>>({ code: 'UNSAFE_PATH' }),
    );
    expect(() => kernel.get({ conceptId: 'product/alpha', path: 'product/alpha.md' })).toThrow(
      expect.objectContaining<Partial<BrainKernelError>>({ code: 'INVALID_REQUEST' }),
    );
  });

  it('does not index a symlink that escapes the brain root', async () => {
    const { repository, root, kernel } = await createFixture();
    const outside = path.join(repository, 'outside.md');
    await writeFile(outside, concept('Outside secret'));
    await symlink(outside, path.join(root, 'product', 'escape.md'));

    await kernel.refresh();

    expect(kernel.validate().issues.map((item) => item.code)).toContain(
      'SYMLINK_ESCAPES_BRAIN_ROOT',
    );
    expect(() => kernel.get({ path: 'product/escape.md' })).toThrow(
      expect.objectContaining<Partial<BrainKernelError>>({ code: 'NOT_FOUND' }),
    );
  });
});

describe('BrainKernel deterministic search and context selection', () => {
  it('ranks deterministically and applies domain, type, and all-tag filters', async () => {
    const { kernel } = await createFixture();
    const input = {
      query: 'Allegro seller support',
      domains: ['PRODUCT'],
      types: ['Product Knowledge'],
      tags: ['product', 'support'],
      limit: 5,
    } as const;

    const first = kernel.search(input);
    const second = kernel.search(input);

    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      conceptId: 'product/alpha',
      sourcePath: 'brain/product/alpha.md',
    });
    expect(first[0]?.excerpt.length).toBeLessThanOrEqual(260);
  });

  it('builds a deduplicated context pack within both character and token-derived bounds', async () => {
    const { kernel } = await createFixture();

    const pack = kernel.contextPack({
      objective: 'Explain the Allegro support workflow',
      seedConceptIds: ['product/alpha', 'product/alpha'],
      maxCharacters: 500,
      approximateTokenBudget: 100,
    });

    expect(pack.content.length).toBeLessThanOrEqual(400);
    expect(pack.selection.maxCharacters).toBe(400);
    expect(pack.selection.usedCharacters).toBe(pack.content.length);
    expect(pack.concepts.filter((item) => item.conceptId === 'product/alpha')).toHaveLength(1);
    expect(new Set(pack.citations.map((item) => JSON.stringify(item))).size).toBe(
      pack.citations.length,
    );

    const tinyPack = kernel.contextPack({
      objective: 'Explain the workflow',
      maxCharacters: 80,
    });
    expect(tinyPack.selection.maxCharacters).toBe(80);
    expect(tinyPack.content.length).toBeLessThanOrEqual(80);
  });

  it('returns stable domain summaries with type and owner counts', async () => {
    const { kernel } = await createFixture();

    expect(kernel.listDomains()).toEqual({
      domains: [
        {
          domain: 'product',
          conceptCount: 2,
          types: [
            { type: 'Operating Practice', count: 1 },
            { type: 'Product Knowledge', count: 1 },
          ],
          owners: [{ owner: 'team:test', count: 2 }],
          validation: { errors: 0, warnings: 0 },
        },
      ],
      totalConcepts: 2,
      totalTypes: 2,
      totalOwners: 1,
    });
  });
});

describe('BrainKernel validation and virtual changes', () => {
  it('detects duplicate path-derived IDs across supported file formats', async () => {
    const { kernel } = await createFixture();
    const yamlConcept = `type: Test Concept
title: Duplicate Alpha
description: Same path-derived ID with another extension.
status: stable
generated: { by: process:test, at: "2026-08-06T10:00:00Z" }
owner: team:test
visibility: internal
publication: { status: prohibited }
body: Duplicate.
`;

    const validation = kernel.validate({
      changes: [{ operation: 'create', path: 'brain/product/alpha.yaml', content: yamlConcept }],
    });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_CONCEPT_ID',
          conceptId: 'product/alpha',
        }),
      ]),
    );
  });

  it('detects broken links and frontmatter relations in proposed exact content', async () => {
    const { kernel } = await createFixture();
    const changed = concept('Alpha assistant', {
      extraFrontmatter: `relations:
  - product/missing
`,
      body: 'See [missing knowledge](missing.md).',
    });

    const validation = kernel.validate({
      changes: [{ operation: 'update', path: 'product/alpha.md', content: changed }],
    });
    const codes = validation.issues.map((item) => item.code);

    expect(codes).toContain('BROKEN_LINK');
    expect(codes).toContain('INVALID_RELATION_TARGET');
    expect(validation.overlayApplied).toBe(true);
    expect(kernel.get({ conceptId: 'product/alpha' }).content).toContain(
      'practical operational control',
    );
  });

  it('rejects unsafe change paths and stale expected hashes', async () => {
    const { kernel } = await createFixture();

    const validation = kernel.validate({
      changes: [
        { operation: 'create', path: '../escape.md', content: concept('Escape') },
        {
          operation: 'update',
          path: 'product/alpha.md',
          content: concept('Updated'),
          expectedPreviousContentHash: '0'.repeat(64),
        },
      ],
    });

    expect(validation.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['UNSAFE_CHANGE_PATH', 'EXPECTED_HASH_MISMATCH']),
    );
  });

  it('validates a complete candidate Git tree without consulting deployed candidate files', async () => {
    const { kernel } = await createFixture();
    const alpha = concept('Alpha assistant', {
      extraFrontmatter: `sources:
  - id: candidate-evidence
    resource: ../../evidence/source.md
`,
      body: 'Candidate evidence is linked by source metadata.[^candidate-evidence]',
    });
    const candidate = new Map<string, string>([
      [
        'brain/index.md',
        `---
okf_version: "0.2"
---
# Brain

- [Product](product/)
`,
      ],
      ['brain/product/index.md', '# Product\n\n- [Alpha](alpha.md)\n'],
      ['brain/product/alpha.md', alpha],
      ['evidence/source.md', '# Source\n'],
    ]);

    const valid = kernel.validateCandidateFiles(candidate);
    expect(valid.issues.map((item) => item.code)).not.toContain('SOURCE_TARGET_MISSING');

    candidate.delete('evidence/source.md');
    const invalid = kernel.validateCandidateFiles(candidate);
    expect(invalid.issues.map((item) => item.code)).toContain('SOURCE_TARGET_MISSING');
  });
});
