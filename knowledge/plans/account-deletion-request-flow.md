# Account Deletion Request Flow

Status: implemented
Date: 2026-07-15  
Owners: backend, Expo app, landing site, operations

## Objective

Let a Superseller account owner request deletion from every required surface:

* Expo web, Android, and iOS expose a prominent `Delete account` action in Settings.
* `https://superseller.pl/delete-account` works without installing or signing in to the app.
* A request is accepted only after the owner confirms it through the email address attached to the account.
* The administrator receives the actionable deletion email only after successful verification.
* A privileged, auditable fulfillment path removes the account and associated data, handles external services, and tells the user when deletion is complete.

Google Play requires an in-app deletion path and a functional public web resource when an app supports account creation. Apple also requires deletion to be initiated in the app and permits a direct link to the exact web page that completes the process. A manual process is acceptable only when its timing and completion are communicated and it is not made unnecessarily difficult.

Policy references:

* <https://support.google.com/googleplay/android-developer/answer/13327111>
* <https://developer.apple.com/support/offering-account-deletion-in-your-app/>

This plan is an implementation design, not legal advice. Exact statutory and financial retention periods must be approved before the public policy copy is finalized.

## Chosen design

Use a verified manual-request workflow.

1. The shared Expo Settings page shows a destructive `Delete account` row on web, Android, and iOS.
2. The action explains that deletion is permanent and opens the exact public resource, `https://superseller.pl/delete-account`, in the browser. It must not point at the landing home page or a generic contact section.
3. The public page collects only the account email and an optional message. It explains what will be deleted, what may be retained, what happens to an active subscription, and the expected fulfillment time.
4. The landing server validates the form and proxies it to Django. Django always returns a generic accepted response so the endpoint cannot reveal whether an account exists.
5. For a matching account, Django creates or replaces a pending request and emails a short-lived, one-time confirmation link to that account email.
6. The confirmation page consumes the token with a POST. Only after that succeeds does Django mark the request verified and email the administrator with the request ID and a link to its Django admin page.
7. A superuser confirms fulfillment in Django admin. The backend queues an idempotent deletion task, cancels provider access/billing, deletes account-owned files and database rows, records a minimal completion tombstone, and sends the user a completion email.

Do not reuse the current landing contact endpoint for this workflow. It sends mail directly to an administrator and has no account lookup, token lifecycle, request status, or safe fulfillment path. The landing page should be a presentation and proxy layer; Django remains the source of truth.

## Request state and persistence

Add `AccountDeletionRequest` to `backend/src/authentication/models.py` with a migration. Suggested fields:

* UUID primary key.
* Nullable `user` foreign key using `SET_NULL`, so the request survives account deletion.
* Normalized `email`, plus an HMAC email fingerprint used for deduplication and the final tombstone.
* Optional bounded `message` and `source` (`landing`, `app_settings`, or `web_settings`). Do not accept arbitrary source values.
* Hashed confirmation token; never store or log the raw token.
* Status: `pending_verification`, `verified`, `processing`, `completed`, `failed`, `expired`, or `cancelled`.
* `requested_at`, `expires_at`, `confirmed_at`, `admin_notified_at`, `processing_started_at`, `completed_at`, and a bounded operational failure code.

Allow at most one live request per account. A new request invalidates the previous token and creates a fresh expiry. After completion, clear the raw email, optional message, token digest, and failure detail; retain only the request UUID, email fingerprint, timestamps, and outcome for the approved audit period.

Recommended defaults are a 24-hour confirmation token and a clearly published fulfillment target of seven calendar days. Both must be configurable, and the public copy must match production configuration.

## Backend API and email verification

Implement the flow in the existing authentication domain:

* `POST /api/auth/account-deletion-requests/` accepts normalized email, optional
  message and source, plus optional `language: "pl" | "en"` defaulting to
  Polish. The landing proxy authenticates with a dedicated server-side shared
  secret. Apply IP and email-identifier throttles in Django even though the
  landing route also rate-limits requests.
* Return the same `202 {"status":"confirmation_sent_if_account_exists"}` for existing accounts, unknown emails, inactive accounts, and duplicates. Do not send mail to an address that is not attached to an account.
* `POST /api/auth/account-deletion-requests/confirm/` accepts the raw one-time token. Hash it before lookup, reject expired or already replaced tokens, and make a repeated successful confirmation idempotent.
* Confirmation changes the state to `verified` transactionally, then schedules the administrator email with `transaction.on_commit` and Celery.

The confirmation link should target `https://superseller.pl/delete-account/confirm?token=...`. The confirmation page must not mutate state on GET because mail security scanners may follow links. It should POST the token through a landing API proxy, remove it from browser history immediately, use `Referrer-Policy: no-referrer`, and contain no third-party embeds.

