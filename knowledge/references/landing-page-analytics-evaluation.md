---
type: Reference
title: Landing-page analytics platform evaluation
description: Primary-source comparison of free, low-impact visitor analytics options for the Superseller landing page.
resource: /references/landing-page-analytics-evaluation.md
tags: [landing, analytics, privacy, performance, posthog, cloudflare, umami]
status: current
owner: landing-repo
source_paths:
  - ../superseller-landing-page/README.md
last_reviewed: 2026-08-02
timestamp: 2026-08-02
---

# Landing-page analytics platform evaluation

## Recommendation

Use **Cloudflare Web Analytics** if the immediate requirement is literally visit
analytics: pageviews, visits, paths, referrers, geography/device/browser, and Core
Web Vitals. It is hosted, explicitly free, requires only an account and beacon,
uses no cookies or local storage, and its current production beacon measured about
11.4 KB transferred with gzip on 2026-08-02. It is the lowest-complexity and
lowest-client-cost verified option in this comparison. Its decisive limitation is
that it supports neither UTM parameters nor custom events, so it cannot answer
which campaign or CTA produced a signup.[1][2][3]

If Superseller needs **UTM attribution and CTA/form conversion events now**, choose
**Umami Cloud Hobby**, subject to verifying the current Hobby event allowance in
the account UI before implementation. Umami's official documentation says Hobby
is completely free, the tracker is under 2 KB, and the product supports UTMs,
custom events, goals, funnels, journeys, and full data export. Its official public
pricing page is client-rendered and did not expose the precise Hobby quota or
retention to the research tooling, so those two limits should not be assumed.[4][5]

Do **not** choose PostHog merely to count landing-page visits. Its free allowance
and future product-analytics path are excellent, but its current base JavaScript
is materially larger and its default persistence/privacy surface is broader. Pick
PostHog instead when the intended scope already includes funnels, experiments,
session replay, or joining anonymous landing activity to identified in-app users.

## Current fit for Superseller

The adjacent landing app is a Next.js 16 application deployed with Docker through
Coolify, not a Vercel-hosted site. No existing analytics dependency or confirmed
Cloudflare proxy dependency was found in its documented setup. Cloudflare Web
Analytics does not require moving DNS or using Cloudflare's proxy, so a manual
beacon remains available in this topology.[1][6]

| Option | Genuinely free route | Client impact | Visits, referrer, UTM, events | Retention / portability | Operational burden | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Cloudflare Web Analytics** | Hosted product is explicitly free; no traffic allowance is stated in the cited Web Analytics docs | Current beacon measured 11,364 bytes gzip / 31,612 bytes decoded; reports after page load and on leave, plus SPA route changes | Visits/pageviews, paths, referrer, country/device/browser and RUM; **no UTM or custom events** | Dashboard exposes six months; unsampled beacon data is kept seven days then aggregated/sampled for longer storage; aggregate GraphQL API, no free raw export | One account and snippet; automatic injection only if proxied by Cloudflare | **Best now for basic visit data** |
| **Umami Cloud / self-hosted** | Cloud Hobby is explicitly free, but exact quota/retention could not be verified from a renderable official pricing source; MIT-licensed self-hosting is free software | Official docs say tracker is **under 2 KB** | Pageviews, visitors, referrers, UTMs, events, goals, funnels, journeys, attribution and Core Web Vitals | Cloud FAQ says all data can be exported; open source reduces exit risk | Cloud is managed; self-hosting requires an app plus PostgreSQL, upgrades, backups and monitoring | **Best lightweight free candidate for campaigns/conversions**, after quota check |
| **PostHog Cloud** | No-card free plan: one project, one-year retention, **1M analytics events/month**; usage is capped at the free limit | Current `array.js` measured 75,662 bytes gzip / 235,959 decoded; official loader is asynchronous and additional replay/survey code is lazy-loaded | Full web/product analytics: pageviews, referrers, UTMs, custom events, actions, goals, funnels and more | API included; batch-export free allowance; open-source core, but PostHog describes self-hosting as complex | More configuration and privacy controls; reverse proxy may be needed to reduce blocker loss | **Best only if product analytics scope is imminent** |
| **Plausible Cloud / Community Edition** | Cloud is only a 30-day trial, therefore it fails the permanent-free requirement; Community Edition is self-hostable | Official site states **2.5 KB gzip** | Referrers, UTMs and custom goals/events are supported | Cloud raw-event exports are Enterprise-only; source-available/self-host route reduces lock-in | Managed Cloud costs money; Community Edition adds database, upgrades, backups and monitoring | Excellent simple paid option, not the best free option |

