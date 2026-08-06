---
type: Evaluation Suite
title: PII Scrubber Evals
description: PII scrubber evaluation workflow and Polish metrics explanation.
resource: /evals/pii-scrubber-evals.md
tags: [evals, pii, privacy]
status: current
owner: project
source_paths:
  - backend/src/pii_scrubber/evals/README.md
  - backend/src/pii_scrubber/evals/HOW_METRICS_WORK.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# PII Scrubber Evaluation Suite

This directory contains deterministic, metrics-driven evaluations for the PII (Personally Identifiable Information) scrubber. The suite measures:
- **Leakage (Recall / False Negatives)**: Crucial metric. Ensures no PII remains in the output text.
- **Over-redaction (Precision / False Positives)**: Ensures non-PII text is left intact and not overzealously scrubbed.

## How Evaluations are Calculated and Resolved

The evaluation logic operates without any LLM assistance to ensure 100% determinism. For each test case defined in the dataset:
1. **Scrubbing**: The input text is passed through the `PIIScrubber.scrub_text()` method.
2. **Span Validation**: The script checks every span defined in `expected_spans`:
   - If `should_scrub` is `True`, it acts as a True Positive (TP) if the exact literal text is no longer in the output, AND *any* valid categorical token (e.g., `<EMAIL>`, `<PESEL>`) is present. This is called **Flexible Token Masking**, ensuring overall data safety is prioritized above strict tagging. If the string wasn't wiped or no token replaced it, it's a False Negative (FN). If a token replaced it but it wasn't the expected categorical token, it is logged as a "Categorization Mismatch" internally, but still counts as a TP.
   - If `should_scrub` is `False`, it checks that the literal text is STILL in the output. If it is inadvertently removed, it's counted as a False Positive (FP), indicating over-redaction.
3. **Hard Leakage Detection**: Regardless of spans, the final output is scanned with conservative regex patterns for Email, Phone, PESEL, and IBAN. Any matches instantly trigger a "Hard Leakage" failure for that case.
4. **Metrics Resolution**:
   - **Recall**: `TP / (TP + FN)`. This illustrates how much required PII was successfully scrubbed.
   - **Precision Proxy**: `TP / (TP + FP)`. This provides a proxy for how often the scrubber over-redacts non-PII text. 
   - **Exit Criteria**: The script resolves with a successful `0` exit code ONLY if there are no hard leakage failures AND the recall meets strict thresholds (1.00 for critical PII like EMAIL/PHONE/PESEL/IBAN, and 0.95 for others). Precision proxies and Mismatches are tracked but do not cause failures.

## How to Run Locally

You should run the script from the `backend` directory using `uv`:

```bash
cd backend
uv run python src/pii_scrubber/evals/evaluate_scrubber.py
```

The script will output detailed results per test case, metrics by category, and will exit with `0` on success, or `1` on failure.

## CI Integration

The script is CI-friendly. To integrate it into a CI pipeline:
1. Ensure the Python environment is set up (via `uv` or standard virtual environment).
2. Execute the evaluation script just like in the local run.
3. The script returns exit code `1` if:
   - Any un-scrubbed PII (Email, Phone, PESEL, IBAN) triggers the "Hard Leakage" detectors.
   - PII Recall drops below the strict thresholds (`1.00` for Critical PII like PHONE, EMAIL, PESEL, IBAN, and `0.95` for others).

Example CI step:
```yaml
- name: Run PII Scrubber Evaluations
  run: uv run python backend/src/pii_scrubber/evals/evaluate_scrubber.py
```

## Adding New Test Cases

The evaluation dataset is located in `pii_golden_cases.json`. To add new cases, insert a new JSON object into the array.

### Schema
```json
{
  "id": <UNIQUE_INTEGER>,
  "input": "<ORIGINAL_TEXT>",
  "expected_spans": [
    {
      "type": "<CATEGORY>",
      "text": "<LITERAL_SUBSTRING_FROM_INPUT>",
      "should_scrub": <BOOLEAN>
    }
  ]
}
```

### Supported Categories
`PERSON`, `ADDRESS`, `POSTAL_CODE`, `SHIPMENT_NUMBER`, `EMAIL`, `PHONE`, `PESEL`, `IBAN`, `URL`, `HANDLE`

### Examples
**Positive Case (Must be scrubbed):**
```json
{
  "id": 101,
  "input": "Write to jan.kowalski@example.com",
  "expected_spans": [
    {"type": "EMAIL", "text": "jan.kowalski@example.com", "should_scrub": true}
  ]
}
```

**Negative Case (Must NOT be scrubbed to prevent over-redaction):**
```json
{
  "id": 102,
  "input": "I bought apples for 5 zł",
  "expected_spans": [
    {"type": "PHONE", "text": "5 zł", "should_scrub": false}
  ]
}
```
*Note: The type in a negative case represents the category you are ensuring does NOT trigger false positives on this span.*

## Synthetic Data Generation Architecture (Generator -> Judge)

