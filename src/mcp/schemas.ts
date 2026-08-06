import { z } from 'zod/v4';

const pathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) => !value.includes('\\') && !value.includes('\0'),
    'Path must use safe POSIX syntax',
  );

export const brainSearchInputSchema = z.object({
  query: z.string().min(1).max(1_000),
  domains: z.array(z.string().min(1).max(100)).max(30).optional(),
  types: z.array(z.string().min(1).max(100)).max(50).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const brainGetInputSchema = z
  .object({
    concept_id: z.string().min(1).max(512).optional(),
    path: pathSchema.optional(),
    heading: z.string().min(1).max(300).optional(),
  })
  .refine(
    (input) => Number(input.concept_id !== undefined) + Number(input.path !== undefined) === 1,
    {
      message: 'Provide exactly one of concept_id or path',
    },
  );

export const brainContextPackInputSchema = z.object({
  objective: z.string().min(1).max(4_000),
  domains: z.array(z.string().min(1).max(100)).max(30).optional(),
  seed_concept_ids: z.array(z.string().min(1).max(512)).max(50).optional(),
  maximum_characters: z.number().int().min(1_000).max(100_000).optional(),
  approximate_token_budget: z.number().int().min(250).max(25_000).optional(),
});

export const brainListDomainsInputSchema = z.object({});

export const brainChangeSchema = z.object({
  operation: z.enum(['create', 'update', 'delete', 'upsert']),
  path: pathSchema,
  content: z.string().max(1_000_000).optional(),
  expected_previous_content_hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export const brainValidateInputSchema = z.object({
  changes: z.array(brainChangeSchema).max(100).optional(),
});

export const brainHealthInputSchema = z.object({});

export const proposalChangeSchema = z.object({
  operation: z.enum(['create', 'update', 'delete']),
  path: pathSchema,
  content: z.string().max(1_000_000).optional(),
  expected_previous_content_hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  expected_blob_sha: z
    .string()
    .regex(/^[a-fA-F0-9]{40,64}$/)
    .optional(),
});

export const brainProposeChangeInputSchema = z.object({
  base_sha: z.string().regex(/^[a-fA-F0-9]{40,64}$/),
  title: z.string().min(3).max(200),
  rationale: z.string().min(3).max(10_000),
  changes: z.array(proposalChangeSchema).min(1).max(100),
});

export const brainGetProposalInputSchema = z
  .object({
    proposal_id: z.uuid().optional(),
    pull_request_number: z.number().int().positive().optional(),
  })
  .refine(
    (input) =>
      Number(input.proposal_id !== undefined) + Number(input.pull_request_number !== undefined) ===
      1,
    { message: 'Provide exactly one of proposal_id or pull_request_number' },
  );

export const toolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      category: z.string(),
      message: z.string(),
      correlation_id: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export type BrainProposeChangeInput = z.infer<typeof brainProposeChangeInputSchema>;
export type BrainGetProposalInput = z.infer<typeof brainGetProposalInputSchema>;
