---
type: Backend Module
title: RAG Knowledge Base Module
description: RAG document ingestion, embedding, retrieval, confidence, and API behavior.
resource: /backend/rag.md
tags: [backend, rag, knowledge]
status: current
owner: project
source_paths:
  - backend/docs/rag.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# RAG Knowledge Base Module

The **RAG (Retrieval-Augmented Generation) Knowledge Base** module (`backend/src/rag/`) handles the full lifecycle of knowledge documents: upload, parsing, chunking, embedding, storage, and real-time vector retrieval for answering buyer questions. It supports both a **Global KB** (shared across all offers) and **Product-specific KBs** (scoped to individual Allegro offer IDs), with a strict priority system where product knowledge always overrides global knowledge.

## Architecture

The module is divided into the following components:

```
backend/src/rag/
├── models.py       # Django ORM models (documents, fragments, offer config)
├── services.py     # Document parsing, chunking, and embedding generation
├── tasks.py        # Celery async task for document ingestion pipeline
├── retrieval.py    # Tiered vector search with score boosting and token budgets
├── views.py        # REST API endpoints
├── urls.py         # URL routing (/api/kb/...)
├── admin.py        # Django admin panel configuration
└── migrations/     # DB migrations including pgvector HNSW index
```

### Data Flow

```
Upload (PDF/DOCX/TXT)
  └─→ Celery task (async)
       ├─→ Parse (DocumentParser: PyMuPDF, python-docx, or plain read)
       ├─→ Chunk (overlapping ~600-token windows, 100-token overlap)
       ├─→ Embed (OpenAI text-embedding-3-small → 1536-dim vectors)
       ├─→ Store (GlobalKBFragment rows in PostgreSQL + pgvector)
       └─→ Version promotion (deactivate older versions of same document)
```

## Models

### `GlobalKBDocument`

Represents a single uploaded file. Despite the name, it serves both global and product-scoped documents — distinguished by the `offer_id` field.

| Field          | Type                   | Description                                                   |
|----------------|------------------------|---------------------------------------------------------------|
| `id`           | `UUID` (PK)            | Auto-generated primary key                                    |
| `name`         | `CharField(512)`       | Display name (defaults to filename)                           |
| `file`         | `FileField`            | Uploaded file stored at `kb/global/`                          |
| `offer_id`     | `CharField(128)`, null | Allegro offer ID. `NULL` = global KB, non-null = product KB   |
| `version`      | `PositiveIntegerField`  | Incremented per-name+offer_id pair                            |
| `active`       | `BooleanField`         | Only the latest ready version is active                       |
| `status`       | `CharField` enum       | `uploaded` → `processing` → `ready` / `failed`               |
| `uploaded_at`  | `DateTimeField`        | Auto-set on creation                                          |
| `processed_at` | `DateTimeField`, null  | Set when processing completes (success or failure)            |

Property `is_product` returns `True` when `offer_id` is set.

### `GlobalKBFragment`

A single text chunk with its embedding vector, belonging to a document.

| Field         | Type                   | Description                                                 |
|---------------|------------------------|-------------------------------------------------------------|
| `id`          | `UUID` (PK)            | Auto-generated primary key                                  |
| `document`    | `FK → GlobalKBDocument`| Parent document (cascade delete)                            |
| `text`        | `TextField`            | Plain text content of the chunk                             |
| `embedding`   | `VectorField(1536)`    | pgvector embedding (OpenAI `text-embedding-3-small`)        |
| `position`    | `PositiveIntegerField`  | Order within the document (0-based)                         |
| `source_type` | `CharField(32)`        | `"global"` or `"product"`                                   |
| `product_id`  | `CharField(128)`, null | Mirrors `document.offer_id` for fast retrieval filtering    |
| `active`      | `BooleanField`         | Only fragments of the active document version are active    |

An **HNSW vector index** (migration `0002`) accelerates cosine similarity searches on the `embedding` column.

### `OfferKBConfig`

Per-offer configuration, primarily the auto-reply toggle.

| Field                | Type                 | Description                                        |
|----------------------|----------------------|----------------------------------------------------|
| `id`                 | `UUID` (PK)          | Auto-generated primary key                         |
| `offer_id`           | `CharField(128)`     | Unique Allegro offer ID                            |
| `offer_name`         | `CharField(512)`     | Human-readable offer name (optional)               |
| `auto_reply_enabled` | `BooleanField`       | `False` → messages for this offer skip RAG         |
| `user`               | `FK → AUTH_USER`     | Owner who created/updated the config               |

## Document Ingestion Pipeline

Handled by the Celery task `process_global_kb_document` in `tasks.py`.

### Trigger

Called asynchronously via `.delay()` immediately after a document is uploaded through any API endpoint. The document's status transitions through: `uploaded` → `processing` → `ready` (or `failed`).

### Steps