Transfer sizes above are point-in-time observations from the vendors' official
production CDN assets on 2026-08-02 and can change without notice. They compare
network bytes, not main-thread execution or extra requests. `async`, `defer`, or a
small script reduces blocking risk but does not prove zero performance impact; the
selected implementation should be checked against the production site's own Core
Web Vitals after release, without enabling replay or other unused modules.

## Privacy and consent in Poland / the EU

Cookie-free is preferable but is **not by itself a legal guarantee that consent is
unnecessary**. Poland's binding Electronic Communications Law, Article 399,
requires prior information and consent for storing information in, or accessing
information already stored in, terminal equipment, except where necessary for a
transmission or a service requested by the user. The EDPB's final Guidelines
2/2023 explain that Article 5(3) can also reach non-cookie techniques, including
JavaScript-instructed access to device information and, depending on origin, IP-
based tracking. Whether an analytics implementation falls under an exemption is a
case-specific legal assessment.[7][8]

The technical privacy differences are still meaningful:

- **Cloudflare** says Web Analytics uses no cookies or local storage, does not
  fingerprint individuals, and does not collect or use visitors' personal data.
  This is the narrowest data design in the comparison.[1][3]
- **Umami** says it uses no cookies, fingerprinting, or personal data. Its session
  documentation nevertheless explains that a session is represented by a hash of
  IP address, user agent, and website ID; the IP is used for location but not
  stored. EU and US Cloud regions are available.[4][9]
- **Plausible** uses no cookies/local storage and creates a daily identifier from a
  rotating salt, site domain, IP and user agent; raw IP and user agent are not
  stored. Its managed visitor data is processed and stored in the EU.[10]
- **PostHog's default** browser persistence uses local storage plus cookies. It can
  instead be configured with `cookieless_mode: "always"`, which stores no PostHog
  data in cookies or local/session storage and disables identification. EU Cloud
  is available and EU projects default IP capture off. PostHog itself cautions
  that cookieless mode does not replace configuring collection and storage for the
  applicable law.[11]

Whichever product is selected, update the privacy notice, execute/review the
vendor DPA and subprocessor/transfer terms, avoid sending form contents, email,
phone, or other identifiers, and have the consent position reviewed for the exact
configuration. This note is product/technical research, not legal advice.

## Practical decision rule

1. Start with Cloudflare Web Analytics if the question is "how many people visit,
   from where, and is the page fast?"
2. Start with Umami Cloud Hobby if the question includes "which UTM campaign or
   CTA produces a lead?" Verify Hobby quota/retention first.
3. Use PostHog only when Superseller deliberately wants the landing page to be the
   first surface in a broader product-analytics system. Configure EU Cloud,
   cookieless anonymous capture, IP discard, no autocapture/replay, an event
   allowlist, and billing caps.
4. Reconsider paid Plausible when a simple EU-hosted managed product is worth a
   subscription and permanent-free is no longer mandatory.

## Primary sources

[1] [Cloudflare Web Analytics overview](https://developers.cloudflare.com/web-analytics/about/)

[2] [Cloudflare Web Analytics FAQ: UTM, custom events, retention, sampling and beacon timing](https://developers.cloudflare.com/web-analytics/faq/)

[3] [Cloudflare Web Analytics dimensions and Core Web Vitals data collection](https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/), [Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/)

[4] [Umami Cloud FAQ](https://docs.umami.is/docs/cloud/faq), [Umami documentation overview](https://docs.umami.is/docs)

[5] [Umami metric definitions](https://docs.umami.is/docs/metric-definitions), [Umami insights](https://docs.umami.is/docs/insights)

[6] [Superseller landing-page deployment README](../../superseller-landing-page/README.md)

[7] [Polish Electronic Communications Law, Article 399](https://eli.gov.pl/eli/DU/2024/1221/ogl/pol)

[8] [EDPB Guidelines 2/2023, final version](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en)

[9] [Umami sessions](https://docs.umami.is/docs/sessions), [Umami privacy FAQ](https://docs.umami.is/docs/faq)

[10] [Plausible data policy](https://plausible.io/data-policy), [Plausible pricing/trial documentation](https://plausible.io/docs/subscription-plans), [Plausible feature overview](https://plausible.io/docs/your-plausible-experience)

[11] [PostHog pricing](https://posthog.com/pricing), [PostHog privacy controls](https://posthog.com/docs/product-analytics/privacy), [PostHog data-collection controls](https://posthog.com/docs/privacy/data-collection), [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)

