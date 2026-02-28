/**
 * OCP Planning Director — Cloudflare Worker
 *
 * Routes:
 *   POST /        — Claude-powered Q&A with semantic reranking
 *   POST /embed   — Generate text embeddings via Workers AI (bge-small-en-v1.5, 384 dims)
 *
 * The Q&A route uses Workers AI embeddings to rerank keyword-matched
 * chunks by semantic similarity before sending the best ones to Claude.
 */

/* ─── Constants ─── */
const MAX_QUESTION_LENGTH = 1000;       // Max chars for a user question
const MAX_CHUNKS_ACCEPTED = 100;        // Max chunks the client can send
const MAX_CHUNK_TEXT_LENGTH = 5000;      // Max chars per chunk text
const MAX_EMBED_TEXTS = 200;            // Max texts for /embed endpoint
const MAX_EMBED_TEXT_LENGTH = 5000;      // Max chars per embed text
const RERANK_TOP_N = 25;                // Chunks kept after reranking for Claude
const EMBEDDING_BATCH_SIZE = 100;       // Workers AI batch size
const RATE_LIMIT_WINDOW_MS = 60_000;    // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 30;     // Max requests per IP per window

/* ─── In-memory rate limiter ─── */
const rateLimitMap = new Map(); // IP → { count, windowStart }

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  return false;
}

// Periodic cleanup of stale entries (runs lazily)
function cleanupRateLimits() {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}

const SYSTEM_PROMPT = `You are the Director of Planning for the Salt Spring Island Local Trust Area. You have decades of experience in land use planning, bylaw interpretation, and community governance within the Islands Trust framework.

When answering questions:
- Draw ONLY from the OCP policy excerpts provided in the user message. Do not invent policies or reference sections not included.
- Cite specific policy numbers (e.g., "Policy B.2.2.2.15 states…") when making claims.
- Be concise and direct — aim for 3–6 sentences for simple questions, up to 2–3 short paragraphs for complex ones.
- Use plain language accessible to residents, not planning jargon.
- If the provided excerpts don't fully answer the question, say so honestly and suggest which OCP sections the reader should consult.
- Where policies use weak language ("should," "could," "may consider"), note this — residents deserve to know what is mandatory vs. discretionary.
- Never give legal advice. You are explaining what the OCP says, not how a court would interpret it.
- Do not use markdown headings. Use plain prose. You may bold key policy numbers with **B.2.2.2.15** formatting.`;

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "POST required" }, 405, env);
    }

    // Rate limiting by IP
    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
    if (isRateLimited(clientIP)) {
      return jsonResponse({ error: "Too many requests. Please wait a moment." }, 429, env);
    }

    // Lazy cleanup (~1% of requests)
    if (Math.random() < 0.01) cleanupRateLimits();

    // Route based on URL path
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/embed") {
      return handleEmbed(request, env);
    }

    // Default: Claude Q&A with semantic reranking
    return handleAsk(request, env);
  },
};

/* ─── Cosine similarity ─── */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

