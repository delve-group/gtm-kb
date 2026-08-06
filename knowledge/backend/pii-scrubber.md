---
type: Backend Module
title: PII Scrubber Module
description: PII anonymization and compliance gateway architecture.
resource: /backend/pii-scrubber.md
tags: [backend, privacy, pii]
status: current
owner: project
source_paths:
  - backend/docs/pii_scrubber.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# PII Scrubber Module

The **PII Scrubber** module (`backend/src/pii_scrubber/`) is a comprehensive data anonymization and compliance gateway for the Allegro customer-support bot. Its main purpose is to prevent Personally Identifiable Information (PII) from leaking to external LLM providers.

It employs a highly sophisticated **3-pass architecture** to ensure maximum privacy retention with fallback patching mechanisms, alongside a dedicated **compliance gateway** for detection-only workflows.

## Architecture

The module is divided into the following key components:

### 1. PIIScrubber (The Anonymizer)
Located in `scrubber.py`, the `PIIScrubber` orchestrates a 3-pass pipeline to anonymize text:

- **Pass 1: Regex (`regex_patterns.py`)**: Uses context-aware regular expressions to target structured PII like phone numbers, emails, order numbers, tracking IDs, PESEL, and IBAN/NRB. It features context-validation (e.g., verifying PESEL/IBAN checksums and ignoring monetary values that look like PII).
- **Pass 2: NLP NER (`nlp_processor.py`)**: Uses the Polish spaCy model (`pl_core_news_sm`) to detect unstructured PII such as Person Names (`<IMIE_NAZWISKO>`) and Addresses/Locations (`<ADRES>`). It skips entities that regex has already caught.
- **Pass 3: Bielik GDPR Auditor (`bielik_auditor.py`)**: Acts as a safety net. It passes the original and scrubbed texts to a local, on-premise LLM (`SpeakLeash/bielik-4.5b-v3.0-instruct` via Ollama). If Bielik detects any remaining leaks, a 3-layer patching mechanism intercepts the text:
  1. Deterministic substring replacement.
  2. Index-based fuzzy matching.
  3. "Nuclear" full-rescrub by the local LLM.

**Usage:**
```python
from pii_scrubber import PIIScrubber

scrubber = PIIScrubber()
clean_text = scrubber.scrub_text("My name is Jan Kowalski; my PESEL is 12345678901.")
```

### 2. AICompliance (The Gateway)
Located in `compliance.py`, `AICompliance` provides a *detection-only* workflow. It does not alter the input string but instead returns a `ComplianceVerdict` with findings indicating if the text is safe to send externally.

It features two strictness modes:
- `CheckMode.STANDARD`: Fast scanning using Regex and spaCy (~15ms).
- `CheckMode.STRICT`: Deep scanning using Regex, spaCy, and the local Bielik model (~5s).

**Usage:**
```python
from pii_scrubber import AICompliance, CheckMode

compliance = AICompliance()
verdict = compliance.check("My email is test@example.com", mode=CheckMode.STRICT)

if verdict.safe:
    # Send to external LLM safely
    pass
else:
    # Handle the detected PII findings in verdict.findings
    print(f"Detected PII types: {[f.type for f in verdict.findings]}")
```

## Evaluation Suite

The module is thoroughly tested using an extensive evaluation suite located in `backend/src/pii_scrubber/evals/`. It balances precision and recall by tracking metrics such as False Positives and False Negatives.

To run the main evaluation script:
```bash
# From the backend/ directory, with activated virtual environment
PYTHONPATH=src python3 src/pii_scrubber/evals/evaluate_scrubber.py
```
*(For detailed metrics documentation, see `HOW_METRICS_WORK.md` and `README.md` inside the `evals/` directory).*


# Provenance

Migrated from legacy path `backend/docs/pii_scrubber.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
