---
type: Operations Runbook
title: Deployed Database Access
description: Safe workflow for inspecting the deployed PostgreSQL database without public exposure.
resource: /operations/deployed-database-access.md
tags: [operations, database, sensitive]
status: current
owner: project
source_paths:
  - docs/DEPLOYED_DATABASE_ACCESS.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# Superseller deployed database access

This document describes the safe development workflow for inspecting the
deployed Superseller PostgreSQL database without exposing PostgreSQL publicly.

The intended access path is:

```text
local pgweb Docker container
  -> host.docker.internal:15432
  -> local SSH tunnel
  -> Coolify server 127.0.0.1:15432
  -> localhost-only Docker forwarder
  -> Coolify internal PostgreSQL container
```

## Current Coolify database

Current deployed database details:

| Field | Value |
|---|---|
| Coolify database UUID / container name | `p12rwcamaixpeb9mwf26p7i9` |
| Docker network | `coolify` |
| PostgreSQL port inside Docker | `5432` |
| Database user | `postgres` |
| Database name | `postgres` |
| Public exposure | disabled |
| Host port mapping | none by default |

Do not commit or paste the database password into this repository.

## Backend application connection

The backend app joins the same `coolify` Docker network in
`backend/docker-compose.prod.yml`, so its `DATABASE_URL` must use the internal
database container name and port, not `localhost`, the SSH tunnel, or the
localhost-only forwarder from this runbook.

Use this shape in Coolify environment variables:

```text
DATABASE_URL=postgresql://postgres:<password>@p12rwcamaixpeb9mwf26p7i9:5432/postgres?sslmode=disable
```

If Coolify recreates the database resource with a new container name, update the
host portion of `DATABASE_URL` and this runbook together.

## Server-side forwarder

Run this on the Coolify server. It creates a persistent localhost-only TCP
forwarder from the server's `127.0.0.1:15432` to the private PostgreSQL
container on the Coolify Docker network.

```bash
docker run -d \
  --name superseller-db-forward \
  --restart unless-stopped \
  --network coolify \
  -p 127.0.0.1:15432:15432 \
  alpine/socat \
  tcp-listen:15432,fork,reuseaddr tcp-connect:p12rwcamaixpeb9mwf26p7i9:5432
```

Verify it is running:

```bash
docker ps --filter name=superseller-db-forward
```

Verify the server is listening only on localhost:

```bash
ss -ltnp | grep 15432
```

Expected shape:

```text
LISTEN ... 127.0.0.1:15432 ...
```

It should not show `0.0.0.0:15432`.

## Recreate the forwarder

If the database container name or Docker network changes, recreate the
forwarder with updated values.

```bash
docker stop superseller-db-forward
docker rm superseller-db-forward
```

Then rerun the `docker run -d ...` command from the previous section.

To re-check the database container details:

```bash
docker inspect p12rwcamaixpeb9mwf26p7i9
```

The fields that matter are:

- `Name`
- `HostConfig.NetworkMode`
- `NetworkSettings.Networks`
- `Config.ExposedPorts`

## Local SSH tunnel

Add this to `~/.ssh/config` on the developer machine. Replace `HostName` if
your SSH target is an IP address or another DNS name.

```sshconfig
Host superseller-db
  HostName ubuntu-4gb-nbg1-1
  User root
  LocalForward 15432 127.0.0.1:15432
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure yes
```

Start the tunnel:

```bash
ssh -N superseller-db
```

Keep this process running while using pgweb or another SQL client.

Optional, if `autossh` is installed locally:

```bash
autossh -M 0 -N superseller-db
```

`autossh` restarts the tunnel if the SSH connection drops.

## Local pgweb

Run pgweb locally through Docker:

```bash
docker run --rm \
  --name superseller-pgweb \
  -p 127.0.0.1:8082:8081 \
  sosedoff/pgweb:0.16.2 \
  --bind=0.0.0.0 \
  --listen=8081 \
  --url='postgres://postgres:<password>@host.docker.internal:15432/postgres?sslmode=disable'
```

Open:

```text
http://localhost:8082
```

Use the deployed PostgreSQL password in place of `<password>`.

`host.docker.internal` is required because pgweb runs inside a local Docker
container. Inside that container, `localhost` would refer to the pgweb
container itself, not the developer machine where the SSH tunnel is listening.

## Other clients

For desktop SQL clients running directly on the developer machine, use:

```text
Host: localhost
Port: 15432
User: postgres
Database: postgres
SSL mode: disable
```

For SQL clients running inside local Docker containers, use:

```text
Host: host.docker.internal
Port: 15432
User: postgres
Database: postgres
SSL mode: disable
```

## Security notes

- The Coolify database must remain non-public.
- The server-side forwarder must bind to `127.0.0.1`, not `0.0.0.0`.
- The local pgweb port should bind to `127.0.0.1`, not `0.0.0.0`.
- Prefer read-only database credentials for routine inspection if available.
- Stop pgweb when it is not needed.
- Do not store production database passwords in committed files.

## Troubleshooting

If pgweb cannot connect:

1. Confirm the server-side forwarder is running:

   ```bash
   docker ps --filter name=superseller-db-forward
   ```

2. Confirm the server is listening locally:

   ```bash
   ss -ltnp | grep 15432
   ```

3. Confirm the SSH tunnel is active locally:

   ```bash
   lsof -nP -iTCP:15432 -sTCP:LISTEN
   ```

4. Confirm pgweb uses `host.docker.internal`, not `localhost`.

5. Confirm the deployed database password is current.

If the forwarder logs are needed:

```bash
docker logs superseller-db-forward
```



# Provenance

Migrated from legacy path `docs/DEPLOYED_DATABASE_ACCESS.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
