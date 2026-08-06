---
type: Test Knowledge
title: RAG Fixture Documents
description: Tracked sample seller and product knowledge documents used for RAG testing and demos.
resource: ../../backend/test-documents/global-faq.txt
tags: [test-knowledge, rag, fixtures]
status: current
owner: project
source_paths:
  - backend/test-documents/global-faq.txt
  - backend/test-documents/product-kurtka-zimowa.txt
  - backend/test-documents/product-rower-miejski.txt
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# Fixture Inventory

These files stay in `backend/test-documents/` because they are test/demo inputs, not project governance documentation.

- [Global FAQ](../../backend/test-documents/global-faq.txt) - shop-wide return, shipping, warranty, payment, contact, and FAQ knowledge.
- [Winter Jacket Product](../../backend/test-documents/product-kurtka-zimowa.txt) - product-specific knowledge for an `Arctic Shield Pro` winter jacket.
- [City Bike Product](../../backend/test-documents/product-rower-miejski.txt) - long product-specific knowledge for a `CityRide Pro 28` city bike.

Use these as deterministic examples of the kind of seller knowledge the RAG system ingests.

# Citations

[1] [Global FAQ](../../backend/test-documents/global-faq.txt)
[2] [Winter jacket fixture](../../backend/test-documents/product-kurtka-zimowa.txt)
[3] [City bike fixture](../../backend/test-documents/product-rower-miejski.txt)