Add backend settings for the public landing URL, request-proxy secret, token lifetime, administrator recipient, and fulfillment target. Use the existing Django/Mailjet email delivery rather than adding a second mail provider. Email tasks must be retryable and must log request IDs, not addresses or tokens.

## Landing-site changes

Implement these changes in `allegro-customer-agent-landing`:

* Add `app/(landing)/delete-account/page.tsx` with Superseller branding, process explanation, retention/billing notice, expected timing, and an accessible form.
* Add a focused client form component. Required field: account email. Optional field: deletion message. Do not collect name, phone, password, or marketing consent.
* Add `app/api/account-deletion/route.ts` as a validated, time-limited proxy to Django. Use `ACCOUNT_DELETION_BACKEND_URL` and `ACCOUNT_DELETION_REQUEST_SECRET`; neither is public or embedded in the browser bundle.
* Add `app/(landing)/delete-account/confirm/page.tsx` and `app/api/account-deletion/confirm/route.ts` for one-time confirmation.
* Show a generic success state after submission: if the address belongs to an account, a confirmation email will arrive. This prevents account enumeration.
* Add honeypot and per-IP rate limiting at the edge or reverse proxy. Django throttling remains the second layer.
* Link `Delete account` prominently in the footer and in the account-deletion section of the privacy policy.
* Add `/delete-account` to `app/sitemap.ts`. Exclude the confirmation page from the sitemap and disallow it in `app/robots.ts`.
* Document the new runtime variables in `.env.example`, `README.md`, Docker examples, and Coolify setup.

The landing route must not send the administrator email itself. Its success only means the verification step was initiated. Django sends the administrator email after confirmation.

## Expo web and mobile Settings

The Expo app already shares `features/settings/SettingsView.tsx` across web and native, so one component can cover all three platforms:

* Add `features/settings/components/AccountDeletionSettings.tsx` under `settings.group.account`, visually separated from billing and Allegro integration as a danger-zone action.
* First show an explanatory confirmation dialog. The final button opens the exact deletion page with the existing safe URL-opening utility.
* Configure `EXPO_PUBLIC_ACCOUNT_DELETION_URL`, with the production value `https://superseller.pl/delete-account`. Validate that it is HTTPS in production and do not pass the user's email in the URL.
* Add Polish and English strings for the title, permanent-deletion warning, provider/subscription notice, external-browser handoff, action, and URL-open error.
* Ensure keyboard, screen-reader, tablet, web, Android, and iOS behavior is accessible. The action must remain prominent and cannot be hidden behind a support article.
* Document the environment variable in `frontend/env.example` and `frontend/README.md`.

No new frontend API domain is needed because Settings opens the public flow. This keeps app and no-longer-installed users on the same verification path.

## Administrator fulfillment and actual deletion

Register requests in Django admin with filters for status and age. Only superusers may process a verified request. The request detail page must show a destructive confirmation screen, the account email, subscription state, request age, and the categories scheduled for deletion. The admin email links to this page by request UUID; it must never contain a raw confirmation token.

The admin action queues one idempotent Celery task backed by a single account-deletion service. The service should:

1. Lock the request and user rows, require `verified` or retryable `failed`, set `processing`, and immediately deactivate the Django user.
2. Revoke all refresh sessions/outstanding JWTs and prevent new access tokens.
3. Cancel any active Stripe subscription immediately. Do not delete financial records Stripe or the operator is legally required to retain; remove or anonymize non-required customer metadata and describe retained billing data in the privacy policy.
4. Disconnect Allegro access, delete encrypted OAuth tokens, and remove the account connection so its unique assignment is released.
5. Capture and explicitly delete `GlobalKBDocument.file` and `AuditExportJob.file` objects from storage. Django cascade deletion alone does not remove stored files.
6. Remove or anonymize account-associated waitlist/referral data that uses `SET_NULL` and would otherwise retain email, name, phone, Stripe identifiers, or conversion history.
7. Delete the Django user inside a transaction so normal `CASCADE` relations remove messages, snapshots, rules, configurations, notifications, feedback, onboarding, RAG fragments, simulations, post-buy data, local audit data, and allauth email records.
8. Request deletion from processors where Superseller can address the user: Mailjet contacts, observability traces, and any external feedback destinations. Record non-deletable legally retained categories in an operations checklist rather than silently claiming they were deleted.
9. Mark the request complete and scrub its PII after attempting the completion email. Delivery is tracked independently without retaining the recipient address. A completion-email failure alerts operations but does not misreport the already-completed account deletion as failed. Other external cleanup failures preserve a non-PII failure code and leave the request retryable.

Before coding the service, produce a model-by-model retention matrix for every user relation and every external processor. Each row must say `delete`, `anonymize`, `retain with legal basis and duration`, or `not associated`. This is a release gate.

## Error handling and abuse controls

