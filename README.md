# Automated Job Posting Pipeline

[![Tests](https://github.com/abchughtai786/automated-job-posting-pipeline/actions/workflows/main.yml/badge.svg)](https://github.com/abchughtai786/automated-job-posting-pipeline/actions/workflows/main.yml)
![Node.js 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)
![Dependencies: none](https://img.shields.io/badge/dependencies-none-blue)

A Node.js project that automatically finds entry-level jobs and internships, filters out bad or fake listings, and publishes them to a job website.

This is a demo version. It runs on sample data and does not publish anything for real.

## Highlights

- 🛡️ **Fails safe**: if the AI check breaks, the job is held for review, never published unchecked
- 🚫 **Catches scams**: fees, bank-detail requests, vague recruiters, cut-off and region-locked listings
- 🔁 **No double posts**: duplicates are caught even when reworded or posted on another site
- 🔒 **Secure by design**: protected against script injection, fake links, prompt injection and slow-down input
- ♻️ **Crash-safe**: progress is saved after every job, so a restart never repeats work
- ✅ **47 automated tests**, run on every update with GitHub Actions

## How it works

1. **Collect**: reads jobs from company career pages and job-board RSS feeds.
2. **Parse**: pulls out the job title, company, location, description and apply link.
3. **Screen**: removes senior roles, scams and incomplete posts using rules and AI.
4. **Remove duplicates**: skips jobs that were already posted, even if reworded.
5. **Rank**: picks the most useful jobs first.
6. **Generate content**: writes an SEO-friendly job page.
7. **Publish**: posts the job page (simulated WordPress in the demo).
8. **Notify search engines**: submits the new page for indexing (simulated in the demo).
9. **Handle errors**: retries failed jobs and sends problem jobs for manual review.

```mermaid
flowchart LR
    A[Career pages] --> C[Collect]
    B[Job-board RSS] --> C
    C --> D{Screen<br/>rules + AI}
    D -- rejected --> X[Skipped:<br/>scam, senior,<br/>incomplete]
    D -- AI failed --> R[Manual review]
    D -- passed --> E[Remove<br/>duplicates]
    E --> F[Rank]
    F --> G[Generate<br/>job page]
    G --> H[Publish]
    H --> I[Notify search<br/>engines]
    H -- failed 3 times --> S[Stuck list]

    classDef ok fill:#d1f7d6,stroke:#2da44e,color:#0b3d17
    classDef bad fill:#ffe1e0,stroke:#cf222e,color:#5c0a0a
    classDef warn fill:#fff4d6,stroke:#bf8700,color:#4d3800
    class H,I ok
    class X bad
    class R,S warn
```

## Tech stack

Node.js · AI integration (Groq) · WordPress REST API and Google Indexing API (opt-in adapters) · Node test runner

## Run it

Requires Node.js 22+. No packages to install.

```bash
npm run demo    # run the pipeline on sample data
npm test        # run the tests
```

Results are saved in the `output/` folder: generated job pages, the indexing requests and a run report. Example output is in [`docs/examples/`](docs/examples/), and the design is explained in [`docs/architecture.md`](docs/architecture.md).

## Demo output

One run on the sample data: scams, senior roles, vague and incomplete listings are rejected, a reworded duplicate is skipped, and 7 jobs are published.

![Terminal output of npm run demo](docs/images/demo-terminal.png)

A job page generated from a job-board listing:

![Generated job page preview](docs/images/job-page.png)

## Author

**Ahsan Baig Chughtai** · [GitHub](https://github.com/abchughtai786)
