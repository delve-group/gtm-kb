import { createHash } from 'node:crypto';
import path from 'node:path';

import { parseDocument as parseYamlDocument } from 'yaml';

import type { BrainDocumentKind, BrainHeading, BrainSource, ValidationIssue } from './types.js';

const { posix } = path;

export interface ParsedHeading extends BrainHeading {
  readonly bodyLineIndex: number;
}

export interface ParsedLink {
  readonly target: string;
  readonly label: string;
  readonly line: number;
  readonly image: boolean;
}

export interface ParsedRelation {
  readonly kind: string;
  readonly rawTarget: string;
  readonly source: 'frontmatter' | 'markdown';
  readonly label?: string;
  readonly anchor?: string;
}

export interface ParsedBrainDocument {
  readonly path: string;
  readonly sourcePath: string;
  readonly kind: BrainDocumentKind;
  readonly raw: string;
  readonly body: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly frontmatterPresent: boolean;
  readonly title: string;
  readonly summary: string;
  readonly headings: readonly ParsedHeading[];
  readonly links: readonly ParsedLink[];
  readonly declaredRelations: readonly ParsedRelation[];
  readonly sources: readonly BrainSource[];
  readonly contentHash: string;
  readonly modifiedAt: string;
  readonly sizeBytes: number;
  readonly parseIssues: readonly ValidationIssue[];
}

