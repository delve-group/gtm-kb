---
type: Operations
title: Cloudflare Tunnel for Local Webhooks
description: Expose the local Django backend through a temporary or stable HTTPS hostname for Mailjet and other webhook testing.
resource: /operations/cloudflare-tunnel.md
tags: [operations, cloudflare, tunnel, webhooks, local-development]
status: current
owner: project
source_paths:
  - backend/docker-compose.yml
  - backend/src/allegrobot/settings.py
last_reviewed: 2026-07-21
timestamp: 2026-07-21
---

# Cloudflare Tunnel for Local Webhooks

Cloudflare Tunnel lets an external provider call the local Django backend
without opening an inbound router or firewall port. Use a quick tunnel for
short-lived testing. Use a named, remotely managed tunnel only when a stable
development hostname is worth maintaining. Production uses the deployed API
hostname and does not depend on a developer's tunnel.

## Quick tunnel

1. From `allegro-message-bot/backend`, start the webhook consumers and verify
   Django locally:

   ```bash
   docker compose up -d web celery celery-beat
   curl --fail http://localhost:8000/healthz/
   ```

2. Install `cloudflared` on macOS and start a temporary tunnel:

   ```bash
   brew install cloudflared
   cloudflared tunnel --url http://localhost:8000
   ```

3. Copy the generated `https://<random>.trycloudflare.com` URL. Keep the
   `cloudflared` process running. The hostname changes whenever a new quick
   tunnel starts.
4. Add only the hostname, without `https://`, to `ALLOWED_HOSTS` in
   `backend/.env`:

   ```dotenv
   ALLOWED_HOSTS=localhost,127.0.0.1,<random>.trycloudflare.com
   ```

5. Recreate Django because Compose environment changes are not hot-reloaded:

   ```bash
   docker compose up -d --force-recreate web
   curl --fail https://<random>.trycloudflare.com/healthz/
   ```

6. For the Anymail Mailjet webhook, split the single local
   `ANYMAIL_WEBHOOK_SECRET=username:password` value into URL credentials and
   configure this endpoint for every selected trigger:

   ```text
   https://username:password@<random>.trycloudflare.com/anymail/mailjet/tracking/
   ```

   Use a URL-safe generated password, keep exactly one definition of the
   variable in `.env`, and enable Mailjet's **Group events** option. Never
   commit the tunnel credentials.

## Stable development hostname

Use a named tunnel when repeatedly updating Mailjet with a random quick-tunnel
hostname becomes disruptive:

1. In Cloudflare, open **Networking > Tunnels** and create a remotely managed
   tunnel.
2. Add a **Published application** route such as
   `webhooks-dev.superseller.pl` with service URL
   `http://localhost:8000`.
3. Install and run the connector using the command or token Cloudflare shows.
   Treat the tunnel token as a secret and do not store it in the repository.
4. Add `webhooks-dev.superseller.pl` to local `ALLOWED_HOSTS`, recreate `web`,
   and use the stable hostname in the Mailjet endpoint URL.

The tunnel must be running on the development machine for the stable hostname
to reach localhost. Cloudflare recommends remotely managed tunnels for this
maintained setup; locally managed configuration files are reserved for cases
that specifically need local ingress configuration.

## Verification and troubleshooting

- A public `/healthz/` response proves Cloudflare can reach Django, but does
  not prove webhook authentication.
- Mailjet's **Send a test** must return HTTP `200` to prove reachability and
  Basic Auth. Its synthetic event does not carry Superseller's delivery
  metadata, so it does not update a delivery row.
- `AnymailWebhookValidationFailure` means the request reached Django but the
  Basic Auth credentials did not match the running container. Keep exactly one
  `ANYMAIL_WEBHOOK_SECRET` entry and recreate `web` after changing it.
- `DisallowedHost` means the tunnel hostname is missing from `ALLOWED_HOSTS`.
- A Cloudflare origin error means `cloudflared` cannot reach
  `http://localhost:8000`; verify the web container and keep the tunnel process
  running.

# Citations

- [Cloudflare Tunnel setup and quick tunnels](https://developers.cloudflare.com/tunnel/setup/)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/routing/)