* Unknown account: generic accepted response; no user or admin email.
* Invalid form: field-level validation without echoing sensitive values into logs.
* Expired token: safe page explaining how to submit a new request.
* Replayed token: idempotent verified response when it belongs to the current request; otherwise invalid.
* Administrator email failure: keep the request verified, retry delivery, and make it visible in an overdue admin filter.
* Mailjet acceptance is not delivery: persist the provider message ID, consume authenticated `sent`, `blocked`, `bounce`, and `spam` events, reconcile stale accepted messages, and send one PII-free Telegram alert for failed or unknown state.
* Stripe/provider failure: do not mark deletion completed. Retry idempotently and surface only a stable failure code.
* Concurrent fulfillment: database locking permits one worker; later attempts return the existing state.
* Legal hold: do not silently reject deletion. Record the approved retention basis and duration, delete everything outside the hold, and communicate the limited retention to the user.

## Test plan

Backend work follows the repository's PostgreSQL-backed TDD rule and mocks Mailjet, Stripe, Allegro, storage, and other external boundaries.

Backend coverage:

* Existing, unknown, inactive, unverified-registration, duplicate, and mixed-case email requests all return the non-enumerating contract.
* IP and identifier throttles work and raw email/token values are absent from logs.
* Token hashing, expiry, replacement, replay, and concurrent confirmation are correct.
* The administrator is notified only after verification.
* Non-superusers and unverified requests cannot start fulfillment.
* Fulfillment is idempotent, revokes sessions, cancels billing, releases Allegro assignment, deletes stored files, handles `SET_NULL` records, and deletes all expected user relations.
* Each external failure remains retryable and never produces a false completion.
* Completion scrubs request PII after one completion-email submission; provider delivery failure is tracked and alerted independently without restoring deleted PII.

Landing coverage:

* Client and server validation, generic success copy, proxy timeout/error mapping, secret handling, confirmation POST, token removal, metadata, sitemap, robots, and accessible labels.
* Production build contains no proxy secret and no raw API error or account-existence signal.

Expo coverage:

* The action renders on web, Android, iOS, phone, and tablet layouts; the dialog is accessible; cancel is safe; confirm opens only the configured HTTPS deletion URL; URL failures show translated feedback.

End-to-end acceptance test:

1. Submit `https://superseller.pl/delete-account` without being signed in.
2. Confirm no administrator email is sent yet.
3. Use the account-owner email link and confirm the administrator receives one request.
4. Fulfill it from Django admin.
5. Confirm app sessions stop working, Stripe is not left billing, Allegro credentials and stored files are gone, the user cannot log in, and a completion email arrives.

Run the existing backend suite plus frontend and landing `lint`, `typecheck`, and production `build` gates. Add a focused test runner to the landing repository if it still has no test harness when implementation starts.

## Delivery sequence

1. Approve the retention matrix, billing behavior, processor deletion capabilities, public wording, and administrator SLA.
2. Add the Django model, migration, throttles, service layer, public request/confirmation endpoints, email tasks, admin workflow, and tests.
3. Deploy the backend schema and endpoints before exposing either client.
4. Add the landing request and confirmation pages, proxies, legal/footer links, configuration, and tests; deploy and exercise the public URL anonymously.
5. Add the shared Expo Settings danger-zone action and translations; verify Expo web, Android, iPhone, and iPad.
6. Run the end-to-end deletion test against a disposable production-like account with an active test subscription and uploaded files.
7. Update the privacy policy with exact deletion, retention, processor, contact, and completion-time statements.
8. Enter `https://superseller.pl/delete-account` in Google Play Console, answer the deletion questions only after the flow is live, and include the Settings path in Apple review notes.
9. Monitor pending/verified/failed request counts and alert on requests nearing the published deadline.

## Definition of done

* A signed-out user can submit a deletion request from the public URL without reinstalling the app.
* Expo web, Android, and iOS Settings link directly to that public URL through an easy-to-find destructive action.
* Email ownership is verified with a hashed, expiring, one-time token before the administrator is notified.
* Unknown emails and duplicate requests do not disclose account existence.
* A superuser can fulfill a verified request through one auditable, retryable workflow.
* Account-owned database records, stored files, sessions, provider access, and non-required processor copies are deleted; legally retained data is minimized and disclosed.
* Active billing cannot continue unnoticed after fulfillment.
* The user receives clear request, confirmation, timing, billing, retention, and completion communication.
* Store-console declarations and privacy-policy claims match the deployed behavior.

## Implementation note

Implemented on 2026-07-15 across the Django authentication domain, shared Expo
Settings surface, and `allegro-customer-agent-landing`. Updated on 2026-07-25
to use separate Polish and English owner-verification and completion templates,
plus one Polish administrator-request template. The request persists `pl` or
`en` so its completion email retains the original language. Deployment
configuration and an end-to-end production-like smoke test remain operational
rollout steps.
