# OCP Analyzer — Technical Debt Audit

**Date:** March 1, 2026
**Scope:** Frontend (ocp-v2) and Worker (ocp-worker)

---

## Executive Summary

The OCP Analyzer has 12 identified tech debt items across 6 categories. The codebase works well for its current scope — a single-page static analysis site with an AI Q&A feature — but carries significant dead weight from unused dependencies and UI components, has zero test coverage, and concentrates too much logic in one 687-line component. The most impactful improvements are removing unused dependencies (immediate bundle savings), extracting the search engine from AskPlanner.tsx, and adding basic test coverage for the scoring logic.

---

## Findings

### TD-1. AskPlanner.tsx Is a 687-Line God Component

**Category:** Code debt
**Impact:** 4 · **Risk:** 3 · **Effort:** 3 · **Priority Score:** 21

AskPlanner.tsx contains the search engine (stopwords, synonyms, TF-IDF scoring, plural/singular generation, term expansion), the AI fetcher, highlight/markdown renderers, debug UI, grouped results display, and all associated state. This is approximately 5 distinct responsibilities in one file. Any change to the search algorithm requires reading through the entire component, and the scoring logic cannot be tested in isolation.

**Recommendation:** Extract into three modules: `src/lib/search-engine.ts` (pure functions: extractTerms, expandTerms, scoreChunks, groupBySection), `src/lib/ai-client.ts` (fetchAISummary), and keep AskPlanner.tsx as a thin UI shell.

---

### TD-2. 35 of 43 Shadcn/UI Components Are Unused

**Category:** Dependency debt
**Impact:** 3 · **Risk:** 2 · **Effort:** 1 · **Priority Score:** 25

Only 8 UI components are actually imported: accordion, badge, button, card, input, separator, table, and toast. The remaining 35 (alert, avatar, breadcrumb, calendar, carousel, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, resizable, scroll-area, select, sheet, skeleton, slider, sonner, switch, tabs, textarea, toaster, toggle, toggle-group, tooltip) are dead code.

These don't affect the production bundle (Vite tree-shakes them), but they clutter the codebase, inflate the git history, and each carries a matching Radix dependency in package.json.

**Recommendation:** Delete the 35 unused component files and remove their corresponding `@radix-ui/*` dependencies from package.json. This is a 15-minute cleanup.

---

### TD-3. 20+ Unused npm Dependencies

**Category:** Dependency debt
**Impact:** 3 · **Risk:** 3 · **Effort:** 1 · **Priority Score:** 30

Matching the unused UI components, these npm dependencies serve no purpose: `@hookform/resolvers`, `react-hook-form`, `zod`, `date-fns`, `react-day-picker`, `embla-carousel-react`, `react-resizable-panels`, `vaul`, `sonner`, `next-themes`, `cmdk`, and most of the 25+ `@radix-ui/*` packages (only `react-accordion`, `react-separator`, `react-slot`, `react-tabs`, `react-toast`, `react-toggle` are transitively needed). Additionally, `parcel`, `@parcel/config-default`, and `parcel-resolver-tspaths` are dev dependencies from a previous build system that was replaced by Vite.

**Recommendation:** Audit and remove. Run `pnpm prune` afterward. This will significantly speed up `pnpm install` and reduce the lockfile.

---

### TD-4. Zero Test Coverage — Frontend and Worker

**Category:** Test debt
**Impact:** 5 · **Risk:** 5 · **Effort:** 3 · **Priority Score:** 30

Neither the frontend nor the worker has a single test file. The search engine (extractTerms, pluralVariants, expandTerms, scoreChunks) is pure-function logic that is highly testable and directly affects user experience. The worker's rate limiter, input validation, chunk sanitization, and CORS logic are all testable without mocking external services.

The scoring engine has already had one bug (NaN sort on definition IDs like `D.9.def.sign`) that a test would have caught. Future changes to synonyms, stopwords, or scoring weights risk silent regressions.

**Recommendation:** Add Vitest (already compatible with the Vite setup). Priority test targets: `scoreChunks`, `expandTerms`, `pluralVariants`, `groupBySection` sort logic, and the worker's `isRateLimited` and input validation.

---

### TD-5. SearchSection.tsx Is Dead Code

**Category:** Code debt
**Impact:** 2 · **Risk:** 1 · **Effort:** 1 · **Priority Score:** 15

`SearchSection.tsx` is an older, simpler search component that was replaced by `AskPlanner.tsx`. It imports `ocp-sections.ts` (37-line data file) which is also unused elsewhere. Neither is imported by App.tsx or any other component. Both files are dead code.

**Recommendation:** Delete `SearchSection.tsx` and `src/data/ocp-sections.ts`.

---

### TD-6. Hardcoded Worker URL

**Category:** Infrastructure debt
**Impact:** 3 · **Risk:** 3 · **Effort:** 1 · **Priority Score:** 30

`AskPlanner.tsx` line 12 hardcodes:
```
const WORKER_URL = "https://ocp-planner-api.4bnpsgwbwk.workers.dev";
```

If the worker is redeployed under a different account, renamed, or a staging environment is needed, this requires a code change and rebuild. It also exposes the Cloudflare account subdomain in the client bundle.

**Recommendation:** Move to a Vite environment variable (`import.meta.env.VITE_WORKER_URL`) with a `.env` default, so it can be overridden at build time without touching source code.

---

### TD-7. Worker Rate Limiter Is Per-Isolate, Not Global

**Category:** Architecture debt
**Impact:** 2 · **Risk:** 3 · **Effort:** 4 · **Priority Score:** 10

