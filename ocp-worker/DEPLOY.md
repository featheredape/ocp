# Deploying the OCP Planning Director API

This Cloudflare Worker receives questions + matched policy chunks from the frontend and calls the Claude API to generate intelligent summaries.

## Prerequisites

- Node.js 18+
- A Cloudflare account
- An Anthropic API key

## Steps

### 1. Install Wrangler

```bash
npm install -g wrangler
```

### 2. Log in to Cloudflare

```bash
wrangler login
```

### 3. Deploy the Worker

From this `ocp-worker` directory:

```bash
wrangler deploy
```

This will deploy and give you a URL like:
`https://ocp-planner-api.<your-subdomain>.workers.dev`

### 4. Set the API key as a secret

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Paste your Anthropic API key when prompted. This is stored encrypted — never in code.

### 5. Update the frontend

Open `AskPlanner.tsx` in the ocp-v2 project and update the `WORKER_URL` constant at the top:

```typescript
const WORKER_URL = "https://ocp-planner-api.<your-subdomain>.workers.dev";
```

Then rebuild the frontend:

```bash
cd ../ocp-v2
pnpm build
pnpm exec html-inline dist/index.html > bundle.html
```

Upload the new `bundle.html` as `index.html` to your Cloudflare Pages project.

### 6. (Optional) Lock down CORS

In `wrangler.toml`, change `ALLOWED_ORIGIN` from `"*"` to your Pages domain:

```toml
[vars]
ALLOWED_ORIGIN = "https://your-project.pages.dev"
```

Then redeploy: `wrangler deploy`

## Cost

Each question costs roughly 1,500–3,000 input tokens + 300–500 output tokens on Claude Sonnet. At current pricing that's about $0.01–0.02 per question.