To expand the evaluation dataset with robust synthetic examples, we use a two-agent architecture implemented in `backend/scripts/generate_synthetic_evals.py` and `backend/src/pii_scrubber/evals/synthetic/judge.py`.

1. **Generator**: Uses a base LLM (e.g. `gpt-4o`) to generate batches of test cases covering various tricky PII scenarios and edge cases.
2. **Judge**: Acts as a supervisor using the `gpt-5-mini-2025-08-07` model to parse and validate the logical consistency of each generated test case.
   - For example, the Judge ensures an email address is not incorrectly designated as a `PERSON` category.
   - If the Judge detects hallucinated or mislabeled structures, those specific cases are rejected.
   - The generator then actively regenerates replacements for the rejected cases, repeating the Judge validation loop until the batch achieves 100% structural correctness.

**Trade-offs**: This multi-agent validation loop inherently slows down the overall process of building the structured Golden Cases. However, this strict level of supervision is necessary. Without it, hallucinated or incorrect labels in the synthetic dataset would cause incorrect False Negatives (FN) during evaluation, misrepresenting the actual accuracy of the PII Scrubber.


# PII Scrubber Metrics Explained (TP, FN, FP)

PII scrubber evaluation uses three core concepts: **True Positive (TP)**,
**False Negative (FN)**, and **False Positive (FP)**.

Each JSON test case contains visible input text (`input`) and a list of
expected spans (`expected_spans`). Depending on `"should_scrub": true/false`,
the scrubber must either mask the data or leave it intact.

The following examples explain the metrics.

---

## 1. True Positive (TP) — correct redaction

**Definition:** The scrubber correctly detects and masks sensitive data (PII),
replacing it with an appropriate token such as `<PESEL>` or `<EMAIL>`.

**Rule:**
- `should_scrub: true`
- The sensitive data disappears from the result.
- A token from the correct category appears in its place.

**Example:**
* **Input:** `"My email address is jan.kowalski@example.com."`
* **Expected span:** `{"type": "EMAIL", "text": "jan.kowalski@example.com", "should_scrub": true}`
* **Scrubber output:** `"My email address is <EMAIL>."`
* **System result:** `TP +1` for the `EMAIL` category.

---

## 2. False Negative (FN) — data leakage

**Definition:** The scrubber misses sensitive data. It should have been masked
but escapes unchanged, potentially exposing real PII to an LLM.

**Rule:**
- `should_scrub: true`
- The literal text that should disappear is still in the output, or no token
  replaced it.

**Example 1 (the scrubber does nothing):**
* **Input:** `"My PESEL is 99010112345."`
* **Expected:** `{"type": "PESEL", "text": "99010112345", "should_scrub": true}`
* **Scrubber output:** `"My PESEL is 99010112345."`
* **System result:** `FN +1` for `PESEL`; the hard-leakage detector raises a
  fatal failure (exit 1).

**Example 2 (redacted but misclassified — flexible masking):**
* **Input:** `"The order number is 12345678901"`
* **Expected:** `{"type": "SHIPMENT_NUMBER", "text": "12345678901", "should_scrub": true}`
* **Scrubber output:** `"The order number is <PESEL>"`
* **System result:** Ordinarily this would be an FN for `SHIPMENT`, but data
  safety takes priority: the original value disappeared and was replaced by a
  valid PII token. It counts as a TP, while the category error is recorded as a
  mismatch for debugging (`--show-mismatch`).

---

## 3. False Positive (FP) — over-redaction

**Definition:** The scrubber masks something that is not PII and should remain
visible, damaging valid user or LLM context such as a price or ordinary word.

**Rule:**
- `should_scrub: false`
- Literal text that should remain disappears and a token takes its place.

**Example:**
* **Input:** `"This computer costs 55030101230 zł."`
* **Expected (negative over-redaction test):** `{"type": "NRB_PRICE_CONTEXT", "text": "55030101230", "should_scrub": false}`
* **Scrubber output:** `"This computer costs <PESEL> zł."`
* **System result:** `FP +1` for `NRB_PRICE_CONTEXT`. The number has a valid
  PESEL checksum, but price context should protect it. The scrubber incorrectly
  removed an innocent number.

---

## Summary and formulas

At the end of a run, the evaluator calculates Recall and Precision Proxy:

* **Recall (leakage detection):** `TP / (TP + FN)`
  - How much real PII (`TP + FN`) was successfully protected (`TP`)?
  - Recall below 1.0 for PESEL, IBAN, email, or phone means sensitive data can
    escape and is a serious defect.

* **Precision (context accuracy):** `TP / (TP + FP)`
  - Of everything the scrubber masks, how much should actually be masked?
  - Low precision means harmless numeric strings, proper nouns, or shipment
    identifiers are unexpectedly replaced with `<PII>`, harming readability.


# Provenance

[1] legacy path `backend/src/pii_scrubber/evals/README.md`

[2] legacy path `backend/src/pii_scrubber/evals/HOW_METRICS_WORK.md`
