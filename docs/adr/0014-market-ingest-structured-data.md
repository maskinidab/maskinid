# 0014 – Market ingest reads structured data only; guard rails enforced twice

**Context.** SPEC §8 asks for a worker (`apps/ingest`, "Node + Playwright/cheerio") that collects listings, matches
serials and raises alerts, with strict privacy rules for private sellers (§8.1, §8.6). The marketplaces' terms are not
yet reviewed, and scraped HTML changes often.

**Decision.**
- Connectors read Schema.org JSON-LD (and sitemaps/feeds), not rendered HTML. No DOM library or headless browser is
  needed; this keeps the worker dependency-free and makes raw HTML storage impossible by construction. A source that
  only renders client-side needs a partner feed instead of a headless browser.
- Selectors (search paths, listing URL pattern, seller markers, sitemaps, feed URL) live in `market_sources.config`,
  editable by a superadmin; credentials never do (rejected by `set_market_source`, tokens come from the worker env).
- Politeness: robots.txt (RFC 9309, 5xx ⇒ disallow all), ≥ 2 s between requests per host, `Crawl-delay` honoured,
  identifiable user agent, max 500 listings per run.
- Kill switch in the database: `start_market_run` refuses disabled or `restricted` sources, so a schedule or a manual
  run can never bypass the operator's decision. All starter sources ship disabled.
- Privacy is enforced in the worker (`sanitizeObservation`) and again in `ingest_observations` + a table check:
  seller identity only for businesses, sole traders (personal-number org numbers) are stored as private, personal keys
  and contact-like values are stripped from `raw`.
- Serials are only taken from explicit labels ("Serienr", "S/N", "PIN", "VIN", "Chassinr") or structured properties;
  image OCR (`ocr-listing-images`) is claimed once per listing via `claim_ocr_candidates`. Matching needs ≥ 0.85.

**Consequences.** Adapters for Mascus and Blocket are starting points that must be verified against the live sites
before enabling (docs/OPEN_QUESTIONS.md). Listings without structured data are skipped and logged, not guessed.
