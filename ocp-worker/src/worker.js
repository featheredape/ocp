/**
 * OCP Planning Director — Cloudflare Worker
 *
 * Routes:
 *   POST /        — Claude-powered Q&A with semantic reranking
 *   POST /embed   — Generate text embeddings via Workers AI (bge-small-en-v1.5, 384 dims)
 *
 * The Q&A route now uses Workers AI embeddings to rerank keyword-matched
 * chunks by semantic similarity before sending the best ones to Claude.
 */

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
    // Build texts to embed: question first, then all chunk texts
    const texts = [question, ...chunks.map(c => c.text)];

    // Workers AI bge-small-en-v1.5: 384-dimensional embeddings
    // Process in batches of 100
    const BATCH_SIZE = 100;
    const allEmbeddings = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const result = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
        text: batch,
      });
      allEmbeddings.push(...result.data);
    }

    const queryEmbedding = allEmbeddings[0];
    const chunkEmbeddings = allEmbeddings.slice(1);

    // Score each chunk by cosine similarity to the query
    const scored = chunks.map((chunk, i) => ({
      ...chunk,
      similarity: cosineSimilarity(queryEmbedding, chunkEmbeddings[i]),
    }));

    // Sort by similarity (highest first)
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored;
  } catch (err) {
    console.error("Reranking failed, falling back to original order:", err);
    // If reranking fails, return chunks in original order (keyword-ranked)
    return chunks;
  }
}

/* ─── /embed — Generate embeddings via Workers AI ─── */
async function handleEmbed(request, env) {
  try {
    const { texts } = await request.json();

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return jsonResponse({ error: "Missing 'texts' array" }, 400, env);
    }

    const BATCH_SIZE = 100;
    const allEmbeddings = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const result = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
        text: batch,
      });
      allEmbeddings.push(...result.data);
    }

    return jsonResponse({ embeddings: allEmbeddings }, 200, env);
  } catch (err) {
    console.error("Embed error:", err);
    return jsonResponse({ error: "Embedding failed", detail: String(err) }, 500, env);
  }
}

/* ─── / — Claude Q&A with semantic reranking ─── */
async function handleAsk(request, env) {
  try {
    const { question, chunks } = await request.json();

    if (!question || !chunks?.length) {
      return jsonResponse({ error: "Missing question or chunks" }, 400, env);
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: "API key not configured" }, 500, env);
    }

    // Step 1: Rerank chunks by semantic similarity using embeddings
    // The client sends up to 50 keyword-matched candidates;
    // we rerank and keep the top 25 for Claude.
    let bestChunks;
    if (env.AI) {
      const reranked = await rerankChunks(question, chunks, env);
      bestChunks = reranked.slice(0, 25);
    } else {
      // Fallback if Workers AI not available: use keyword order
      bestChunks = chunks.slice(0, 25);
    }

    // Step 2: Build prompt and call Claude
    const chunksText = bestChunks
      .map((c) => `[${c.id}] (${c.sectionTitle})\n${c.text}`)
      .join("\n\n---\n\n");

    const userMessage = `A resident asks: "${question}"

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
      return jsonResponse(
        { error: "AI service error", detail: claudeResponse.status },
        502,
        env
      );
    }

    const data = await claudeResponse.json();
    const answer = data.content?.[0]?.text || "No response generated.";

    // Return the answer plus the IDs of the reranked chunks used
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