1. **Parse** — `DocumentParser.parse(file_path)` dispatches to the appropriate parser:
   - `.pdf` → PyMuPDF (`pymupdf`)
   - `.docx` → `python-docx`
   - `.txt` → plain file read
   - Output is cleaned (page numbers stripped, excessive whitespace collapsed).

2. **Chunk** — `chunk_text(text)` splits the parsed text into overlapping windows:
   - **Chunk size**: ~600 tokens (~2400 chars)
   - **Overlap**: ~100 tokens (~400 chars)
   - Token count is approximated at 4 chars/token.

3. **Embed** — `generate_embedding(chunk)` calls OpenAI:
   - Model: `text-embedding-3-small`
   - Output: 1536-dimensional float vector per chunk.

4. **Store** — Old fragments for this document are deleted, new ones are bulk-created.

5. **Version promotion** — `_promote_latest_ready_document(name, offer_id)`:
   - Deactivates all document versions with the same `name` + `offer_id`.
   - Activates only the latest `ready` version and its fragments.
   - This ensures re-uploads of the same file seamlessly replace older versions.

### Error Handling

- The task is configured with `max_retries=2` and a 30-second retry delay.
- If parsing produces no text, the document is marked `failed` without retry.
- On any exception, the document is marked `failed` and the task is retried.

## Retrieval Engine

Located in `retrieval.py`. Implements **dual-KB retrieval with product-score priority**.

### Algorithm

```
retrieve_fragments(query, product_id, top_n=8)
│
├─ 1. Embed the query → 1536-dim vector
│
├─ 2. If product_id is set:
│     Search product KB (WHERE product_id = ?) → up to 12 hits
│
├─ 3. Always search global KB → up to 8 hits
│     Deduplicate against product hits by fragment ID
│
├─ 4. Score all candidates:
│     ├─ Product fragments get a +0.10 score boost
│     └─ Sort by final_score descending
│
├─ 5. Enforce token budget (1500 tokens max), then cap at top_n
│
└─ 6. Compute confidence score (0.0–1.0) from the final fragment set
```

### Tuning Parameters

All thresholds are defined as module-level constants for easy adjustment:

| Constant                    | Default | Purpose                                                    |
|-----------------------------|---------|------------------------------------------------------------|
| `PRODUCT_SEARCH_LIMIT`      | 12      | Max rows fetched from product-scoped vector search         |
| `GLOBAL_SEARCH_LIMIT`       | 8       | Max rows fetched from global vector search                 |
| `PRODUCT_SCORE_BOOST`       | 0.10    | Added to product fragment scores to maintain priority      |
| `MAX_CONTEXT_TOKENS`        | 1500    | Total token budget for retrieved context                   |

### Confidence Scoring

After retrieval, a confidence score (0.0–1.0) is computed to decide whether the system should auto-respond or escalate to a human operator. The score is a weighted combination of four signals:

| Signal              | Weight | Description                                                           |
|---------------------|--------|-----------------------------------------------------------------------|
| `top_similarity`    | 0.45   | Highest cosine similarity among returned fragments                    |
| `mean_similarity`   | 0.30   | Average similarity across all returned fragments                      |
| `source_count`      | 0.15   | Number of fragments (capped at 5, normalized to 0-1)                  |
| `source_agreement`  | 0.10   | 1.0 if all fragments share the same `source_type`, lower when mixed   |

```
confidence = 0.45 × top_sim + 0.30 × mean_sim + 0.15 × (count / 5) + 0.10 × agreement
```

The `source_agreement` signal acts as a conflict detector: when fragments come from both product and global KBs with roughly equal representation, the agreement drops, reducing overall confidence.

**Decision gate**: If `confidence < CONFIDENCE_THRESHOLD` (default: **0.40**), the simulator does **not** generate an LLM reply. Instead, it returns an escalation result indicating the message should be forwarded to a human operator.

#### Confidence Tuning Parameters

| Constant                       | Default | Purpose                                      |
|--------------------------------|---------|----------------------------------------------|
| `CONFIDENCE_THRESHOLD`         | 0.40    | Below this → escalate to human               |
| `CONFIDENCE_WEIGHT_TOP_SIM`    | 0.45    | Weight for highest similarity signal          |
| `CONFIDENCE_WEIGHT_MEAN_SIM`   | 0.30    | Weight for average similarity signal          |
| `CONFIDENCE_WEIGHT_SOURCE_COUNT`| 0.15   | Weight for number-of-sources signal           |
| `CONFIDENCE_WEIGHT_AGREEMENT`  | 0.10    | Weight for source type agreement signal       |
| `CONFIDENCE_SOURCE_COUNT_CAP`  | 5       | Source count is normalized as `min(n/cap, 1)` |

The confidence details are included in the simulator's trace payload and displayed in the frontend Decision Trace panel, color-coded:
- **Green** (≥ 75%) — high confidence, auto-reply generated
- **Yellow** (40–74%) — moderate confidence, auto-reply generated
- **Red** (< 40%) — low confidence, escalated to operator