The in-memory `rateLimitMap` in worker.js resets whenever the Cloudflare Worker isolate is recycled (which happens frequently under low traffic). Under high traffic, multiple isolates may run concurrently, each with their own map. This means rate limiting is best-effort, not guaranteed.

For the current traffic level (a small community site), this is acceptable. It becomes a problem only if the site experiences abuse or goes viral.

**Recommendation:** Low priority. If needed, migrate to Cloudflare Durable Objects or KV for persistent rate limiting. For now, document the limitation.

---

### TD-8. ocp-knowledge-base.ts Is a 10,739-Line Generated File With No Generation Script

**Category:** Documentation debt
**Impact:** 3 · **Risk:** 4 · **Effort:** 2 · **Priority Score:** 28

The header says "Auto-generated from ocp_chunks_v2.json — DO NOT EDIT MANUALLY" but the generation script is not in the repository. If the source JSON is updated (new OCP amendments, corrections), there's no documented way to regenerate the TypeScript file. The source JSON (`ocp_chunks_v2.json`) itself lives outside the project directory.

**Recommendation:** Add a `scripts/generate-kb.ts` that reads `ocp_chunks_v2.json` and outputs `ocp-knowledge-base.ts`. Add an npm script: `"generate": "ts-node scripts/generate-kb.ts"`. Commit the source JSON or document its canonical location.

---

### TD-9. No CI/CD Pipeline

**Category:** Infrastructure debt
**Impact:** 3 · **Risk:** 3 · **Effort:** 3 · **Priority Score:** 18

There is no `.github/workflows/`, no automated build, no lint check, no deploy automation. Deployment is manual: `pnpm build`, `html-inline`, copy bundle, `wrangler pages deploy`. A typo in a component could ship to production without any automated gate.

**Recommendation:** Add a GitHub Actions workflow that runs `pnpm lint`, `pnpm build`, and (once tests exist) `pnpm test` on push. Optionally auto-deploy the bundle to Cloudflare Pages on merge to main.

---

### TD-10. Bundle Size: 840KB Single HTML File

**Category:** Architecture debt
**Impact:** 2 · **Risk:** 2 · **Effort:** 4 · **Priority Score:** 8

The `html-inline` bundling produces an 840KB single HTML file. The `ocp-knowledge-base.ts` alone is ~496KB of source (compresses well with gzip, but still parses as a single chunk). First-paint requires downloading and parsing everything before rendering anything.

For the current audience (Salt Spring Islanders on broadband), this is workable. For mobile users on poor connections, it could be slow.

**Recommendation:** Low priority. If performance becomes an issue, consider lazy-loading the knowledge base or splitting the AI search from the static analysis sections. The single-file constraint (Cloudflare Pages static site) limits options.

---

### TD-11. Duplicated Regex Escaping Pattern

**Category:** Code debt
**Impact:** 1 · **Risk:** 1 · **Effort:** 1 · **Priority Score:** 10

The pattern `t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` appears 4 times in AskPlanner.tsx (lines 149, 181, 194, 285). This is a textbook extract-to-utility candidate.

**Recommendation:** Extract to `function escapeRegex(s: string): string` in `src/lib/utils.ts`.

---

### TD-12. No Prettier / No Formatting Standard

**Category:** Documentation debt
**Impact:** 2 · **Risk:** 2 · **Effort:** 1 · **Priority Score:** 16

ESLint is configured but there's no Prettier config. Formatting is inconsistent in places (some files use trailing commas, others don't; indentation varies between generated and hand-written code).

**Recommendation:** Add `.prettierrc` with a standard config and run `prettier --write` once to normalize.

---

## Priority Matrix

| Rank | ID | Item | Priority Score | Effort |
|------|----|------|---------------|--------|
| 1 | TD-3 | Unused npm dependencies | 30 | Low |
| 2 | TD-4 | Zero test coverage | 30 | Medium |
| 3 | TD-6 | Hardcoded worker URL | 30 | Low |
| 4 | TD-8 | No KB generation script | 28 | Low |
| 5 | TD-2 | 35 unused UI components | 25 | Low |
| 6 | TD-1 | AskPlanner god component | 21 | Medium |
| 7 | TD-9 | No CI/CD pipeline | 18 | Medium |
| 8 | TD-12 | No Prettier config | 16 | Low |
| 9 | TD-5 | Dead SearchSection code | 15 | Low |
| 10 | TD-11 | Duplicated regex escape | 10 | Low |
| 11 | TD-7 | Per-isolate rate limiter | 10 | High |
| 12 | TD-10 | 840KB bundle size | 8 | High |

---

## Phased Remediation Plan

### Phase 1: Quick Wins (1-2 hours)

Items that can be done alongside feature work with minimal risk.

- **TD-3:** Remove unused npm dependencies and prune lockfile
- **TD-2:** Delete 35 unused UI component files
- **TD-5:** Delete SearchSection.tsx and ocp-sections.ts
- **TD-6:** Move WORKER_URL to `import.meta.env.VITE_WORKER_URL`
- **TD-11:** Extract `escapeRegex()` utility
- **TD-12:** Add `.prettierrc` and format codebase

### Phase 2: Structural Improvements (half day)

Requires focused effort but significantly improves maintainability.

- **TD-1:** Extract search engine and AI client from AskPlanner.tsx
- **TD-8:** Write KB generation script, commit source JSON
- **TD-4:** Add Vitest, write tests for search engine pure functions

### Phase 3: Infrastructure (when needed)

Only worth doing if the project grows beyond a solo-maintained site.

- **TD-9:** Add GitHub Actions CI (lint + build + test)
- **TD-7:** Consider Durable Objects for rate limiting if abuse occurs
- **TD-10:** Investigate lazy-loading knowledge base if mobile performance is reported as an issue
