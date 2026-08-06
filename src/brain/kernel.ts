import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { BrainKernelError } from './errors.js';
import {
  extractHeadingSection,
  markdownToPlainText,
  normalizeHeadingSelector,
  parseBrainDocument,
  type ParsedBrainDocument,
  type ParsedHeading,
  type ParsedLink,
  type ParsedRelation,
} from './parser.js';
import type {
  BrainCitation,
  BrainConcept,
  BrainContextConcept,
  BrainContextFact,
  BrainContextPack,
  BrainContextPackInput,
  BrainDomainSummary,
  BrainDomainsReport,
  BrainGetInput,
  BrainGetResult,
  BrainHealthSnapshot,
  BrainKernelOptions,
  BrainRelation,
  BrainSearchInput,
  BrainSearchResult,
  BrainValidationInput,
  BrainValidationReport,
  ValidationIssue,
} from './types.js';

const { posix } = path;
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.yaml', '.yml', '.json']);
const VALID_STATUSES = new Set(['draft', 'stable', 'deprecated']);
const VALID_VISIBILITIES = new Set(['public', 'internal']);
const VALID_PUBLICATION_STATUSES = new Set(['approved', 'review-required', 'prohibited']);
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const HTTP_SCHEME = /^https?:\/\//iu;

interface RawBrainFile {
  readonly path: string;
  readonly sourcePath: string;
  readonly content: string;
  readonly modifiedAt: string;
  readonly sizeBytes: number;
}

interface Snapshot {
  readonly files: ReadonlyMap<string, RawBrainFile>;
  readonly documents: ReadonlyMap<string, ParsedBrainDocument>;
  readonly concepts: readonly BrainConcept[];
  readonly conceptsById: ReadonlyMap<string, readonly BrainConcept[]>;
  readonly conceptByPath: ReadonlyMap<string, BrainConcept>;
  readonly baseIssues: readonly ValidationIssue[];
  readonly validation: BrainValidationReport;
  readonly contentHash: string;
}

interface RuntimePaths {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly sourcePrefix: string;
}

interface ResolvedLink {
  readonly kind: 'bundle' | 'repository' | 'external' | 'anchor' | 'unsafe';
  readonly bundlePath?: string;
  readonly repositoryPath?: string;
  readonly anchor?: string;
  readonly reason?: string;
}

