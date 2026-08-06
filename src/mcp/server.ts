import { McpServer } from '@modelcontextprotocol/server';
import type { ActorContext } from '../auth/index.js';
import type { BrainChange, BrainKernel } from '../brain/index.js';
import { AppError } from '../errors.js';
import type {
  CreateProposalRequest,
  CreateProposalResult,
  GetProposalInput,
  ProposalStatusResult,
} from '../github/index.js';
import type { Telemetry } from '../observability/index.js';
import { toolFailure, toolSuccess } from './results.js';
import {
  brainContextPackInputSchema,
  brainGetInputSchema,
  brainGetProposalInputSchema,
  brainHealthInputSchema,
  brainListDomainsInputSchema,
  brainProposeChangeInputSchema,
  brainSearchInputSchema,
  brainValidateInputSchema,
  toolOutputSchema,
} from './schemas.js';

export interface GitHubConnectivity {
  readonly status: 'connected' | 'disabled' | 'unavailable' | 'unknown';
  readonly checked_at?: string;
  readonly message?: string;
}

export interface ProposalGateway {
  createProposal(
    request: Omit<CreateProposalRequest, 'actor'>,
    actor: ActorContext,
    sessionId: string,
  ): Promise<CreateProposalResult>;
  getProposal(
    input: GetProposalInput,
    actor: ActorContext,
    sessionId?: string,
  ): Promise<ProposalStatusResult>;
}

export interface CompanyBrainMcpDependencies {
  readonly brain: BrainKernel;
  readonly telemetry: Telemetry;
  readonly proposals?: ProposalGateway;
  readonly gitSha: string;
  readonly configurationWarnings: readonly string[];
  readonly githubConnectivity: () => Promise<GitHubConnectivity>;
}

export interface CompanyBrainMcpContext {
  readonly actor: ActorContext;
  readonly sessionId?: string;
}

function requireRead(actor: ActorContext): void {
  if (!actor.canRead) throw new AppError('FORBIDDEN', 'Repository read access is required.');
}

function requireProposalIdentity(
  actor: ActorContext,
  sessionId: string | undefined,
): {
  actor: ActorContext & { githubUserId: number; githubLogin: string };
  sessionId: string;
} {
  if (
    actor.authMethod !== 'github' ||
    typeof actor.githubUserId !== 'number' ||
    !actor.githubLogin ||
    !actor.canWrite ||
    !sessionId
  ) {
    throw new AppError(
      'FORBIDDEN',
      'An authenticated GitHub user with repository write access is required.',
    );
  }
  return { actor, sessionId } as {
    actor: ActorContext & { githubUserId: number; githubLogin: string };
    sessionId: string;
  };
}

function traceActor(actor: ActorContext): Readonly<Record<string, unknown>> {
  return {
    auth_method: actor.authMethod,
    repository: actor.repository,
    repository_permission: actor.repositoryPermission,
    ...(actor.githubUserId === undefined ? {} : { github_user_id: actor.githubUserId }),
    ...(actor.githubLogin === undefined ? {} : { github_login: actor.githubLogin }),
  };
}