export interface ParseDocumentInput {
  readonly path: string;
  readonly sourcePath: string;
  readonly content: string;
  readonly modifiedAt: string;
  readonly sizeBytes: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function issue(sourcePath: string, code: string, message: string, line = 1): ValidationIssue {
  return { severity: 'error', code, message, path: sourcePath, line };
}

function parseYamlMapping(
  sourcePath: string,
  input: string,
  lineOffset: number,
  code: string,
): { data: Record<string, unknown>; issues: ValidationIssue[] } {
  const document = parseYamlDocument(input, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  const issues = document.errors.map((error) => {
    const line = input.slice(0, error.pos[0]).split(/\r?\n/u).length + lineOffset;
    const duplicate = /unique|duplicate/i.test(error.message);
    return issue(
      sourcePath,
      duplicate ? 'DUPLICATE_YAML_KEY' : code,
      duplicate ? 'YAML mappings must not contain duplicate keys.' : 'YAML could not be parsed.',
      line,
    );
  });

  if (issues.length > 0) return { data: {}, issues };

  const value = document.toJS({ mapAsMap: false }) as unknown;
  const data = record(value);
  if (!data) {
    return {
      data: {},
      issues: [
        issue(
          sourcePath,
          'FRONTMATTER_NOT_MAPPING',
          'Knowledge metadata must be a mapping.',
          lineOffset,
        ),
      ],
    };
  }
  return { data, issues: [] };
}

function parseMarkdown(
  sourcePath: string,
  content: string,
): {
  metadata: Record<string, unknown>;
  body: string;
  frontmatterPresent: boolean;
  bodyLineOffset: number;
  issues: ValidationIssue[];
} {
  if (!/^---\r?\n/u.test(content)) {
    return {
      metadata: {},
      body: content,
      frontmatterPresent: false,
      bodyLineOffset: 0,
      issues: [],
    };
  }

  const lines = content.split(/(?<=\n)/u);
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return {
      metadata: {},
      body: content,
      frontmatterPresent: true,
      bodyLineOffset: 0,
      issues: [
        issue(sourcePath, 'UNCLOSED_FRONTMATTER', 'Frontmatter is missing its closing delimiter.'),
      ],
    };
  }

  const yaml = lines.slice(1, closingIndex).join('');
  const parsed = parseYamlMapping(sourcePath, yaml, 2, 'INVALID_YAML');
  return {
    metadata: parsed.data,
    body: lines.slice(closingIndex + 1).join(''),
    frontmatterPresent: true,
    bodyLineOffset: closingIndex + 1,
    issues: parsed.issues,
  };
}

function headingAnchor(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[`*_~().,:;!?"']/gu, '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-');
}

function extractHeadings(body: string, lineOffset: number): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  const anchorCounts = new Map<string, number>();
  const lines = body.split(/\r?\n/u);

  lines.forEach((line, bodyLineIndex) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!match?.[1] || !match[2]) return;
    const text = match[2].trim();
    const baseAnchor = headingAnchor(text);
    const seen = anchorCounts.get(baseAnchor) ?? 0;
    anchorCounts.set(baseAnchor, seen + 1);
    const anchor = seen === 0 ? baseAnchor : `${baseAnchor}-${String(seen)}`;
    headings.push({
      text,
      anchor,
      level: match[1].length,
      line: lineOffset + bodyLineIndex + 1,
      bodyLineIndex,
    });
  });

  return headings;
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/^\s*\d+[.)]\s+/gmu, '')
    .replace(/[`*_~>]/gu, '')
    .replace(/\[\^[A-Za-z0-9_-]+\]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function summarize(body: string): string {
  const paragraphs = body
    .split(/\r?\n\s*\r?\n/gu)
    .map(cleanMarkdown)
    .filter((value) => value.length > 0);
  const candidate = paragraphs.find((value) => !value.startsWith('|')) ?? '';
  if (candidate.length <= 320) return candidate;
  return `${candidate.slice(0, 317).trimEnd()}…`;
}

function extractLinks(body: string, lineOffset: number): ParsedLink[] {
  const links: ParsedLink[] = [];
  const expression = /(!?)\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/gu;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(body)) !== null) {
    let targetWithTitle = match[3]?.trim() ?? '';
    if (targetWithTitle.startsWith('<')) {
      const closing = targetWithTitle.indexOf('>');
      targetWithTitle = closing >= 0 ? targetWithTitle.slice(1, closing) : targetWithTitle;
    } else {
      targetWithTitle = targetWithTitle.split(/\s+["']/u, 1)[0] ?? '';
    }
    if (!targetWithTitle) continue;
    links.push({
      target: targetWithTitle,
      label: match[2] ?? '',
      line: lineOffset + body.slice(0, match.index).split(/\r?\n/u).length,
      image: match[1] === '!',
    });
  }

  return links;
}

function relationEntry(kind: string, value: unknown, output: ParsedRelation[]): void {
  if (typeof value === 'string' && value.trim()) {
    output.push({ kind, rawTarget: value.trim(), source: 'frontmatter' });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => relationEntry(kind, entry, output));
    return;
  }
  const mapping = record(value);
  if (!mapping) return;
  const target =
    stringValue(mapping.target) ??
    stringValue(mapping.to) ??
    stringValue(mapping.id) ??
    stringValue(mapping.concept_id);
  if (!target) return;
  const relationKind = stringValue(mapping.type) ?? stringValue(mapping.kind) ?? kind;
  const label = stringValue(mapping.label);
  output.push({
    kind: relationKind,
    rawTarget: target,
    source: 'frontmatter',
    ...(label ? { label } : {}),
  });
}

function extractDeclaredRelations(metadata: Record<string, unknown>): ParsedRelation[] {
  const output: ParsedRelation[] = [];
  const relations = metadata.relations;
  if (Array.isArray(relations)) {
    relations.forEach((value) => relationEntry('related', value, output));
  } else {
    const mapping = record(relations);
    if (mapping) {
      Object.entries(mapping).forEach(([kind, value]) => relationEntry(kind, value, output));
    }
  }
  return output;
}

function extractSources(metadata: Record<string, unknown>): BrainSource[] {
  if (!Array.isArray(metadata.sources)) return [];
  const output: BrainSource[] = [];
  for (const entry of metadata.sources) {
    const mapping = record(entry);
    const resource = stringValue(mapping?.resource);
    if (!resource) continue;
    const id = stringValue(mapping?.id);
    const title = stringValue(mapping?.title);
    const author = stringValue(mapping?.author);
    output.push({
      resource,
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
    });
  }
  return output;
}

function kindFor(filePath: string): BrainDocumentKind {
  const basename = posix.basename(filePath).toLocaleLowerCase('en-US');
  if (basename === 'index.md') return 'index';
  if (basename === 'log.md') return 'log';
  return 'concept';
}

function titleFromPath(filePath: string): string {
  const basename = posix.basename(filePath, posix.extname(filePath));
  return basename
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase('en-US')}${part.slice(1)}`)
    .join(' ');
}

function parseStructuredFile(
  sourcePath: string,
  extension: string,
  content: string,
): { metadata: Record<string, unknown>; body: string; issues: ValidationIssue[] } {
  if (extension === '.json') {
    try {
      const value = JSON.parse(content) as unknown;
      const metadata = record(value);
      if (!metadata) {
        return {
          metadata: {},
          body: content,
          issues: [
            issue(sourcePath, 'JSON_NOT_MAPPING', 'JSON knowledge files must contain an object.'),
          ],
        };
      }
      return {
        metadata,
        body: stringValue(metadata.body) ?? stringValue(metadata.content) ?? content,
        issues: [],
      };
    } catch {
      return {
        metadata: {},
        body: content,
        issues: [issue(sourcePath, 'INVALID_JSON', 'JSON could not be parsed.')],
      };
    }
  }

  const parsed = parseYamlMapping(sourcePath, content, 1, 'INVALID_YAML');
  return {
    metadata: parsed.data,
    body: stringValue(parsed.data.body) ?? stringValue(parsed.data.content) ?? content,
    issues: parsed.issues,
  };
}

export function parseBrainDocument(input: ParseDocumentInput): ParsedBrainDocument {
  const extension = posix.extname(input.path).toLocaleLowerCase('en-US');
  const markdown = extension === '.md' || extension === '.markdown';
  const parsed = markdown
    ? parseMarkdown(input.sourcePath, input.content)
    : {
        ...parseStructuredFile(input.sourcePath, extension, input.content),
        frontmatterPresent: true,
        bodyLineOffset: 0,
      };
  const headings = markdown ? extractHeadings(parsed.body, parsed.bodyLineOffset) : [];
  const links = markdown ? extractLinks(parsed.body, parsed.bodyLineOffset) : [];
  const metadataTitle = stringValue(parsed.metadata.title);
  const headingTitle = headings.find((heading) => heading.level === 1)?.text;
  const title = metadataTitle ?? headingTitle ?? titleFromPath(input.path);
  const description = stringValue(parsed.metadata.description);

  return {
    path: input.path,
    sourcePath: input.sourcePath,
    kind: kindFor(input.path),
    raw: input.content,
    body: parsed.body,
    metadata: parsed.metadata,
    frontmatterPresent: parsed.frontmatterPresent,
    title,
    summary: description ?? summarize(parsed.body),
    headings,
    links,
    declaredRelations: extractDeclaredRelations(parsed.metadata),
    sources: extractSources(parsed.metadata),
    contentHash: createHash('sha256').update(input.content, 'utf8').digest('hex'),
    modifiedAt: input.modifiedAt,
    sizeBytes: input.sizeBytes,
    parseIssues: parsed.issues,
  };
}

export function extractHeadingSection(
  document: ParsedBrainDocument,
  heading: ParsedHeading,
): string {
  const lines = document.body.split(/\r?\n/u);
  const next = document.headings.find(
    (candidate) =>
      candidate.bodyLineIndex > heading.bodyLineIndex && candidate.level <= heading.level,
  );
  return lines
    .slice(heading.bodyLineIndex, next?.bodyLineIndex ?? lines.length)
    .join('\n')
    .trim();
}

export function normalizeHeadingSelector(value: string): string {
  const selector = value.trim().replace(/^#+/u, '');
  return headingAnchor(selector);
}

export function markdownToPlainText(value: string): string {
  return cleanMarkdown(value);
}