/* ─── Semantic reranking via Workers AI embeddings ─── */
async function rerankChunks(question, chunks, env) {
  try {
    const texts = [question, ...chunks.map(c => c.text)];
    const allEmbeddings = [];

    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      const result = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
        text: batch,
      });
      allEmbeddings.push(...result.data);
    }

    const queryEmbedding = allEmbeddings[0];
    const chunkEmbeddings = allEmbeddings.slice(1);

    const scored = chunks.map((chunk, i) => ({
      ...chunk,
      similarity: cosineSimilarity(queryEmbedding, chunkEmbeddings[i]),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored;
  } catch (err) {
    console.error("Reranking failed, falling back to original order:", err);
    return chunks;
  }
}

/* ─── /embed — Generate embeddings via Workers AI ─── */
async function handleEmbed(request, env) {
  try {
    const body = await request.json();
    const { texts } = body;

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return jsonResponse({ error: "Missing 'texts' array" }, 400, env);
    }

    // Input size validation
    if (texts.length > MAX_EMBED_TEXTS) {
      return jsonResponse({ error: `Too many texts. Maximum is ${MAX_EMBED_TEXTS}.` }, 400, env);
    }

    // Validate and truncate individual texts
    const sanitized = texts.map(t => {
      if (typeof t !== "string") return "";
      return t.slice(0, MAX_EMBED_TEXT_LENGTH);
    }).filter(t => t.length > 0);

    if (sanitized.length === 0) {
      return jsonResponse({ error: "No valid text strings provided" }, 400, env);
    }

    const allEmbeddings = [];
    for (let i = 0; i < sanitized.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = sanitized.slice(i, i + EMBEDDING_BATCH_SIZE);
      const result = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
        text: batch,
      });
      allEmbeddings.push(...result.data);
    }

    return jsonResponse({ embeddings: allEmbeddings }, 200, env);
  } catch (err) {
    console.error("Embed error:", err);
    return jsonResponse({ error: "Embedding failed" }, 500, env);
  }
}

/* ─── / — Claude Q&A with semantic reranking ─── */
async function handleAsk(request, env) {
  try {
    const body = await request.json();
    const { question, chunks } = body;

    if (!question || typeof question !== "string") {
      return jsonResponse({ error: "Missing or invalid question" }, 400, env);
    }

    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      return jsonResponse({ error: "Missing or empty chunks array" }, 400, env);
    }

    // Input size validation
    if (question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse({ error: `Question too long. Maximum is ${MAX_QUESTION_LENGTH} characters.` }, 400, env);
    }

    if (chunks.length > MAX_CHUNKS_ACCEPTED) {
      return jsonResponse({ error: `Too many chunks. Maximum is ${MAX_CHUNKS_ACCEPTED}.` }, 400, env);
    }

    // Sanitize chunks: validate shape and truncate text
    const sanitizedChunks = chunks
      .filter(c => c && typeof c.id === "string" && typeof c.text === "string")
      .map(c => ({
        id: c.id.slice(0, 50),
        sectionTitle: typeof c.sectionTitle === "string" ? c.sectionTitle.slice(0, 200) : "",
        text: c.text.slice(0, MAX_CHUNK_TEXT_LENGTH),
      }));

    if (sanitizedChunks.length === 0) {
      return jsonResponse({ error: "No valid chunks provided" }, 400, env);
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "API key not configured" }, 500, env);
    }

    // Step 1: Rerank chunks by semantic similarity
    let bestChunks;
    if (env.AI) {
      const reranked = await rerankChunks(question, sanitizedChunks, env);
      bestChunks = reranked.slice(0, RERANK_TOP_N);
    } else {
      bestChunks = sanitizedChunks.slice(0, RERANK_TOP_N);
    }

    // Step 2: Build prompt and call Claude
    const chunksText = bestChunks
      .map((c) => `[${c.id}] (${c.sectionTitle})\n${c.text}`)
      .join("\n\n---\n\n");

    const sanitizedQuestion = question.slice(0, MAX_QUESTION_LENGTH);
    const userMessage = `A resident asks: "${sanitizedQuestion}"

Here are the relevant OCP policy excerpts to base your answer on:

${chunksText}

Please provide a clear, helpful answer to the resident's question based on these policy excerpts.`;

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errBody);
      return jsonResponse({ error: "AI service temporarily unavailable" }, 502, env);
    }

    const data = await claudeResponse.json();
    const answer = data.content?.[0]?.text;

    if (!answer) {
      console.error("Claude returned unexpected response shape:", JSON.stringify(data).slice(0, 200));
      return jsonResponse({ error: "AI service returned an unexpected response" }, 502, env);
    }

    return jsonResponse({
      answer,
      rerankedIds: bestChunks.map(c => c.id),
    }, 200, env);
  } catch (err) {
    console.error("Worker error:", err);
    return jsonResponse({ error: "Internal error" }, 500, env);
  }
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env),
    },
  });
}