### SQL

Vector search uses raw SQL with pgvector's cosine distance operator (`<=>`):

```sql
SELECT f.id, f.text, ..., 1 - (f.embedding <=> $query_vector) AS similarity
  FROM rag_globalkbfragment AS f
  JOIN rag_globalkbdocument AS d ON d.id = f.document_id
 WHERE f.active = TRUE AND d.active = TRUE AND d.status = 'ready'
   AND {product_id filter or product_id IS NULL}
 ORDER BY f.embedding <=> $query_vector
 LIMIT N
```

## Simulator Integration

The retrieval engine is wired into the message simulator (`simulator/services.py`). When the intent classifier routes a message to the `RAG` branch:

1. **Auto-reply check** — `_is_auto_reply_enabled(offer_id)` queries `OfferKBConfig`. If disabled, the message is marked for human escalation.
2. **Fragment retrieval** — `retrieve_fragments(query=message, product_id=offer_id)` fetches relevant KB chunks.
3. **Prompt construction** — `build_rag_prompt(fragments, user_rules)` assembles a system prompt combining:
   - DRE core/user rules (safety layer)
   - Numbered KB context fragments with source labels
   - Task instructions constraining the LLM to only use provided context
4. **LLM generation** — `generate_rag_reply()` calls GPT-4o-mini with `temperature=0.2` and a 400-token limit.

If no fragments are retrieved, the bot returns a "not enough information" message instead of hallucinating.

## API Endpoints

All endpoints are mounted under `/api/kb/` (configured in `allegrobot/urls.py`).

### Document Upload

| Method | Path                                | Description                      |
|--------|-------------------------------------|----------------------------------|
| `POST` | `/api/kb/global/upload`             | Upload a global KB document      |
| `POST` | `/api/kb/product/<offer_id>/upload` | Upload a product-specific document |

**Request**: `multipart/form-data` with a `file` field. Optional `name` field (defaults to filename).

**Response** (201):
```json
{
  "id": "uuid",
  "name": "filename.pdf",
  "offer_id": null,
  "version": 1,
  "status": "uploaded"
}
```

Processing starts asynchronously. Poll the document detail endpoint to check status.

### Document Listing

| Method | Path                                       | Description                           |
|--------|--------------------------------------------|---------------------------------------|
| `GET`  | `/api/kb/documents/`                       | List all documents                    |
| `GET`  | `/api/kb/documents/?offer_id=<id>`         | Filter by offer                       |
| `GET`  | `/api/kb/documents/?global=true`           | Global-only documents                 |
| `GET`  | `/api/kb/product/<offer_id>/documents/`    | Documents for a specific offer        |

### Document Detail & Deletion

| Method   | Path                           | Description                              |
|----------|--------------------------------|------------------------------------------|
| `GET`    | `/api/kb/documents/<doc_id>/`  | Document metadata + all fragments        |
| `DELETE` | `/api/kb/documents/<doc_id>/`  | Permanently delete document & fragments  |

### Offer Configuration

| Method | Path                              | Description                           |
|--------|-----------------------------------|---------------------------------------|
| `GET`  | `/api/kb/offers/<offer_id>/config/` | Get config (returns defaults if none exists) |
| `PUT`  | `/api/kb/offers/<offer_id>/config/` | Create or update config             |

**PUT body**:
```json
{
  "auto_reply_enabled": false,
  "offer_name": "Kurtka zimowa XL"
}
```

## Infrastructure Requirements

| Service    | Purpose                              | Docker service |
|------------|--------------------------------------|----------------|
| PostgreSQL | Document/fragment storage + pgvector | External (Supabase or local) |
| Redis      | Celery message broker                | `redis` in docker-compose |
| Celery     | Async document processing worker     | `celery` in docker-compose |
| OpenAI API | Embeddings + LLM generation          | Cloud (requires `OPENAI_API_KEY`) |

The `pgvector` extension must be enabled in your PostgreSQL database:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Environment Variables

| Variable          | Required | Description                          |
|-------------------|----------|--------------------------------------|
| `OPENAI_API_KEY`  | Yes      | Used for embedding generation and LLM calls |
| `CELERY_BROKER_URL` | Yes   | Redis URL for Celery (set in docker-compose) |
| `DATABASE_URL`    | Yes      | PostgreSQL connection with pgvector enabled |

## Running Locally

```bash
cd backend

# Start all services (web + celery + redis)
docker-compose up -d --build

# Apply migrations (including pgvector HNSW index)
docker-compose exec web python manage.py migrate

# Check Celery worker is processing
docker-compose logs -f celery
```

After uploading a document through the API or frontend, the Celery worker will:
1. Pick up the task from Redis
2. Parse, chunk, and embed the document
3. Update the document status to `ready`

If you change task code in `tasks.py`, restart the Celery worker to pick up changes:
```bash
docker-compose restart celery
```


# Provenance

Migrated from legacy path `backend/docs/rag.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
