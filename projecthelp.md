# OCP Analyzer — Project Help

Quick reference for build commands, deployment, and Claude skills useful for this project.


## Project Structure

```
ocp-review/
  public/index.html        ← deployed bundle (Cloudflare Pages)
  ocp-worker/               ← Cloudflare Worker (Claude API + vector reranking)
    src/worker.js
    wrangler.toml
  ocp-docs/                 ← source OCP documents
  regulatory-docs/          ← external bylaws and statutes
```

The frontend source lives in `ocp-v2/` (inside Cowork's working directory, not in the workspace folder). The build process compiles it into a single HTML file and copies it to `public/index.html`.


## Build & Deploy Commands

### Local Development

```bash
# Start dev server with hot reload
cd ocp-v2
pnpm dev
```

### Production Build (Full Pipeline)

```bash
cd ocp-v2
pnpm build
pnpm exec html-inline dist/index.html > bundle.html
cp bundle.html /path/to/ocp-review/public/index.html
```

This compiles TypeScript, bundles with Vite, inlines all CSS/JS into a single HTML file, and copies it to the workspace for Cloudflare Pages deployment.

### Deploy Frontend to Cloudflare Pages

Upload `public/index.html` to your Cloudflare Pages project via the dashboard, or use Wrangler:

```bash
cd ocp-review
npx wrangler pages deploy public --project-name=your-pages-project
```

### Deploy Worker (API Backend)

```bash
cd ocp-worker

# First time: install wrangler and log in
npm install -g wrangler
wrangler login

# Deploy
wrangler deploy

# Set the Anthropic API key (stored encrypted)
wrangler secret put ANTHROPIC_API_KEY
```

The worker URL is set in `AskPlanner.tsx` as `WORKER_URL`. After deploying a new worker, update this constant and rebuild the frontend.

### Worker Configuration (wrangler.toml)

```toml
name = "ocp-planner-api"
account_id = "500de4e93a305c7d7fcee9575ac0e29a"
main = "src/worker.js"
compatibility_date = "2024-09-23"

[vars]
ALLOWED_ORIGIN = "*"    # Lock down to your Pages domain in production

[ai]
binding = "AI"           # Workers AI for vector embedding reranking
```

### Other Useful Commands

```bash
# Type-check without building
cd ocp-v2
pnpm exec tsc -b --noEmit

# Lint
cd ocp-v2
pnpm lint

# Preview production build locally
cd ocp-v2
pnpm preview

# Check worker logs
wrangler tail

# Test worker locally
wrangler dev
```


## Claude Skill Commands

These are slash commands you can use in Claude (Cowork mode) when working on this project. They invoke specialized skills with best-practice workflows built in.

### Data & Analysis

| Command | What It Does | Example |
|---|---|---|
| `/data:analyze "question"` | Searches the OCP data and gives a detailed, sourced answer about what the OCP says on a topic. Great for research. | `/data:analyze "I want to build a rock wall"` |
| `/data:explore-data filename` | Profiles a dataset — row counts, column types, distributions, nulls, patterns. | `/data:explore-data ocp_chunks_v2.json` |
| `/data:create-viz` | Creates publication-quality charts and graphs from data using Python. | `/data:create-viz "Show modal verb frequency across OCP sections"` |
| `/data:build-dashboard` | Builds an interactive HTML dashboard with Chart.js, filters, and tables. | `/data:build-dashboard "OCP section coverage and consistency ratings"` |
| `/data:validate` | QA check on an analysis — methodology, accuracy, bias. Use before publishing findings. | `/data:validate` |
| `/data:write-query` | Writes optimized SQL for any dialect. Useful if you move the data into a database. | `/data:write-query "Find all chunks with conflicting modal verbs"` |
| `/data:statistical-analysis` | Descriptive stats, hypothesis testing, outlier detection. | `/data:statistical-analysis` |

### Engineering & Code

| Command | What It Does | Example |
|---|---|---|
| `/engineering:code-review` | Reviews code for bugs, security issues, and maintainability. | `/engineering:code-review` (after sharing code) |
| `/engineering:system-design` | Designs systems and architectures. Good for planning new features. | `/engineering:system-design "Add user authentication to the worker"` |
| `/engineering:testing-strategy` | Designs test plans — what to test, how, and coverage strategy. | `/engineering:testing-strategy "Test the vector search reranking"` |
| `/engineering:tech-debt` | Identifies and prioritizes technical debt and refactoring. | `/engineering:tech-debt` |
| `/engineering:documentation` | Writes technical docs, READMEs, runbooks, API docs. | `/engineering:documentation "Document the worker API"` |
| `/engineering:debug` | Structured debugging — reproduce, isolate, diagnose, fix. | `/engineering:debug "Vector search returns keyword-only mode"` |
| `/engineering:deploy-checklist` | Pre-deployment verification checklist. | `/engineering:deploy-checklist` |

### Design & UX

| Command | What It Does | Example |
|---|---|---|
| `/design:critique` | Structured design feedback on usability, hierarchy, consistency. | `/design:critique` (share a screenshot) |
| `/design:accessibility` | WCAG 2.1 AA accessibility audit. | `/design:accessibility` |
| `/design:ux-copy` | Write or review microcopy — buttons, error messages, empty states. | `/design:ux-copy "What should the empty search state say?"` |
| `/design:handoff` | Generate developer specs from a design. | `/design:handoff` |

### Content & Writing

| Command | What It Does | Example |
|---|---|---|
| `/anthropic-skills:docx` | Create or edit Word documents. | `/anthropic-skills:docx "Write a summary report of OCP findings"` |
| `/anthropic-skills:pptx` | Create PowerPoint presentations. | `/anthropic-skills:pptx "Create a 10-slide OCP analysis deck"` |
| `/anthropic-skills:pdf` | Read, create, merge, split, or fill PDF forms. | `/anthropic-skills:pdf "Extract tables from the OCP PDF"` |
| `/anthropic-skills:xlsx` | Create or edit Excel spreadsheets. | `/anthropic-skills:xlsx "Export inconsistencies as a spreadsheet"` |
| `/anthropic-skills:canvas-design` | Create visual art, posters, and designs as PNG/PDF. | `/anthropic-skills:canvas-design "Create a cover image for the report"` |

### Scheduling

| Command | What It Does | Example |
|---|---|---|
| `/schedule` | Create a recurring or one-off automated task. | `/schedule "Check worker health every morning at 9am"` |


## Tips for Working with This Project

**Rebuilding after changes:** After editing any `.tsx` file, you need to run the full build pipeline (build → inline → copy) for changes to appear on the deployed site.

**The data file:** `ocp_chunks_v2.json` contains 1,202 chunks from the OCP. It's the knowledge base for both the Ask a Planner feature and for `/data:analyze` queries. If you update this file, you'll need to regenerate the TypeScript knowledge base (`src/data/ocp-knowledge-base.ts`).

**Worker vector search:** The worker uses Cloudflare Workers AI (`@cf/baai/bge-small-en-v1.5`) to rerank search results by semantic similarity. If `[ai]` binding is missing from `wrangler.toml`, it falls back to keyword-only search. The debug panel on the site shows which mode is active.

**CORS:** The worker currently allows all origins (`ALLOWED_ORIGIN = "*"`). For production, set this to your Pages domain.

**Cost:** Each "Ask a Planner" question costs roughly $0.01–0.02 in Claude API usage (Sonnet model).
