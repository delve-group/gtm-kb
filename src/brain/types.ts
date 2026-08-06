export type BrainDocumentKind = 'concept' | 'index' | 'log' | 'document';

export type ValidationSeverity = 'error' | 'warning';

export interface BrainHeading {
  readonly text: string;
  readonly anchor: string;
  readonly level: number;
  readonly line: number;
}

export interface BrainSource {
  readonly id?: string;
  readonly resource: string;
  readonly title?: string;
  readonly author?: string;
}

export interface BrainCitation {
  /** Repository-relative path to the concept that supports the result. */
  readonly path: string;
  readonly anchor?: string;
  readonly sourceId?: string;
  readonly resource?: string;
  readonly title?: string;
}

export interface BrainRelation {
  readonly kind: string;
  /** Present when an edge is returned outside the containing concept. */
  readonly sourceConceptId?: string;
  readonly targetId: string;
  readonly source: 'frontmatter' | 'markdown';
  readonly label?: string;
  readonly anchor?: string;
}

export interface BrainConcept {
  /** Bundle-relative path without the file extension. */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly domain: string;
  readonly type: string;
  readonly tags: readonly string[];
  readonly relations: readonly BrainRelation[];
  readonly owner?: string;
  readonly status?: string;
  readonly path: string;
  readonly sourcePath: string;
  readonly headings: readonly BrainHeading[];
  readonly sources: readonly BrainSource[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
  readonly modifiedAt: string;
  readonly sizeBytes: number;
}

export interface BrainSearchInput {
  readonly query: string;
  readonly domains?: readonly string[];
  readonly types?: readonly string[];
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface BrainSearchResult {
  readonly conceptId: string;
  readonly title: string;
  readonly summary: string;
  readonly excerpt: string;
  readonly score: number;
  readonly domain: string;
  readonly type: string;
  readonly tags: readonly string[];
  readonly owner?: string;
  readonly status?: string;
  readonly sourcePath: string;
  readonly citations: readonly BrainCitation[];
  readonly contentHash: string;
}

export interface BrainGetInput {
  readonly conceptId?: string;
  /** A bundle-relative or repository-relative path below the configured brain root. */
  readonly path?: string;
  readonly heading?: string;
}

export interface BrainGetResult {
  readonly kind: BrainDocumentKind;
  readonly conceptId?: string;
  readonly title: string;
  readonly content: string;
  readonly selectedHeading?: BrainHeading;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sourcePath: string;
  readonly headings: readonly BrainHeading[];
  readonly relations: readonly BrainRelation[];
  readonly citations: readonly BrainCitation[];
  readonly contentHash: string;
}

export interface BrainContextPackInput {
  readonly objective: string;
  readonly domains?: readonly string[];
  readonly seedConceptIds?: readonly string[];
  readonly maxCharacters?: number;
  readonly approximateTokenBudget?: number;
}

export interface BrainContextFact {
  readonly text: string;
  readonly conceptId: string;
  readonly citation: BrainCitation;
}

export interface BrainContextConcept {
  readonly conceptId: string;
  readonly title: string;
  readonly domain: string;
  readonly type: string;
  readonly excerpt: string;
  readonly sourcePath: string;
  readonly contentHash: string;
}

export interface BrainContextSelection {
  readonly algorithm: 'deterministic-lexical-v1';
  readonly maxCharacters: number;
  readonly usedCharacters: number;
  readonly approximateTokens: number;
  readonly candidateCount: number;
  readonly selectedCount: number;
  readonly truncated: boolean;
}

export interface BrainContextPack {
  readonly objective: string;
  /** The strictly character-bounded, ready-to-prompt representation. */
  readonly content: string;
  readonly selectedFacts: readonly BrainContextFact[];
  readonly concepts: readonly BrainContextConcept[];
  readonly relationships: readonly BrainRelation[];
  readonly citations: readonly BrainCitation[];
  readonly warnings: readonly string[];
  readonly selection: BrainContextSelection;
}

export interface BrainDomainSummary {
  readonly domain: string;
  readonly conceptCount: number;
  readonly types: readonly { readonly type: string; readonly count: number }[];
  readonly owners: readonly { readonly owner: string; readonly count: number }[];
  readonly validation: {
    readonly errors: number;
    readonly warnings: number;
  };
}

export interface BrainDomainsReport {
  readonly domains: readonly BrainDomainSummary[];
  readonly totalConcepts: number;
  readonly totalTypes: number;
  readonly totalOwners: number;
}

export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly conceptId?: string;
  readonly line?: number;
  readonly relatedPaths?: readonly string[];
}

export interface BrainChange {
  readonly operation: 'create' | 'update' | 'delete' | 'upsert';
  /** Bundle-relative or repository-relative path below the configured brain root. */
  readonly path: string;
  readonly content?: string;
  readonly expectedPreviousContentHash?: string;
}

export interface BrainValidationInput {
  readonly changes?: readonly BrainChange[];
}

export interface BrainValidationReport {
  readonly valid: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly issues: readonly ValidationIssue[];
  readonly fileCount: number;
  readonly conceptCount: number;
  readonly contentHash: string;
  readonly checkedAt: string;
  readonly overlayApplied: boolean;
}

export interface BrainHealthSnapshot {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly indexedFileCount: number;
  readonly indexedConceptCount: number;
  readonly validationStatus: 'pass' | 'warnings' | 'fail';
  readonly validationErrors: number;
  readonly validationWarnings: number;
  readonly lastSuccessfulRefresh: string | null;
  readonly contentHash: string | null;
  readonly domains: readonly string[];
  readonly refreshError?: string;
}

export interface BrainKernelOptions {
  readonly rootDir: string;
  /** Defaults to the parent of rootDir. Used only to validate local evidence links. */
  readonly repositoryRoot?: string;
  readonly controlledDomains?: readonly string[];
  readonly controlledTypes?: readonly string[];
  readonly defaultContextCharacters?: number;
  readonly maximumContextCharacters?: number;
  readonly now?: () => Date;
}