function registerReadTools(
  server: McpServer,
  dependencies: CompanyBrainMcpDependencies,
  context: CompanyBrainMcpContext,
): void {
  server.registerTool(
    'brain_search',
    {
      title: 'Search Company Brain',
      description: 'Deterministically search indexed Company Brain concepts with citations.',
      inputSchema: brainSearchInputSchema,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        requireRead(context.actor);
        const results = await dependencies.telemetry.observe(
          'brain.search',
          {
            metadata: {
              ...traceActor(context.actor),
              query_characters: input.query.length,
              domains: input.domains ?? [],
              types: input.types ?? [],
              tags: input.tags ?? [],
              limit: input.limit,
            },
            resultMetadata: (value) => {
              const matches = value as ReturnType<BrainKernel['search']>;
              return {
                result_count: matches.length,
                concept_ids: matches.map((entry) => entry.conceptId),
                source_paths: matches.map((entry) => entry.sourcePath),
              };
            },
          },
          () =>
            Promise.resolve(
              dependencies.brain.search({
                query: input.query,
                limit: input.limit,
                ...(input.domains === undefined ? {} : { domains: input.domains }),
                ...(input.types === undefined ? {} : { types: input.types }),
                ...(input.tags === undefined ? {} : { tags: input.tags }),
              }),
            ),
        );
        return toolSuccess(results);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    'brain_get',
    {
      title: 'Get Company Brain concept',
      description: 'Retrieve one concept or safe Brain-relative path, optionally by heading.',
      inputSchema: brainGetInputSchema,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        requireRead(context.actor);
        const result = await dependencies.telemetry.observe(
          'brain.get',
          {
            metadata: {
              ...traceActor(context.actor),
              ...(input.concept_id === undefined ? {} : { concept_id: input.concept_id }),
              ...(input.path === undefined ? {} : { source_path: input.path }),
              ...(input.heading === undefined ? {} : { heading: input.heading }),
            },
            resultMetadata: (value) => {
              const concept = value as ReturnType<BrainKernel['get']>;
              return {
                concept_id: concept.conceptId,
                source_path: concept.sourcePath,
                content_hash: concept.contentHash,
                content_characters: concept.content.length,
              };
            },
          },
          () =>
            Promise.resolve(
              dependencies.brain.get({
                ...(input.concept_id === undefined ? {} : { conceptId: input.concept_id }),
                ...(input.path === undefined ? {} : { path: input.path }),
                ...(input.heading === undefined ? {} : { heading: input.heading }),
              }),
            ),
        );
        return toolSuccess(result);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    'brain_context_pack',
    {
      title: 'Build Company Brain context pack',
      description: 'Build a bounded, deduplicated, deterministic context pack without an LLM.',
      inputSchema: brainContextPackInputSchema,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        requireRead(context.actor);
        const result = await dependencies.telemetry.observe(
          'brain.select_context',
          {
            metadata: {
              ...traceActor(context.actor),
              objective_characters: input.objective.length,
              domains: input.domains ?? [],
              seed_concept_ids: input.seed_concept_ids ?? [],
              maximum_characters: input.maximum_characters,
              approximate_token_budget: input.approximate_token_budget,
            },
            resultMetadata: (value) => {
              const pack = value as ReturnType<BrainKernel['contextPack']>;
              return {
                concept_ids: pack.concepts.map((entry) => entry.conceptId),
                source_paths: pack.citations.map((entry) => entry.path),
                selected_count: pack.selection.selectedCount,
                used_characters: pack.selection.usedCharacters,
                truncated: pack.selection.truncated,
                warning_count: pack.warnings.length,
              };
            },
          },
          () =>
            Promise.resolve(
              dependencies.brain.contextPack({
                objective: input.objective,
                ...(input.domains === undefined ? {} : { domains: input.domains }),
                ...(input.seed_concept_ids === undefined
                  ? {}
                  : { seedConceptIds: input.seed_concept_ids }),
                ...(input.maximum_characters === undefined
                  ? {}
                  : { maxCharacters: input.maximum_characters }),
                ...(input.approximate_token_budget === undefined
                  ? {}
                  : { approximateTokenBudget: input.approximate_token_budget }),
              }),
            ),
        );
        return toolSuccess(result);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    'brain_list_domains',
    {
      title: 'List Company Brain domains',
      description: 'List domains, concept counts, types, owners, and validation summaries.',
      inputSchema: brainListDomainsInputSchema,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    () => {
      try {
        requireRead(context.actor);
        return toolSuccess(dependencies.brain.listDomains());
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    'brain_validate',
    {
      title: 'Validate Company Brain',
      description: 'Validate the current Brain or an exact in-memory set of proposed changes.',
      inputSchema: brainValidateInputSchema,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        requireRead(context.actor);
        const changes: BrainChange[] | undefined = input.changes?.map((change) => ({
          operation: change.operation,
          path: change.path,
          ...(change.content === undefined ? {} : { content: change.content }),
          ...(change.expected_previous_content_hash === undefined
            ? {}
            : { expectedPreviousContentHash: change.expected_previous_content_hash }),
        }));
        const result = await dependencies.telemetry.observe(
          'brain.validate',
          {
            metadata: {
              ...traceActor(context.actor),
              change_count: changes?.length ?? 0,
              changed_paths: changes?.map((entry) => entry.path) ?? [],
            },
            resultMetadata: (value) => {
              const report = value as ReturnType<BrainKernel['validate']>;
              return {
                valid: report.valid,
                validation_error_count: report.errors,
                validation_warning_count: report.warnings,
                file_count: report.fileCount,
                concept_count: report.conceptCount,
              };
            },
          },
          () =>
            Promise.resolve(dependencies.brain.validate(changes === undefined ? {} : { changes })),
        );
        return toolSuccess(result);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    'brain_health',
    {
      title: 'Company Brain health',
      description: 'Return non-sensitive Brain, GitHub, telemetry, and build health.',
      inputSchema: brainHealthInputSchema,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        requireRead(context.actor);
        const github = await dependencies.githubConnectivity();
        return toolSuccess({
          ...dependencies.brain.health(),
          current_git_commit: dependencies.gitSha,
          github_connectivity: github,
          langfuse: dependencies.telemetry.enabled ? 'enabled' : 'disabled',
          configuration_warnings: dependencies.configurationWarnings,
        });
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
}

function registerProposalTools(
  server: McpServer,
  dependencies: CompanyBrainMcpDependencies,
  context: CompanyBrainMcpContext,
): void {
  server.registerTool(
    'brain_propose_change',
    {
      title: 'Propose Company Brain change',
      description: 'Validate exact content and open an isolated GitHub draft pull request.',
      inputSchema: brainProposeChangeInputSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const identity = requireProposalIdentity(context.actor, context.sessionId);
        if (!dependencies.proposals) {
          throw new AppError('GITHUB_UNAVAILABLE', 'GitHub proposal support is not configured.');
        }
        const result = await dependencies.proposals.createProposal(
          {
            baseSha: input.base_sha,
            title: input.title,
            rationale: input.rationale,
            changes: input.changes.map((change) => ({
              operation: change.operation,
              path: change.path,
              ...(change.content === undefined ? {} : { content: change.content }),
              ...(change.expected_previous_content_hash === undefined
                ? {}
                : { expectedContentSha256: change.expected_previous_content_hash }),
              ...(change.expected_blob_sha === undefined
                ? {}
                : { expectedBlobSha: change.expected_blob_sha }),
            })),
          },
          identity.actor,
          identity.sessionId,
        );
        return toolSuccess(result);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    'brain_get_proposal',
    {
      title: 'Get Company Brain proposal',
      description: 'Inspect proposal attribution, validation, PR, checks, and conflict state.',
      inputSchema: brainGetProposalInputSchema,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        requireRead(context.actor);
        if (!dependencies.proposals) {
          throw new AppError('GITHUB_UNAVAILABLE', 'GitHub proposal support is not configured.');
        }
        const result = await dependencies.proposals.getProposal(
          {
            ...(input.proposal_id === undefined ? {} : { proposalId: input.proposal_id }),
            ...(input.pull_request_number === undefined
              ? {}
              : { pullRequestNumber: input.pull_request_number }),
          },
          context.actor,
          context.sessionId,
        );
        return toolSuccess(result);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
}

export function createCompanyBrainMcpServer(
  dependencies: CompanyBrainMcpDependencies,
  context: CompanyBrainMcpContext,
): McpServer {
  const server = new McpServer({ name: 'superseller-company-brain', version: '0.1.0' });
  registerReadTools(server, dependencies, context);
  registerProposalTools(server, dependencies, context);
  return server;
}
