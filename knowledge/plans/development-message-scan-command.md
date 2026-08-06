---
type: Design Plan
title: Development Message Scan Command
description: Repeatable Make and Django command workflow for immediate development scans without production cooldown changes.
resource: /plans/development-message-scan-command.md
tags: [backend, development, autoresponder, celery]
status: implemented
owner: backend
source_paths:
  - backend/Makefile
  - backend/src/autoresponder/management/commands/scan_messages_now.py
last_reviewed: 2026-07-13
timestamp: 2026-07-13
---

# Development message scan command

Immediate development scans use a Django management command as the tested source
of behavior and a Makefile as the short developer interface. Asynchronous mode
queues the existing Celery task; synchronous mode calls the same task in the
current process for direct results and easier debugging.

The command rejects production execution before resolving a user or dispatching
work. Account selection prefers an explicit `--email`, then `DEV_SCAN_EMAIL`, and
finally infers the target only when exactly one enabled auto-reply configuration
exists. This avoids hard-coding personal accounts and prevents an ambiguous scan
from targeting the wrong user.

The workflow deliberately bypasses scheduler cooldown selection without changing
plan intervals, Celery Beat frequency, or customer-facing API behavior.
