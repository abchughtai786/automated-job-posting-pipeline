# Architecture overview

The pipeline is a sequence of small, independent stages. Each stage talks to the outside world only through an interface, so the demo can swap real services for local mocks.

```
Sources ──▶ Collect ──▶ Screen ──▶ De-duplicate ──▶ Rank ──▶ Generate content ──▶ Publish ──▶ Index
                                                                                      │
                                                         failures ──▶ retry ──▶ manual review
```

## Stages

| Stage | Folder | Idea |
|---|---|---|
| Collect | `src/collectors/` | Read jobs from company career feeds and job-board RSS. One failing source never stops the other. |
| Clean | `src/parsing/` | Clean untrusted text and HTML before it reaches a page or a link. |
| Screen | `src/screening/` | Quick rules first, then an AI check. If the AI check cannot finish, the job is held back, never let through. |
| De-duplicate | `src/dedup/` | Skip jobs already posted, even when reworded or posted from another source. |
| Rank | `src/ranking/` | Publish the most useful jobs first, within per-run and per-day limits. |
| Content | `src/content/`, `src/ai/` | Write the job page, validate the AI output, and fall back to a simple formatter if needed. |
| Publish and index | `src/publish/` | Create the page and notify search engines. |
| State | `src/store/` | Remember what was processed, so runs can be repeated safely. |

## Design principles

- **Safe by default**: demo mode uses local mocks and blocks network access; live publishing has to be switched on explicitly.
- **Fail closed**: a job is only published after it passes screening.
- **Resumable**: progress is saved after every job, so a crash never causes a double post.
- **Untrusted input**: listing text is cleaned before it reaches a page, a link or an AI prompt.

`docs/examples/` contains output from a real demo run.
