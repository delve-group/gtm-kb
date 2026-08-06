---
type: Operations
title: Langfuse Self-Hosting and R2
description: Required Cloudflare R2 event storage, deployment verification, and missing-trace troubleshooting for self-hosted Langfuse.
resource: /operations/langfuse-self-hosting.md
tags: [operations, langfuse, cloudflare-r2, observability]
status: current
owner: project
source_paths:
  - backend/src/ai_audit/langfuse_client.py
  - backend/env.example
  - backend/.env.prod.example
last_reviewed: 2026-07-13
timestamp: 2026-07-13
---

# Langfuse Self-Hosting and R2

Self-hosted Langfuse requires S3-compatible event storage. PostgreSQL,
ClickHouse, and Redis alone are not enough: ingestion uploads raw event files to
object storage before the worker completes trace processing. Configure the same
event-upload variables on both the Langfuse web and Langfuse worker services.

## Cloudflare R2 configuration

Create a private R2 bucket and an R2 API token scoped to that bucket with Object
Read & Write permission. Copy the token's Access Key ID and Secret Access Key;
the Cloudflare API token value itself is not the S3 secret.

Set these variables on both Langfuse services, then redeploy both services:

```dotenv
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=<bucket-name>
LANGFUSE_S3_EVENT_UPLOAD_REGION=auto
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=<r2-access-key-id>
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=<r2-secret-access-key>
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
LANGFUSE_S3_EVENT_UPLOAD_PREFIX=events/
```

The prefix is optional, but if set it must end with `/`. Do not enable forced
path-style addressing for R2 unless a future provider change explicitly
requires it. Never put R2 credentials in the backend application: they belong
to the self-hosted Langfuse web and worker services.

## Verification

1. Confirm both Langfuse containers have the bucket, region, credentials, and
   endpoint plus the same prefix when one is used. Recreate the containers; do
   not merely restart them with their previous environment.
2. Generate one new AI reply. Existing failed ingestion attempts are not a
   substitute for a fresh end-to-end check.
3. Confirm an object appears under the configured R2 prefix.
4. Confirm the trace appears in Langfuse with an autoresponder root and nested
   observations.
5. Check Langfuse web and worker logs for upload or ingestion errors.

`Langfuse.auth_check()` verifies project API credentials and reachability; it
does not prove that the self-hosted server can write to R2.

## Missing-trace diagnosis

When the backend exporter receives HTTP 500, inspect the Langfuse web and worker
logs before changing backend instrumentation. A message such as
`CredentialsProviderError: Could not load credentials from any providers` or
`Failed to upload JSON to S3` means the trace reached Langfuse but its mandatory
event-storage configuration is missing or unavailable.

Also verify:

- Backend `LANGFUSE_BASE_URL`, public key, and secret key belong to the same
  Langfuse project.
- Backend tracing is enabled and `LANGFUSE_SAMPLE_RATE` is greater than `0` and
  at most `1`.
- Self-hosted Langfuse is new enough for the OpenTelemetry SDK path.
- Long-running backend and Celery processes were restarted after environment or
  SDK changes so buffered events can flush on shutdown.

For planned retention, add an R2 lifecycle rule for the event prefix. Match any
ClickHouse `blob_storage_file_log` TTL deliberately; do not treat object
lifecycle deletion as the application audit-retention policy. Local `ai_audit`
remains the authoritative traceability and usage store.

# Citations

- [Langfuse S3/blob-storage configuration](https://langfuse.com/self-hosting/deployment/infrastructure/blobstorage)
- [Langfuse SDK troubleshooting](https://langfuse.com/docs/observability/sdk/troubleshooting-and-faq)
- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/)
