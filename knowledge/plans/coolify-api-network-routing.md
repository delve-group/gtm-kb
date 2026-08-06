---
type: Design Plan
title: Coolify API Network Routing
description: Deterministic network selection for routing production API traffic from Coolify's proxy to nginx.
resource: /plans/coolify-api-network-routing.md
tags: [backend, deployment, coolify, docker, networking]
status: implemented
owner: backend
source_paths:
  - backend/docker-compose.prod.yml
last_reviewed: 2026-07-14
timestamp: 2026-07-14
---

# Coolify API network routing

All production backend services join the external `coolify` network. This keeps
the web and Celery processes connected to the separately deployed PostgreSQL
resource and keeps Redis available through its `app-redis` network alias.

The Compose file does not create or attach an additional `default` network.
Coolify already adds its deployment network, and a third nginx address can be
selected by Traefik even though `coolify-proxy` cannot reach it. The nginx
service therefore also declares `traefik.docker.network: coolify`, making the
proxy's upstream selection deterministic across deployments.

Deployment verification checks the public `/healthz/` endpoint and confirms
that nginx has no `<project>_default` attachment. An origin timeout with healthy
nginx and web containers is treated as a proxy-network incident before
application-level debugging.