interface RelationResolution {
  readonly relation?: BrainRelation;
  readonly unsafe: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(value: string): string[] {
  return [...new Set(normalizeText(value).split(/\s+/u).filter(Boolean))];
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) >= 0) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function hashValues(values: readonly string[]): string {
  const hash = createHash('sha256');
  values.forEach((value) => hash.update(value, 'utf8').update('\0'));
  return hash.digest('hex');
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function isWithin(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function sourcePath(prefix: string, bundlePath: string): string {
  return prefix && prefix !== '.' ? posix.join(prefix, bundlePath) : bundlePath;
}

function conceptIdForPath(filePath: string): string {
  return filePath.slice(0, -posix.extname(filePath).length);
}

function domainForId(id: string): string {
  const slash = id.indexOf('/');
  return slash >= 0 ? id.slice(0, slash) : 'root';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mapping(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return mapping(value) !== undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  if (maximum <= 1) return value.slice(0, maximum);
  return `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function excerptFor(concept: BrainConcept, queryTokens: readonly string[], maximum = 260): string {
  const plain = markdownToPlainText(concept.body) || concept.summary || concept.title;
  if (plain.length <= maximum) return plain;
  const normalized = normalizeText(plain);
  const positions = queryTokens
    .map((token) => normalized.indexOf(token))
    .filter((position) => position >= 0);
  const matchPosition = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(
    0,
    Math.min(matchPosition - Math.floor(maximum / 3), plain.length - maximum),
  );
  const prefix = start > 0 ? '…' : '';
  const suffix = start + maximum < plain.length ? '…' : '';
  const allowance = maximum - prefix.length - suffix.length;
  return `${prefix}${plain.slice(start, start + allowance).trim()}${suffix}`;
}

function citationsFor(concept: BrainConcept, anchor?: string): BrainCitation[] {
  const citations: BrainCitation[] = [{ path: concept.sourcePath, ...(anchor ? { anchor } : {}) }];
  concept.sources.forEach((source) => {
    citations.push({
      path: concept.sourcePath,
      ...(anchor ? { anchor } : {}),
      ...(source.id ? { sourceId: source.id } : {}),
      resource: source.resource,
      ...(source.title ? { title: source.title } : {}),
    });
  });
  return citations;
}

function uniqueCitations(citations: readonly BrainCitation[]): BrainCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = [
      citation.path,
      citation.anchor ?? '',
      citation.sourceId ?? '',
      citation.resource ?? '',
    ].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort(
    (left, right) =>
      compareText(left.path ?? '', right.path ?? '') ||
      (left.line ?? 0) - (right.line ?? 0) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
  );
}

function validationIssue(
  severity: 'error' | 'warning',
  code: string,
  message: string,
  values: {
    readonly path?: string;
    readonly conceptId?: string;
    readonly line?: number;
    readonly relatedPaths?: readonly string[];
  } = {},
): ValidationIssue {
  return { severity, code, message, ...values };
}

function dateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function isoDateTime(value: unknown): boolean {
  return typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value));
}

function validActor(value: unknown): boolean {
  const actor = stringValue(value);
  return Boolean(actor && /^(?:human:[^\s]+|process:[^\s]+|[^\s/]+\/[^\s/]+)$/u.test(actor));
}

function safeExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export class BrainKernel {
  readonly #options: BrainKernelOptions;
  readonly #now: () => Date;
  readonly #controlledDomains: ReadonlySet<string> | undefined;
  readonly #controlledTypes: ReadonlySet<string> | undefined;
  #paths: RuntimePaths | undefined;
  #snapshot: Snapshot | undefined;
  #lastSuccessfulRefresh: string | null = null;
  #lastRefreshError: string | undefined;

  constructor(options: BrainKernelOptions) {
    if (!options.rootDir.trim()) {
      throw new BrainKernelError(
        'BRAIN_ROOT_INVALID',
        'The Company Brain root must be configured.',
      );
    }
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
    this.#controlledDomains = options.controlledDomains
      ? new Set(options.controlledDomains.map((value) => normalizeText(value)))
      : undefined;
    this.#controlledTypes = options.controlledTypes
      ? new Set(options.controlledTypes.map((value) => normalizeText(value)))
      : undefined;
  }

  async refresh(): Promise<BrainHealthSnapshot> {
    const previousPaths = this.#paths;
    try {
      const root = await realpath(path.resolve(this.#options.rootDir));
      const rootStats = await stat(root);
      if (!rootStats.isDirectory()) {
        throw new BrainKernelError(
          'BRAIN_ROOT_INVALID',
          'The configured Company Brain root is not a directory.',
        );
      }
      const configuredRepositoryRoot = this.#options.repositoryRoot
        ? path.resolve(this.#options.repositoryRoot)
        : path.dirname(root);
      const repositoryRoot = await realpath(configuredRepositoryRoot);
      if (!isWithin(root, repositoryRoot)) {
        throw new BrainKernelError(
          'BRAIN_ROOT_INVALID',
          'The Company Brain root must be located below the repository root.',
        );
      }
      const relativeRoot = toPosix(path.relative(repositoryRoot, root));
      const paths: RuntimePaths = {
        root,
        repositoryRoot,
        sourcePrefix: relativeRoot || '.',
      };
      const discovered = await this.#discover(paths);
      const checkedAt = this.#now().toISOString();
      // The synchronous snapshot build resolves bundle links through the candidate paths.
      // Restore the prior paths if the build fails, so an existing snapshot remains coherent.
      this.#paths = paths;
      const snapshot = this.#buildSnapshot(
        discovered.files,
        discovered.issues,
        paths,
        checkedAt,
        false,
      );

      this.#paths = paths;
      this.#snapshot = snapshot;
      this.#lastSuccessfulRefresh = checkedAt;
      this.#lastRefreshError = undefined;
      return this.health();
    } catch (error) {
      this.#paths = previousPaths;
      this.#lastRefreshError = 'Company Brain refresh failed.';
      if (error instanceof BrainKernelError) throw error;
      throw new BrainKernelError(
        'BRAIN_ROOT_INVALID',
        'The configured Company Brain root could not be read safely.',
      );
    }
  }

  get concepts(): readonly BrainConcept[] {
    return this.#requireSnapshot().concepts;
  }

  search(input: BrainSearchInput): readonly BrainSearchResult[] {
    const snapshot = this.#requireSnapshot();
    const query = input.query.trim();
    const queryNormalized = normalizeText(query);
    const queryTokens = tokens(query);
    const domains = new Set((input.domains ?? []).map(normalizeText));
    const types = new Set((input.types ?? []).map(normalizeText));
    const requiredTags = new Set((input.tags ?? []).map(normalizeText));
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 10)));

    const results: BrainSearchResult[] = [];
    for (const concept of snapshot.concepts) {
      if (domains.size > 0 && !domains.has(normalizeText(concept.domain))) continue;
      if (types.size > 0 && !types.has(normalizeText(concept.type))) continue;
      const normalizedTags = new Set(concept.tags.map(normalizeText));
      if ([...requiredTags].some((tag) => !normalizedTags.has(tag))) continue;

      const title = normalizeText(concept.title);
      const summary = normalizeText(concept.summary);
      const body = normalizeText(concept.body);
      const tags = normalizeText(concept.tags.join(' '));
      const headings = normalizeText(concept.headings.map((heading) => heading.text).join(' '));
      const metadata = normalizeText(
        [concept.domain, concept.type, concept.owner ?? '', concept.status ?? ''].join(' '),
      );

      let score = 0;
      if (queryNormalized) {
        if (title === queryNormalized) score += 180;
        if (title.includes(queryNormalized)) score += 100;
        if (summary.includes(queryNormalized)) score += 50;
        if (body.includes(queryNormalized)) score += 20;
      }
      let matchedTokens = 0;
      for (const token of queryTokens) {
        const tokenMatched =
          title.includes(token) ||
          summary.includes(token) ||
          body.includes(token) ||
          tags.includes(token) ||
          headings.includes(token) ||
          metadata.includes(token);
        if (tokenMatched) matchedTokens += 1;
        score += Math.min(3, countOccurrences(title, token)) * 42;
        score += Math.min(3, countOccurrences(tags, token)) * 28;
        score += Math.min(3, countOccurrences(summary, token)) * 20;
        score += Math.min(3, countOccurrences(headings, token)) * 12;
        score += Math.min(2, countOccurrences(metadata, token)) * 8;
        score += Math.min(6, countOccurrences(body, token)) * 4;
      }
      if (queryTokens.length > 0 && matchedTokens === queryTokens.length) score += 35;
      if (queryTokens.length > 0 && score === 0) continue;

      results.push({
        conceptId: concept.id,
        title: concept.title,
        summary: concept.summary,
        excerpt: excerptFor(concept, queryTokens),
        score,
        domain: concept.domain,
        type: concept.type,
        tags: concept.tags,
        ...(concept.owner ? { owner: concept.owner } : {}),
        ...(concept.status ? { status: concept.status } : {}),
        sourcePath: concept.sourcePath,
        citations: citationsFor(concept),
        contentHash: concept.contentHash,
      });
    }

    return results
      .sort(
        (left, right) => right.score - left.score || compareText(left.conceptId, right.conceptId),
      )
      .slice(0, limit);
  }

  get(input: BrainGetInput): BrainGetResult {
    const snapshot = this.#requireSnapshot();
    const hasConceptId = Boolean(input.conceptId?.trim());
    const hasPath = Boolean(input.path?.trim());
    if (hasConceptId === hasPath) {
      throw new BrainKernelError('INVALID_REQUEST', 'Provide exactly one of conceptId or path.');
    }

    let document: ParsedBrainDocument;
    let concept: BrainConcept | undefined;
    if (hasConceptId) {
      const id = this.#normalizeConceptId(input.conceptId ?? '');
      const matches = snapshot.conceptsById.get(id) ?? [];
      if (matches.length === 0) {
        throw new BrainKernelError('NOT_FOUND', 'The requested concept was not found.', {
          conceptId: id,
        });
      }
      if (matches.length > 1) {
        throw new BrainKernelError(
          'AMBIGUOUS_CONCEPT',
          'The requested concept ID resolves to more than one document.',
          { conceptId: id, matches: matches.map((match) => match.sourcePath) },
        );
      }
      concept = matches[0];
      if (!concept) throw new BrainKernelError('NOT_FOUND', 'The requested concept was not found.');
      const matchedDocument = snapshot.documents.get(concept.path);
      if (!matchedDocument) {
        throw new BrainKernelError('NOT_FOUND', 'The requested concept document was not found.');
      }
      document = matchedDocument;
    } else {
      const normalized = this.#normalizeRequestedPath(input.path ?? '');
      const candidates = [normalized];
      if (!posix.extname(normalized)) {
        candidates.push(
          `${normalized}.md`,
          `${normalized}.markdown`,
          `${normalized}.yaml`,
          `${normalized}.yml`,
          `${normalized}.json`,
          posix.join(normalized, 'index.md'),
        );
      }
      const matches = candidates
        .map((candidate) => snapshot.documents.get(candidate))
        .filter((candidate): candidate is ParsedBrainDocument => Boolean(candidate));
      if (matches.length === 0) {
        throw new BrainKernelError('NOT_FOUND', 'The requested knowledge path was not found.', {
          path: sourcePath(this.#requirePaths().sourcePrefix, normalized),
        });
      }
      if (matches.length > 1) {
        throw new BrainKernelError(
          'AMBIGUOUS_CONCEPT',
          'The requested path resolves to more than one document.',
          { matches: matches.map((match) => match.sourcePath) },
        );
      }
      const matchedDocument = matches[0];
      if (!matchedDocument) {
        throw new BrainKernelError('NOT_FOUND', 'The requested knowledge path was not found.');
      }
      document = matchedDocument;
      concept = snapshot.conceptByPath.get(document.path);
    }

    let content = document.body.trim();
    let selectedHeading: ParsedHeading | undefined;
    if (input.heading?.trim()) {
      selectedHeading = this.#selectHeading(document, input.heading);
      content = extractHeadingSection(document, selectedHeading);
    }
    const anchor = selectedHeading?.anchor;
    const relations = concept?.relations ?? [];
    const citations = concept
      ? citationsFor(concept, anchor)
      : [{ path: document.sourcePath, ...(anchor ? { anchor } : {}) }];

    return {
      kind: document.kind,
      ...(concept ? { conceptId: concept.id } : {}),
      title: document.title,
      content,
      ...(selectedHeading ? { selectedHeading } : {}),
      metadata: document.metadata,
      sourcePath: document.sourcePath,
      headings: document.headings,
      relations,
      citations,
      contentHash: document.contentHash,
    };
  }

  contextPack(input: BrainContextPackInput): BrainContextPack {
    const snapshot = this.#requireSnapshot();
    const objective = input.objective.trim();
    if (!objective) {
      throw new BrainKernelError('INVALID_REQUEST', 'A context-pack objective is required.');
    }
    const configuredDefault = this.#options.defaultContextCharacters ?? 12_000;
    const configuredMaximum = Math.max(1, this.#options.maximumContextCharacters ?? 50_000);
    const characterRequest = Number.isFinite(input.maxCharacters)
      ? (input.maxCharacters ?? configuredDefault)
      : configuredDefault;
    const tokenCharacters = Number.isFinite(input.approximateTokenBudget)
      ? Math.trunc((input.approximateTokenBudget ?? configuredMaximum / 4) * 4)
      : configuredMaximum;
    const maximum = Math.max(
      1,
      Math.min(configuredMaximum, Math.trunc(characterRequest), tokenCharacters),
    );
    const warnings: string[] = [];
    const ordered: BrainConcept[] = [];
    const seen = new Set<string>();
    const add = (concept: BrainConcept | undefined): void => {
      if (!concept || seen.has(concept.id)) return;
      seen.add(concept.id);
      ordered.push(concept);
    };

    const seedConcepts: BrainConcept[] = [];
    for (const rawId of input.seedConceptIds ?? []) {
      let id: string;
      try {
        id = this.#normalizeConceptId(rawId);
      } catch {
        warnings.push(`Unsafe seed concept ID was ignored: ${rawId}`);
        continue;
      }
      const matches = snapshot.conceptsById.get(id) ?? [];
      if (matches.length === 1) {
        const seed = matches[0];
        if (seed) {
          seedConcepts.push(seed);
          add(seed);
        }
      } else if (matches.length > 1) {
        warnings.push(`Seed concept is ambiguous: ${id}`);
      } else {
        warnings.push(`Seed concept was not found: ${id}`);
      }
    }

    const searchResults = this.search({
      query: objective,
      ...(input.domains ? { domains: input.domains } : {}),
      limit: 50,
    });
    searchResults.forEach((result) => {
      const candidate = snapshot.conceptsById.get(result.conceptId)?.[0];
      add(candidate);
    });

    for (const seed of seedConcepts) {
      for (const relation of seed.relations) {
        add(snapshot.conceptsById.get(relation.targetId)?.[0]);
      }
    }

    if (ordered.length === 0) warnings.push('No matching Company Brain concepts were found.');
    if (!snapshot.validation.valid) {
      warnings.push(
        `Company Brain validation has ${String(snapshot.validation.errors)} error(s); verify affected claims.`,
      );
    } else if (snapshot.validation.warnings > 0) {
      warnings.push(
        `Company Brain validation has ${String(snapshot.validation.warnings)} warning(s); check freshness and conflicts.`,
      );
    }

    let content = truncate(`Objective: ${objective}`, maximum);
    let wasTruncated = content.length < `Objective: ${objective}`.length;
    const selected: BrainConcept[] = [];
    for (const concept of ordered) {
      const block = [
        `## ${concept.title} [${concept.id}]`,
        `Source: ${concept.sourcePath}`,
        concept.summary,
        concept.body.trim(),
      ]
        .filter(Boolean)
        .join('\n');
      const separator = content ? '\n\n' : '';
      const remaining = maximum - content.length - separator.length;
      if (remaining <= 0) {
        wasTruncated = true;
        break;
      }
      const addition = truncate(block, remaining);
      content += `${separator}${addition}`;
      selected.push(concept);
      if (addition.length < block.length) {
        wasTruncated = true;
        break;
      }
    }
    if (selected.length < ordered.length) wasTruncated = true;

    const contextConcepts: BrainContextConcept[] = selected.map((concept) => ({
      conceptId: concept.id,
      title: concept.title,
      domain: concept.domain,
      type: concept.type,
      excerpt: excerptFor(concept, tokens(objective), 320),
      sourcePath: concept.sourcePath,
      contentHash: concept.contentHash,
    }));
    const facts = selected.flatMap((concept) => this.#factsFor(concept)).slice(0, 20);
    const selectedIds = new Set(selected.map((concept) => concept.id));
    const relationships = selected
      .flatMap((concept) => concept.relations)
      .filter((relation) => selectedIds.has(relation.targetId))
      .filter(
        (relation, index, relations) =>
          relations.findIndex(
            (candidate) =>
              candidate.kind === relation.kind &&
              candidate.sourceConceptId === relation.sourceConceptId &&
              candidate.targetId === relation.targetId,
          ) === index,
      )
      .sort(
        (left, right) =>
          compareText(left.sourceConceptId ?? '', right.sourceConceptId ?? '') ||
          compareText(left.kind, right.kind) ||
          compareText(left.targetId, right.targetId),
      );
    const citations = uniqueCitations(selected.flatMap((concept) => citationsFor(concept)));

    return {
      objective,
      content,
      selectedFacts: facts,
      concepts: contextConcepts,
      relationships,
      citations,
      warnings,
      selection: {
        algorithm: 'deterministic-lexical-v1',
        maxCharacters: maximum,
        usedCharacters: content.length,
        approximateTokens: Math.ceil(content.length / 4),
        candidateCount: ordered.length,
        selectedCount: selected.length,
        truncated: wasTruncated,
      },
    };
  }

  listDomains(): BrainDomainsReport {
    const snapshot = this.#requireSnapshot();
    const groups = new Map<string, BrainConcept[]>();
    snapshot.concepts.forEach((concept) => {
      const concepts = groups.get(concept.domain) ?? [];
      concepts.push(concept);
      groups.set(concept.domain, concepts);
    });

    const domains: BrainDomainSummary[] = [...groups.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([domain, concepts]) => {
        const typeCounts = new Map<string, number>();
        const ownerCounts = new Map<string, number>();
        concepts.forEach((concept) => {
          typeCounts.set(concept.type, (typeCounts.get(concept.type) ?? 0) + 1);
          if (concept.owner) {
            ownerCounts.set(concept.owner, (ownerCounts.get(concept.owner) ?? 0) + 1);
          }
        });
        const conceptIds = new Set(concepts.map((concept) => concept.id));
        const domainPrefix = sourcePath(this.#requirePaths().sourcePrefix, `${domain}/`);
        const domainIssues = snapshot.validation.issues.filter(
          (item) =>
            (item.conceptId ? conceptIds.has(item.conceptId) : false) ||
            (item.path ? item.path.startsWith(domainPrefix) : false),
        );
        return {
          domain,
          conceptCount: concepts.length,
          types: [...typeCounts.entries()]
            .map(([type, count]) => ({ type, count }))
            .sort((left, right) => compareText(left.type, right.type)),
          owners: [...ownerCounts.entries()]
            .map(([owner, count]) => ({ owner, count }))
            .sort((left, right) => compareText(left.owner, right.owner)),
          validation: {
            errors: domainIssues.filter((item) => item.severity === 'error').length,
            warnings: domainIssues.filter((item) => item.severity === 'warning').length,
          },
        };
      });

    return {
      domains,
      totalConcepts: snapshot.concepts.length,
      totalTypes: new Set(snapshot.concepts.map((concept) => concept.type)).size,
      totalOwners: new Set(
        snapshot.concepts.flatMap((concept) => (concept.owner ? [concept.owner] : [])),
      ).size,
    };
  }

  validate(input: BrainValidationInput = {}): BrainValidationReport {
    const snapshot = this.#requireSnapshot();
    if (!input.changes || input.changes.length === 0) return snapshot.validation;
    const paths = this.#requirePaths();
    const files = new Map(snapshot.files);
    const changeIssues: ValidationIssue[] = [...snapshot.baseIssues];
    const changed = new Set<string>();
    const checkedAt = this.#now().toISOString();

    for (const change of input.changes) {
      let normalized: string;
      try {
        normalized = this.#normalizeRequestedPath(change.path);
      } catch {
        changeIssues.push(
          validationIssue('error', 'UNSAFE_CHANGE_PATH', 'Proposed change path is unsafe.'),
        );
        continue;
      }
      const proposedSourcePath = sourcePath(paths.sourcePrefix, normalized);
      if (changed.has(normalized)) {
        changeIssues.push(
          validationIssue(
            'error',
            'DUPLICATE_CHANGE_PATH',
            'A proposal may change a path only once.',
            { path: proposedSourcePath },
          ),
        );
        continue;
      }
      changed.add(normalized);
      if (!SUPPORTED_EXTENSIONS.has(posix.extname(normalized).toLocaleLowerCase('en-US'))) {
        changeIssues.push(
          validationIssue(
            'error',
            'UNSUPPORTED_CHANGE_PATH',
            'Proposed Company Brain files must use a supported knowledge extension.',
            { path: proposedSourcePath },
          ),
        );
        continue;
      }
      const previous = files.get(normalized);
      if (
        change.expectedPreviousContentHash &&
        previous &&
        createHash('sha256').update(previous.content, 'utf8').digest('hex') !==
          change.expectedPreviousContentHash
      ) {
        changeIssues.push(
          validationIssue(
            'error',
            'EXPECTED_HASH_MISMATCH',
            'The proposed change is based on stale content.',
            { path: proposedSourcePath },
          ),
        );
        continue;
      }
      if (change.expectedPreviousContentHash && !previous) {
        changeIssues.push(
          validationIssue(
            'error',
            'EXPECTED_HASH_MISMATCH',
            'The proposed change expected a file that does not exist.',
            { path: proposedSourcePath },
          ),
        );
        continue;
      }

      if (change.operation === 'delete') {
        if (!previous) {
          changeIssues.push(
            validationIssue('error', 'CHANGE_TARGET_MISSING', 'Cannot delete a missing file.', {
              path: proposedSourcePath,
            }),
          );
        } else {
          files.delete(normalized);
        }
        continue;
      }
      if (change.operation === 'create' && previous) {
        changeIssues.push(
          validationIssue(
            'error',
            'CHANGE_TARGET_EXISTS',
            'Cannot create a file that already exists.',
            {
              path: proposedSourcePath,
            },
          ),
        );
        continue;
      }
      if (change.operation === 'update' && !previous) {
        changeIssues.push(
          validationIssue('error', 'CHANGE_TARGET_MISSING', 'Cannot update a missing file.', {
            path: proposedSourcePath,
          }),
        );
        continue;
      }
      if (typeof change.content !== 'string') {
        changeIssues.push(
          validationIssue(
            'error',
            'CHANGE_CONTENT_REQUIRED',
            'Create and update changes require exact content.',
            { path: proposedSourcePath },
          ),
        );
        continue;
      }
      files.set(normalized, {
        path: normalized,
        sourcePath: proposedSourcePath,
        content: change.content,
        modifiedAt: checkedAt,
        sizeBytes: Buffer.byteLength(change.content, 'utf8'),
      });
    }

    return this.#buildSnapshot(files, changeIssues, paths, checkedAt, true).validation;
  }

  /**
   * Validate an entire candidate Git tree without reading candidate knowledge from disk.
   * Keys are repository-relative paths and values are exact blob contents. This is used
   * before proposal branches are created, so validation is based on the caller's base SHA
   * rather than whatever checkout happens to be deployed with the server.
   */
  validateCandidateFiles(candidateFiles: ReadonlyMap<string, string>): BrainValidationReport {
    this.#requireSnapshot();
    const paths = this.#requirePaths();
    const checkedAt = this.#now().toISOString();
    const files = new Map<string, RawBrainFile>();
    const candidatePaths = new Set<string>();
    const issues: ValidationIssue[] = [];
    const prefix = paths.sourcePrefix === '.' ? '' : `${paths.sourcePrefix}/`;

    for (const [repositoryPath, content] of candidateFiles) {
      const normalized = posix.normalize(repositoryPath);
      const unsafe =
        !repositoryPath ||
        repositoryPath.startsWith('/') ||
        repositoryPath.includes('\\') ||
        repositoryPath.includes('\0') ||
        normalized !== repositoryPath ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        repositoryPath
          .split('/')
          .some((segment) => !segment || segment === '.' || segment === '..');
      if (unsafe) {
        const mightTargetBrain =
          paths.sourcePrefix === '.' ||
          repositoryPath === paths.sourcePrefix ||
          repositoryPath.startsWith(prefix);
        if (mightTargetBrain) {
          issues.push(
            validationIssue(
              'error',
              'UNSAFE_CANDIDATE_PATH',
              'Candidate Company Brain contains an unsafe path.',
            ),
          );
        }
        continue;
      }
      candidatePaths.add(repositoryPath);
      if (prefix && !repositoryPath.startsWith(prefix)) continue;
      const bundlePath = prefix ? repositoryPath.slice(prefix.length) : repositoryPath;
      if (
        !bundlePath ||
        !SUPPORTED_EXTENSIONS.has(posix.extname(bundlePath).toLocaleLowerCase('en-US'))
      ) {
        continue;
      }
      files.set(bundlePath, {
        path: bundlePath,
        sourcePath: repositoryPath,
        content,
        modifiedAt: checkedAt,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
      });
    }

    return this.#buildSnapshot(files, issues, paths, checkedAt, true, candidatePaths).validation;
  }

  health(): BrainHealthSnapshot {
    const snapshot = this.#snapshot;
    if (!snapshot) {
      return {
        status: 'unhealthy',
        indexedFileCount: 0,
        indexedConceptCount: 0,
        validationStatus: 'fail',
        validationErrors: 0,
        validationWarnings: 0,
        lastSuccessfulRefresh: this.#lastSuccessfulRefresh,
        contentHash: null,
        domains: [],
        ...(this.#lastRefreshError ? { refreshError: this.#lastRefreshError } : {}),
      };
    }
    const validationStatus = snapshot.validation.valid
      ? snapshot.validation.warnings > 0
        ? 'warnings'
        : 'pass'
      : 'fail';
    return {
      status: snapshot.validation.valid
        ? snapshot.validation.warnings > 0
          ? 'degraded'
          : 'healthy'
        : 'unhealthy',
      indexedFileCount: snapshot.documents.size,
      indexedConceptCount: snapshot.concepts.length,
      validationStatus,
      validationErrors: snapshot.validation.errors,
      validationWarnings: snapshot.validation.warnings,
      lastSuccessfulRefresh: this.#lastSuccessfulRefresh,
      contentHash: snapshot.contentHash,
      domains: [...new Set(snapshot.concepts.map((concept) => concept.domain))].sort(compareText),
      ...(this.#lastRefreshError ? { refreshError: this.#lastRefreshError } : {}),
    };
  }

  async #discover(
    paths: RuntimePaths,
  ): Promise<{ files: ReadonlyMap<string, RawBrainFile>; issues: readonly ValidationIssue[] }> {
    const files = new Map<string, RawBrainFile>();
    const issues: ValidationIssue[] = [];
    const visitedDirectories = new Set<string>();
    const visitedFiles = new Set<string>();

    const walk = async (realDirectory: string, relativeDirectory: string): Promise<void> => {
      if (visitedDirectories.has(realDirectory)) return;
      visitedDirectories.add(realDirectory);
      const entries = await readdir(realDirectory, { withFileTypes: true });
      entries.sort((left, right) => compareText(left.name, right.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const candidate = path.join(realDirectory, entry.name);
        const bundlePath = relativeDirectory
          ? posix.join(relativeDirectory, entry.name)
          : entry.name;
        const displayPath = sourcePath(paths.sourcePrefix, bundlePath);
        let resolved: string;
        try {
          resolved = await realpath(candidate);
        } catch {
          issues.push(
            validationIssue('error', 'UNREADABLE_FILE', 'A knowledge path could not be resolved.', {
              path: displayPath,
            }),
          );
          continue;
        }
        if (!isWithin(resolved, paths.root)) {
          issues.push(
            validationIssue(
              'error',
              'SYMLINK_ESCAPES_BRAIN_ROOT',
              'A symbolic link resolves outside the Company Brain root.',
              { path: displayPath },
            ),
          );
          continue;
        }
        const resolvedStats = await stat(resolved);
        if (resolvedStats.isDirectory()) {
          if (visitedDirectories.has(resolved)) {
            issues.push(
              validationIssue(
                'warning',
                'SYMLINK_CYCLE_SKIPPED',
                'A repeated directory target was skipped during discovery.',
                { path: displayPath },
              ),
            );
          } else {
            await walk(resolved, bundlePath);
          }
          continue;
        }
        if (!resolvedStats.isFile()) continue;
        const extension = posix.extname(bundlePath).toLocaleLowerCase('en-US');
        if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
        if (visitedFiles.has(resolved)) {
          issues.push(
            validationIssue(
              'warning',
              'DUPLICATE_REALPATH_SKIPPED',
              'A repeated file target was skipped during discovery.',
              { path: displayPath },
            ),
          );
          continue;
        }
        visitedFiles.add(resolved);
        try {
          const bytes = await readFile(resolved);
          let content: string;
          try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            issues.push(
              validationIssue(
                'error',
                'INVALID_UTF8',
                'Knowledge files must contain valid UTF-8.',
                {
                  path: displayPath,
                },
              ),
            );
            continue;
          }
          files.set(bundlePath, {
            path: bundlePath,
            sourcePath: displayPath,
            content,
            modifiedAt: resolvedStats.mtime.toISOString(),
            sizeBytes: resolvedStats.size,
          });
        } catch {
          issues.push(
            validationIssue('error', 'UNREADABLE_FILE', 'A knowledge file could not be read.', {
              path: displayPath,
            }),
          );
        }
      }
    };

    await walk(paths.root, '');
    return { files, issues };
  }

  #buildSnapshot(
    rawFiles: ReadonlyMap<string, RawBrainFile>,
    initialIssues: readonly ValidationIssue[],
    paths: RuntimePaths,
    checkedAt: string,
    overlayApplied: boolean,
    candidateRepositoryPaths?: ReadonlySet<string>,
  ): Snapshot {
    const documents = new Map<string, ParsedBrainDocument>();
    [...rawFiles.values()]
      .sort((left, right) => compareText(left.path, right.path))
      .forEach((file) => {
        documents.set(
          file.path,
          parseBrainDocument({
            path: file.path,
            sourcePath: file.sourcePath,
            content: file.content,
            modifiedAt: file.modifiedAt,
            sizeBytes: file.sizeBytes,
          }),
        );
      });

    const preliminaryById = new Map<string, ParsedBrainDocument[]>();
    for (const document of documents.values()) {
      if (document.kind !== 'concept') continue;
      const id = conceptIdForPath(document.path);
      const matches = preliminaryById.get(id) ?? [];
      matches.push(document);
      preliminaryById.set(id, matches);
    }

    const concepts: BrainConcept[] = [];
    const conceptsById = new Map<string, BrainConcept[]>();
    const conceptByPath = new Map<string, BrainConcept>();
    for (const document of documents.values()) {
      if (document.kind !== 'concept') continue;
      const id = conceptIdForPath(document.path);
      const relations = this.#relationsFor(document, documents, preliminaryById);
      const metadata = document.metadata;
      const owner = stringValue(metadata.owner);
      const status = stringValue(metadata.status);
      const concept: BrainConcept = {
        id,
        title: document.title,
        summary: document.summary,
        body: document.body.trim(),
        domain: domainForId(id),
        type: stringValue(metadata.type) ?? 'Unknown',
        tags: stringList(metadata.tags),
        relations,
        ...(owner ? { owner } : {}),
        ...(status ? { status } : {}),
        path: document.path,
        sourcePath: document.sourcePath,
        headings: document.headings,
        sources: document.sources,
        metadata,
        contentHash: document.contentHash,
        modifiedAt: document.modifiedAt,
        sizeBytes: document.sizeBytes,
      };
      concepts.push(concept);
      const matches = conceptsById.get(id) ?? [];
      matches.push(concept);
      conceptsById.set(id, matches);
      conceptByPath.set(document.path, concept);
    }
    concepts.sort(
      (left, right) => compareText(left.id, right.id) || compareText(left.path, right.path),
    );

    const contentHash = hashValues(
      [...documents.values()]
        .sort((left, right) => compareText(left.path, right.path))
        .flatMap((document) => [document.path, document.contentHash]),
    );
    const issues = this.#validateSnapshot(
      documents,
      concepts,
      conceptsById,
      initialIssues,
      paths,
      checkedAt,
      candidateRepositoryPaths,
    );
    const errors = issues.filter((item) => item.severity === 'error').length;
    const warnings = issues.length - errors;
    const validation: BrainValidationReport = {
      valid: errors === 0,
      errors,
      warnings,
      issues,
      fileCount: documents.size,
      conceptCount: concepts.length,
      contentHash,
      checkedAt,
      overlayApplied,
    };

    return {
      files: new Map(rawFiles),
      documents,
      concepts,
      conceptsById,
      conceptByPath,
      baseIssues: [...initialIssues],
      validation,
      contentHash,
    };
  }

  #relationsFor(
    document: ParsedBrainDocument,
    documents: ReadonlyMap<string, ParsedBrainDocument>,
    conceptsById: ReadonlyMap<string, readonly ParsedBrainDocument[]>,
  ): BrainRelation[] {
    const output: BrainRelation[] = [];
    const sourceConceptId = conceptIdForPath(document.path);
    for (const declared of document.declaredRelations) {
      const resolved = this.#resolveDeclaredRelation(document, declared, conceptsById);
      if (resolved.relation) output.push({ ...resolved.relation, sourceConceptId });
    }
    for (const link of document.links) {
      if (link.image) continue;
      const resolved = this.#resolveLink(document, link.target);
      if (resolved.kind !== 'bundle' || !resolved.bundlePath) continue;
      const target = this.#documentForBundleTarget(resolved.bundlePath, documents);
      if (target?.kind !== 'concept') continue;
      output.push({
        kind: 'links-to',
        sourceConceptId,
        targetId: conceptIdForPath(target.path),
        source: 'markdown',
        ...(link.label ? { label: link.label } : {}),
        ...(resolved.anchor ? { anchor: resolved.anchor } : {}),
      });
    }
    const seen = new Set<string>();
    return output
      .filter((relation) => {
        const key = [relation.kind, relation.targetId, relation.source, relation.anchor ?? ''].join(
          '\0',
        );
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (left, right) =>
          compareText(left.kind, right.kind) ||
          compareText(left.targetId, right.targetId) ||
          compareText(left.source, right.source),
      );
  }

  #resolveDeclaredRelation(
    document: ParsedBrainDocument,
    declared: ParsedRelation,
    conceptsById: ReadonlyMap<string, readonly unknown[]>,
  ): RelationResolution {
    const raw = declared.rawTarget.trim();
    if (
      !raw ||
      raw.includes('\0') ||
      raw.includes('\\') ||
      HTTP_SCHEME.test(raw) ||
      EXTERNAL_SCHEME.test(raw)
    ) {
      return { unsafe: true };
    }
    const [withoutFragment, fragment] = raw.split('#', 2);
    if (!withoutFragment) return { unsafe: true };
    let value = withoutFragment.replace(/^\/+/, '');
    if (value.includes('%') || value.split('/').includes('..')) {
      if (withoutFragment.startsWith('../') || withoutFragment.startsWith('./')) {
        const sourceId = conceptIdForPath(document.path);
        value = posix.normalize(posix.join(posix.dirname(sourceId), withoutFragment));
      } else {
        return { unsafe: true };
      }
    } else if (withoutFragment.startsWith('./')) {
      value = posix.normalize(
        posix.join(posix.dirname(conceptIdForPath(document.path)), withoutFragment),
      );
    }
    if (value === '..' || value.startsWith('../') || value.startsWith('/')) return { unsafe: true };
    value = value.slice(0, value.length - posix.extname(value).length) || value;

    const relativeCandidate = posix.normalize(
      posix.join(posix.dirname(conceptIdForPath(document.path)), value),
    );
    const candidates = [...new Set([value, relativeCandidate])];
    const targetId = candidates.find((candidate) => conceptsById.has(candidate)) ?? value;
    const label = declared.label;
    return {
      unsafe: false,
      relation: {
        kind: declared.kind,
        targetId,
        source: 'frontmatter',
        ...(label ? { label } : {}),
        ...(fragment ? { anchor: fragment } : {}),
      },
    };
  }

  #validateSnapshot(
    documents: ReadonlyMap<string, ParsedBrainDocument>,
    concepts: readonly BrainConcept[],
    conceptsById: ReadonlyMap<string, readonly BrainConcept[]>,
    initialIssues: readonly ValidationIssue[],
    paths: RuntimePaths,
    checkedAt: string,
    candidateRepositoryPaths?: ReadonlySet<string>,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [...initialIssues];
    documents.forEach((document) => issues.push(...document.parseIssues));
    this.#validateReservedDocuments(documents, issues);

    for (const concept of concepts) {
      this.#validateConcept(concept, documents.get(concept.path), issues, checkedAt);
      if (this.#controlledDomains && !this.#controlledDomains.has(normalizeText(concept.domain))) {
        issues.push(
          validationIssue(
            'error',
            'UNKNOWN_DOMAIN',
            'Concept domain is not in the controlled vocabulary.',
            {
              path: concept.sourcePath,
              conceptId: concept.id,
            },
          ),
        );
      }
      if (this.#controlledTypes && !this.#controlledTypes.has(normalizeText(concept.type))) {
        issues.push(
          validationIssue(
            'error',
            'UNKNOWN_TYPE',
            'Concept type is not in the controlled vocabulary.',
            {
              path: concept.sourcePath,
              conceptId: concept.id,
            },
          ),
        );
      }
    }

    for (const [id, matches] of conceptsById) {
      if (matches.length < 2) continue;
      const relatedPaths = matches.map((match) => match.sourcePath).sort(compareText);
      issues.push(
        validationIssue(
          'error',
          'DUPLICATE_CONCEPT_ID',
          'Concept ID is derived by more than one file.',
          {
            ...(relatedPaths[0] ? { path: relatedPaths[0] } : {}),
            conceptId: id,
            relatedPaths,
          },
        ),
      );
    }

    for (const document of documents.values()) {
      this.#validateLinks(document, documents, paths, issues, candidateRepositoryPaths);
      this.#validateSources(document, documents, paths, issues, candidateRepositoryPaths);
      this.#validateDeclaredRelations(document, conceptsById, issues);
    }
    this.#validateIndexCoverage(documents, issues);
    this.#validateContradictions(concepts, issues);
    return sortIssues(issues);
  }

  #validateReservedDocuments(
    documents: ReadonlyMap<string, ParsedBrainDocument>,
    issues: ValidationIssue[],
  ): void {
    const rootIndex = documents.get('index.md');
    if (!rootIndex) {
      issues.push(
        validationIssue(
          'error',
          'ROOT_INDEX_MISSING',
          'The Company Brain requires a root index.md.',
          {
            path: sourcePath(this.#requirePaths().sourcePrefix, 'index.md'),
          },
        ),
      );
    } else if (rootIndex.metadata.okf_version !== '0.2') {
      issues.push(
        validationIssue(
          'error',
          'ROOT_INDEX_VERSION_INVALID',
          'The root index must declare OKF version 0.2.',
          { path: rootIndex.sourcePath, line: 1 },
        ),
      );
    }
    if (rootIndex) {
      const extra = Object.keys(rootIndex.metadata).filter((key) => key !== 'okf_version');
      if (extra.length > 0) {
        issues.push(
          validationIssue(
            'error',
            'ROOT_INDEX_EXTRA_FRONTMATTER',
            'Root index frontmatter may contain only okf_version.',
            { path: rootIndex.sourcePath, line: 1 },
          ),
        );
      }
    }
    for (const document of documents.values()) {
      if (
        document.kind === 'index' &&
        document.path !== 'index.md' &&
        document.frontmatterPresent
      ) {
        issues.push(
          validationIssue(
            'error',
            'INDEX_FRONTMATTER_FORBIDDEN',
            'Only the root index may contain frontmatter.',
            { path: document.sourcePath, line: 1 },
          ),
        );
      }
      if (document.kind === 'log') {
        if (document.frontmatterPresent) {
          issues.push(
            validationIssue(
              'error',
              'LOG_FRONTMATTER_FORBIDDEN',
              'Log files may not contain frontmatter.',
              {
                path: document.sourcePath,
                line: 1,
              },
            ),
          );
        }
        const dates = document.headings
          .filter((heading) => heading.level === 2)
          .map((heading) => ({ value: dateOnly(heading.text), heading }));
        dates.forEach(({ value, heading }) => {
          if (!value) {
            issues.push(
              validationIssue('error', 'LOG_DATE_INVALID', 'Log headings must use ISO dates.', {
                path: document.sourcePath,
                line: heading.line,
              }),
            );
          }
        });
        dates.forEach((entry, index) => {
          const previous = dates[index - 1];
          if (index > 0 && entry.value && previous?.value && entry.value > previous.value) {
            issues.push(
              validationIssue('error', 'LOG_ORDER_INVALID', 'Log dates must be newest first.', {
                path: document.sourcePath,
                line: entry.heading.line,
              }),
            );
          }
        });
      }
    }
  }

  #validateConcept(
    concept: BrainConcept,
    document: ParsedBrainDocument | undefined,
    issues: ValidationIssue[],
    checkedAt: string,
  ): void {
    if (!document) return;
    const metadata = concept.metadata;
    if (
      (posix.extname(concept.path) === '.md' || posix.extname(concept.path) === '.markdown') &&
      !document.frontmatterPresent
    ) {
      issues.push(
        validationIssue(
          'error',
          'FRONTMATTER_REQUIRED',
          'Concept Markdown requires YAML frontmatter.',
          {
            path: concept.sourcePath,
            conceptId: concept.id,
            line: 1,
          },
        ),
      );
    }
    for (const field of [
      'type',
      'title',
      'description',
      'status',
      'owner',
      'visibility',
    ] as const) {
      if (!stringValue(metadata[field])) {
        issues.push(
          validationIssue(
            'error',
            `${field.toUpperCase()}_REQUIRED`,
            `${field} must be a non-empty string.`,
            {
              path: concept.sourcePath,
              conceptId: concept.id,
              line: 1,
            },
          ),
        );
      }
    }
    const status = stringValue(metadata.status);
    if (status && !VALID_STATUSES.has(status)) {
      issues.push(
        validationIssue('error', 'STATUS_INVALID', 'status must be draft, stable, or deprecated.', {
          path: concept.sourcePath,
          conceptId: concept.id,
        }),
      );
    }
    const owner = stringValue(metadata.owner);
    if (owner && !/^(?:human|team):[^\s]+$/u.test(owner)) {
      issues.push(
        validationIssue('error', 'OWNER_INVALID', 'owner must use human:<id> or team:<id>.', {
          path: concept.sourcePath,
          conceptId: concept.id,
        }),
      );
    }
    const visibility = stringValue(metadata.visibility);
    if (visibility && !VALID_VISIBILITIES.has(visibility)) {
      issues.push(
        validationIssue('error', 'VISIBILITY_INVALID', 'visibility must be public or internal.', {
          path: concept.sourcePath,
          conceptId: concept.id,
        }),
      );
    }
    if (metadata.tags !== undefined) {
      const tags = stringList(metadata.tags);
      if (!Array.isArray(metadata.tags) || tags.length !== metadata.tags.length) {
        issues.push(
          validationIssue('error', 'TAGS_INVALID', 'tags must be a list of non-empty strings.', {
            path: concept.sourcePath,
            conceptId: concept.id,
          }),
        );
      } else if (new Set(tags).size !== tags.length) {
        issues.push(
          validationIssue('error', 'TAGS_DUPLICATE', 'tags must not contain duplicates.', {
            path: concept.sourcePath,
            conceptId: concept.id,
          }),
        );
      }
    }

    const generated = mapping(metadata.generated);
    if (!generated) {
      issues.push(
        validationIssue(
          'error',
          'GENERATED_REQUIRED',
          'generated must be an actor event mapping.',
          {
            path: concept.sourcePath,
            conceptId: concept.id,
          },
        ),
      );
    } else {
      if (!validActor(generated.by)) {
        issues.push(
          validationIssue('error', 'ACTOR_INVALID', 'generated.by must identify a valid actor.', {
            path: concept.sourcePath,
            conceptId: concept.id,
          }),
        );
      }
      if (!isoDateTime(generated.at)) {
        issues.push(
          validationIssue('error', 'DATETIME_INVALID', 'generated.at must be an ISO datetime.', {
            path: concept.sourcePath,
            conceptId: concept.id,
          }),
        );
      }
    }

    const rawVerified = metadata.verified;
    const verifiedMapping = mapping(rawVerified);
    const verificationEvents =
      rawVerified === undefined
        ? []
        : verifiedMapping
          ? [verifiedMapping]
          : Array.isArray(rawVerified) && rawVerified.every(isMapping)
            ? rawVerified
            : undefined;
    if (!verificationEvents) {
      issues.push(
        validationIssue(
          'error',
          'VERIFIED_INVALID',
          'verified must be an actor event or a list of actor events.',
          { path: concept.sourcePath, conceptId: concept.id },
        ),
      );
    } else {
      verificationEvents.forEach((event) => {
        if (!validActor(event.by)) {
          issues.push(
            validationIssue('error', 'ACTOR_INVALID', 'verified.by must identify a valid actor.', {
              path: concept.sourcePath,
              conceptId: concept.id,
            }),
          );
        }
        if (!isoDateTime(event.at)) {
          issues.push(
            validationIssue('error', 'DATETIME_INVALID', 'verified.at must be an ISO datetime.', {
              path: concept.sourcePath,
              conceptId: concept.id,
            }),
          );
        }
      });
    }

    const staleAfter = metadata.stale_after;
    if (staleAfter !== undefined) {
      const staleDate = dateOnly(staleAfter);
      if (!staleDate) {
        issues.push(
          validationIssue('error', 'STALE_AFTER_INVALID', 'stale_after must be an ISO date.', {
            path: concept.sourcePath,
            conceptId: concept.id,
          }),
        );
      } else if (staleDate <= checkedAt.slice(0, 10)) {
        const approved = mapping(metadata.publication)?.status === 'approved';
        issues.push(
          validationIssue(
            approved ? 'error' : 'warning',
            approved ? 'PUBLISH_APPROVAL_EXPIRED' : 'CONCEPT_STALE',
            `Concept became stale on ${staleDate}.`,
            { path: concept.sourcePath, conceptId: concept.id },
          ),
        );
      }
    }

    const publication = mapping(metadata.publication);
    if (!publication) {
      issues.push(
        validationIssue('error', 'PUBLICATION_REQUIRED', 'publication must be a mapping.', {
          path: concept.sourcePath,
          conceptId: concept.id,
        }),
      );
      return;
    }
    const publicationStatus = stringValue(publication.status);
    if (!publicationStatus || !VALID_PUBLICATION_STATUSES.has(publicationStatus)) {
      issues.push(
        validationIssue(
          'error',
          'PUBLICATION_STATUS_INVALID',
          'publication.status must be approved, review-required, or prohibited.',
          { path: concept.sourcePath, conceptId: concept.id },
        ),
      );
      return;
    }
    if (publicationStatus === 'approved') {
      if (visibility !== 'public') {
        issues.push(
          validationIssue('error', 'APPROVED_NOT_PUBLIC', 'Approved concepts must be public.', {
            path: concept.sourcePath,
            conceptId: concept.id,
          }),
        );
      }
      if (status !== 'stable') {
        issues.push(
          validationIssue('error', 'APPROVED_NOT_STABLE', 'Approved concepts must be stable.', {
            path: concept.sourcePath,
            conceptId: concept.id,
          }),
        );
      }
      if (concept.sources.length === 0) {
        issues.push(
          validationIssue(
            'error',
            'APPROVED_WITHOUT_SOURCES',
            'Approved concepts require sources.',
            {
              path: concept.sourcePath,
              conceptId: concept.id,
            },
          ),
        );
      }
      if (!staleAfter) {
        issues.push(
          validationIssue(
            'error',
            'APPROVED_WITHOUT_FRESHNESS',
            'Approved concepts require stale_after.',
            { path: concept.sourcePath, conceptId: concept.id },
          ),
        );
      }
      if (!stringValue(publication.by)?.startsWith('human:')) {
        issues.push(
          validationIssue(
            'error',
            'APPROVAL_ACTOR_INVALID',
            'Approved concepts require a human approval actor.',
            { path: concept.sourcePath, conceptId: concept.id },
          ),
        );
      }
      if (!isoDateTime(publication.at)) {
        issues.push(
          validationIssue(
            'error',
            'APPROVAL_TIME_INVALID',
            'Approved concepts require an approval datetime.',
            { path: concept.sourcePath, conceptId: concept.id },
          ),
        );
      }
      const generatedAt = isoDateTime(generated?.at)
        ? Date.parse(String(generated?.at))
        : undefined;
      const publicationAt = isoDateTime(publication.at)
        ? Date.parse(String(publication.at))
        : undefined;
      if (generatedAt !== undefined && publicationAt !== undefined && publicationAt < generatedAt) {
        issues.push(
          validationIssue(
            'error',
            'APPROVAL_PREDATES_CONTENT',
            'Publication approval predates the generated content.',
            { path: concept.sourcePath, conceptId: concept.id },
          ),
        );
      }
      const currentlyHumanVerified =
        generatedAt !== undefined &&
        verificationEvents?.some(
          (event) =>
            stringValue(event.by)?.startsWith('human:') === true &&
            isoDateTime(event.at) &&
            Date.parse(String(event.at)) >= generatedAt,
        );
      if (!currentlyHumanVerified) {
        issues.push(
          validationIssue(
            'error',
            'APPROVED_WITHOUT_CURRENT_HUMAN_VERIFICATION',
            'Approved concepts require human verification at or after generation.',
            { path: concept.sourcePath, conceptId: concept.id },
          ),
        );
      }
    }
  }

  #validateLinks(
    document: ParsedBrainDocument,
    documents: ReadonlyMap<string, ParsedBrainDocument>,
    paths: RuntimePaths,
    issues: ValidationIssue[],
    candidateRepositoryPaths?: ReadonlySet<string>,
  ): void {
    for (const link of document.links) {
      const resolved = this.#resolveLink(document, link.target);
      if (resolved.kind === 'anchor') {
        this.#validateAnchor(document, resolved.anchor, link, issues);
      } else if (resolved.kind === 'external') {
        if (HTTP_SCHEME.test(link.target) && !safeExternalUrl(link.target)) {
          issues.push(
            validationIssue('error', 'URL_INVALID', 'External URL is invalid.', {
              path: document.sourcePath,
              line: link.line,
            }),
          );
        }
      } else if (resolved.kind === 'unsafe') {
        issues.push(
          validationIssue(
            'error',
            'PATH_ESCAPES_REPOSITORY',
            'Local link escapes the repository.',
            {
              path: document.sourcePath,
              line: link.line,
            },
          ),
        );
      } else if (resolved.kind === 'bundle' && resolved.bundlePath) {
        const target = this.#documentForBundleTarget(resolved.bundlePath, documents);
        const directoryExists = this.#virtualDirectoryExists(resolved.bundlePath, documents);
        if (!target && !directoryExists) {
          issues.push(
            validationIssue('error', 'BROKEN_LINK', 'Local link target does not exist.', {
              path: document.sourcePath,
              line: link.line,
            }),
          );
        } else if (target && resolved.anchor) {
          this.#validateAnchor(target, resolved.anchor, link, issues);
        }
      } else if (resolved.kind === 'repository' && resolved.repositoryPath) {
        const repositoryPath = resolved.repositoryPath;
        const candidateExists = candidateRepositoryPaths
          ? candidateRepositoryPaths.has(repositoryPath) ||
            [...candidateRepositoryPaths].some((candidate) =>
              candidate.startsWith(`${repositoryPath}/`),
            )
          : undefined;
        const absolute = path.resolve(paths.repositoryRoot, ...repositoryPath.split('/'));
        if (
          !isWithin(absolute, paths.repositoryRoot) ||
          (candidateExists === undefined ? !existsSync(absolute) : !candidateExists)
        ) {
          issues.push(
            validationIssue(
              'error',
              'BROKEN_LINK',
              'Repository-relative link target does not exist.',
              {
                path: document.sourcePath,
                line: link.line,
              },
            ),
          );
        } else if (
          candidateExists === undefined &&
          !this.#safeExistingRepositoryTarget(absolute, paths.repositoryRoot)
        ) {
          issues.push(
            validationIssue(
              'error',
              'PATH_ESCAPES_REPOSITORY',
              'Repository link resolves outside the repository.',
              { path: document.sourcePath, line: link.line },
            ),
          );
        }
      }
    }
  }

  #validateSources(
    document: ParsedBrainDocument,
    documents: ReadonlyMap<string, ParsedBrainDocument>,
    paths: RuntimePaths,
    issues: ValidationIssue[],
    candidateRepositoryPaths?: ReadonlySet<string>,
  ): void {
    const rawSources = document.metadata.sources;
    if (rawSources !== undefined && !Array.isArray(rawSources)) {
      issues.push(
        validationIssue('error', 'SOURCES_INVALID', 'sources must be a list.', {
          path: document.sourcePath,
        }),
      );
      return;
    }
    if (!Array.isArray(rawSources)) return;
    const ids = new Set<string>();
    rawSources.forEach((entry) => {
      const source = mapping(entry);
      const resource = stringValue(source?.resource);
      if (!source || !resource) {
        issues.push(
          validationIssue(
            'error',
            'SOURCE_RESOURCE_REQUIRED',
            'Every source requires a non-empty resource.',
            { path: document.sourcePath },
          ),
        );
        return;
      }
      const id = stringValue(source.id);
      if (id) {
        if (ids.has(id)) {
          issues.push(
            validationIssue('error', 'SOURCE_ID_DUPLICATE', 'Source IDs must be unique.', {
              path: document.sourcePath,
            }),
          );
        }
        ids.add(id);
      }
      const pseudoLink: ParsedLink = { target: resource, label: '', line: 1, image: false };
      const before = issues.length;
      this.#validateLinks(
        { ...document, links: [pseudoLink] },
        documents,
        paths,
        issues,
        candidateRepositoryPaths,
      );
      for (let index = before; index < issues.length; index += 1) {
        const current = issues[index];
        if (current?.code === 'BROKEN_LINK') {
          issues[index] = { ...current, code: 'SOURCE_TARGET_MISSING' };
        }
      }
    });
    const footnotes = [...document.body.matchAll(/\[\^([A-Za-z0-9_-]+)\]/gu)].map(
      (match) => match[1] ?? '',
    );
    [...new Set(footnotes)].forEach((id) => {
      if (id && !ids.has(id)) {
        issues.push(
          validationIssue(
            'error',
            'SOURCE_FOOTNOTE_UNRESOLVED',
            'A source footnote has no matching sources entry.',
            { path: document.sourcePath },
          ),
        );
      }
    });
  }

  #validateDeclaredRelations(
    document: ParsedBrainDocument,
    conceptsById: ReadonlyMap<string, readonly BrainConcept[]>,
    issues: ValidationIssue[],
  ): void {
    for (const relation of document.declaredRelations) {
      const resolved = this.#resolveDeclaredRelation(document, relation, conceptsById);
      if (resolved.unsafe) {
        issues.push(
          validationIssue('error', 'UNSAFE_RELATION_TARGET', 'Relation target is unsafe.', {
            path: document.sourcePath,
            conceptId: conceptIdForPath(document.path),
          }),
        );
      } else if (!resolved.relation || !conceptsById.has(resolved.relation.targetId)) {
        issues.push(
          validationIssue('error', 'INVALID_RELATION_TARGET', 'Relation target does not exist.', {
            path: document.sourcePath,
            conceptId: conceptIdForPath(document.path),
          }),
        );
      }
    }
  }

  #validateIndexCoverage(
    documents: ReadonlyMap<string, ParsedBrainDocument>,
    issues: ValidationIssue[],
  ): void {
    const directories = new Set<string>(['']);
    for (const document of documents.values()) {
      let current = posix.dirname(document.path);
      while (current !== '.') {
        directories.add(current);
        current = posix.dirname(current);
      }
    }
    for (const directory of [...directories].sort(compareText)) {
      const prefix = directory ? `${directory}/` : '';
      const directConcepts = [...documents.values()].filter(
        (document) =>
          document.kind === 'concept' && posix.dirname(document.path) === (directory || '.'),
      );
      const childDirectories = new Set<string>();
      for (const filePath of documents.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const remainder = filePath.slice(prefix.length);
        const child = remainder.split('/')[0];
        if (child && remainder.includes('/')) childDirectories.add(posix.join(directory, child));
      }
      if (directConcepts.length === 0 && childDirectories.size === 0) continue;
      const indexPath = posix.join(directory, 'index.md');
      const index = documents.get(indexPath);
      if (!index) {
        issues.push(
          validationIssue('error', 'INDEX_MISSING', 'Knowledge directory requires an index.md.', {
            path: sourcePath(this.#requirePaths().sourcePrefix, indexPath),
          }),
        );
        continue;
      }
      const counts = new Map<string, number>();
      for (const link of index.links) {
        const resolved = this.#resolveLink(index, link.target);
        if (resolved.kind !== 'bundle' || !resolved.bundlePath) continue;
        const target = resolved.bundlePath.replace(/\/$/u, '');
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
      const required = [
        ...directConcepts.map((concept) => concept.path),
        ...[...childDirectories],
      ].sort(compareText);
      for (const target of required) {
        const count = counts.get(target) ?? counts.get(`${target}/`) ?? 0;
        if (count === 0) {
          issues.push(
            validationIssue('error', 'INDEX_ENTRY_MISSING', 'Index does not list a direct child.', {
              path: index.sourcePath,
              relatedPaths: [sourcePath(this.#requirePaths().sourcePrefix, target)],
            }),
          );
        } else if (count > 1) {
          issues.push(
            validationIssue(
              'error',
              'INDEX_ENTRY_DUPLICATE',
              'Index lists a direct child more than once.',
              {
                path: index.sourcePath,
                relatedPaths: [sourcePath(this.#requirePaths().sourcePrefix, target)],
              },
            ),
          );
        }
      }
    }
  }

  #validateContradictions(concepts: readonly BrainConcept[], issues: ValidationIssue[]): void {
    const active = concepts.filter((concept) => concept.status !== 'deprecated');
    const recordGroups = new Map<string, BrainConcept[]>();
    active.forEach((concept) => {
      const key =
        stringValue(concept.metadata.record_key) ?? stringValue(concept.metadata.canonical_key);
      if (!key || concept.metadata.record_value === undefined) return;
      const group = recordGroups.get(key) ?? [];
      group.push(concept);
      recordGroups.set(key, group);
    });
    for (const group of recordGroups.values()) {
      const values = new Set(group.map((concept) => JSON.stringify(concept.metadata.record_value)));
      if (values.size > 1) {
        const relatedPaths = group.map((concept) => concept.sourcePath).sort(compareText);
        issues.push(
          validationIssue(
            'error',
            'CONTRADICTORY_ACTIVE_RECORDS',
            'Active records with the same canonical key contain conflicting values.',
            { ...(relatedPaths[0] ? { path: relatedPaths[0] } : {}), relatedPaths },
          ),
        );
      }
    }
    const seen = new Set<string>();
    active.forEach((concept) => {
      concept.relations
        .filter((relation) => normalizeText(relation.kind) === 'contradicts')
        .forEach((relation) => {
          const target = active.find((candidate) => candidate.id === relation.targetId);
          if (!target) return;
          const pair = [concept.id, target.id].sort(compareText);
          const key = pair.join('\0');
          if (seen.has(key)) return;
          seen.add(key);
          issues.push(
            validationIssue(
              'warning',
              'ACTIVE_CONTRADICTION',
              'Two active concepts are explicitly marked as contradictory.',
              {
                path: concept.sourcePath,
                conceptId: concept.id,
                relatedPaths: [concept.sourcePath, target.sourcePath].sort(compareText),
              },
            ),
          );
        });
    });
  }

  #resolveLink(document: ParsedBrainDocument, rawTarget: string): ResolvedLink {
    const target = rawTarget.trim();
    if (!target) return { kind: 'unsafe', reason: 'empty' };
    if (target.startsWith('#')) return { kind: 'anchor', anchor: target.slice(1) };
    if (HTTP_SCHEME.test(target) || EXTERNAL_SCHEME.test(target)) return { kind: 'external' };
    if (target.includes('\0') || target.includes('\\'))
      return { kind: 'unsafe', reason: 'invalid' };
    const [pathPartWithQuery, fragment] = target.split('#', 2);
    const pathPart = (pathPartWithQuery ?? '').split('?', 1)[0] ?? '';
    if (!pathPart) return { kind: 'anchor', ...(fragment ? { anchor: fragment } : {}) };
    const paths = this.#requirePaths();
    let repositoryPath: string;
    if (pathPart.startsWith('/')) {
      repositoryPath = posix.normalize(posix.join(paths.sourcePrefix, pathPart.slice(1)));
    } else {
      repositoryPath = posix.normalize(posix.join(posix.dirname(document.sourcePath), pathPart));
    }
    if (
      repositoryPath === '..' ||
      repositoryPath.startsWith('../') ||
      repositoryPath.startsWith('/') ||
      pathPart.includes('%2f') ||
      pathPart.includes('%2F') ||
      pathPart.includes('%5c') ||
      pathPart.includes('%5C')
    ) {
      return { kind: 'unsafe', reason: 'traversal' };
    }
    const prefix = paths.sourcePrefix === '.' ? '' : `${paths.sourcePrefix}/`;
    if (paths.sourcePrefix === '.' || repositoryPath.startsWith(prefix)) {
      const bundlePath =
        paths.sourcePrefix === '.' ? repositoryPath : repositoryPath.slice(prefix.length);
      return {
        kind: 'bundle',
        bundlePath,
        ...(fragment ? { anchor: fragment } : {}),
      };
    }
    return {
      kind: 'repository',
      repositoryPath,
      ...(fragment ? { anchor: fragment } : {}),
    };
  }

  #documentForBundleTarget(
    target: string,
    documents: ReadonlyMap<string, ParsedBrainDocument>,
  ): ParsedBrainDocument | undefined {
    const clean = target.replace(/\/$/u, '');
    return documents.get(clean) ?? documents.get(posix.join(clean, 'index.md'));
  }

  #virtualDirectoryExists(
    target: string,
    documents: ReadonlyMap<string, ParsedBrainDocument>,
  ): boolean {
    const prefix = `${target.replace(/\/$/u, '')}/`;
    return [...documents.keys()].some((candidate) => candidate.startsWith(prefix));
  }

  #safeExistingRepositoryTarget(target: string, repositoryRoot: string): boolean {
    try {
      const resolved = realpathSync(target);
      return isWithin(resolved, repositoryRoot);
    } catch {
      return false;
    }
  }

  #validateAnchor(
    document: ParsedBrainDocument,
    rawAnchor: string | undefined,
    link: ParsedLink,
    issues: ValidationIssue[],
  ): void {
    if (!rawAnchor) return;
    let decoded = rawAnchor;
    try {
      decoded = decodeURIComponent(rawAnchor);
    } catch {
      // Invalid encoding simply cannot match a heading.
    }
    const selector = normalizeHeadingSelector(decoded);
    if (!document.headings.some((heading) => heading.anchor === selector)) {
      issues.push(
        validationIssue('error', 'BROKEN_ANCHOR', 'Link heading anchor does not exist.', {
          path: document.sourcePath,
          line: link.line,
        }),
      );
    }
  }

  #normalizeRequestedPath(value: string): string {
    let requested = value.trim();
    if (
      !requested ||
      requested.includes('\0') ||
      requested.includes('\\') ||
      requested.includes('%')
    ) {
      throw new BrainKernelError('UNSAFE_PATH', 'Knowledge path is unsafe.');
    }
    const paths = this.#requirePaths();
    const prefix = paths.sourcePrefix === '.' ? '' : `${paths.sourcePrefix}/`;
    if (prefix && requested.startsWith(prefix)) requested = requested.slice(prefix.length);
    if (
      requested.startsWith('/') ||
      requested === '.' ||
      requested === '..' ||
      requested.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new BrainKernelError('UNSAFE_PATH', 'Knowledge path is unsafe.');
    }
    const normalized = posix.normalize(requested);
    if (normalized !== requested || normalized.startsWith('../')) {
      throw new BrainKernelError('UNSAFE_PATH', 'Knowledge path is unsafe.');
    }
    return normalized;
  }

  #normalizeConceptId(value: string): string {
    let id = value.trim();
    const paths = this.#requirePaths();
    const prefix = paths.sourcePrefix === '.' ? '' : `${paths.sourcePrefix}/`;
    if (prefix && id.startsWith(prefix)) id = id.slice(prefix.length);
    const extension = posix.extname(id);
    if (SUPPORTED_EXTENSIONS.has(extension.toLocaleLowerCase('en-US'))) {
      id = id.slice(0, -extension.length);
    }
    if (
      !id ||
      id.startsWith('/') ||
      id.includes('\0') ||
      id.includes('\\') ||
      id.includes('%') ||
      id.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
      posix.normalize(id) !== id
    ) {
      throw new BrainKernelError('UNSAFE_PATH', 'Concept ID is unsafe.');
    }
    return id;
  }

  #selectHeading(document: ParsedBrainDocument, selectorValue: string): ParsedHeading {
    const selector = normalizeHeadingSelector(selectorValue);
    const textMatches = document.headings.filter(
      (heading) => normalizeHeadingSelector(heading.text) === selector,
    );
    if (textMatches.length > 1) {
      throw new BrainKernelError(
        'AMBIGUOUS_HEADING',
        'The requested heading occurs more than once; use its unique anchor.',
        { heading: selector },
      );
    }
    const anchorMatches = document.headings.filter((heading) => heading.anchor === selector);
    const matches = textMatches.length === 1 ? textMatches : anchorMatches;
    if (matches.length === 0) {
      throw new BrainKernelError('NOT_FOUND', 'The requested heading was not found.', {
        heading: selector,
      });
    }
    const selected = matches[0];
    if (!selected) throw new BrainKernelError('NOT_FOUND', 'The requested heading was not found.');
    return selected;
  }

  #factsFor(concept: BrainConcept): BrainContextFact[] {
    const candidates = concept.body
      .split(/\r?\n\s*\r?\n|\r?\n(?=\s*[-*+]\s+)/gu)
      .map(markdownToPlainText)
      .filter((value) => value.length >= 12)
      .slice(0, 3);
    if (candidates.length === 0 && concept.summary) candidates.push(concept.summary);
    return candidates.map((text) => ({
      text: truncate(text, 300),
      conceptId: concept.id,
      citation: { path: concept.sourcePath },
    }));
  }

  #requireSnapshot(): Snapshot {
    if (!this.#snapshot) {
      throw new BrainKernelError(
        'BRAIN_NOT_READY',
        'The Company Brain must be refreshed before it can be queried.',
      );
    }
    return this.#snapshot;
  }

  #requirePaths(): RuntimePaths {
    if (!this.#paths) {
      throw new BrainKernelError(
        'BRAIN_NOT_READY',
        'The Company Brain must be refreshed before it can be queried.',
      );
    }
    return this.#paths;
  }
}
