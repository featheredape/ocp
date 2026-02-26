/**
 * OCP Planning Director — Cloudflare Worker
 *
 * Receives a user question + relevant policy chunks from the frontend,
 * calls the Claude API, and returns an intelligent, synthesized response
 * as if from the head of the regional Planning Department.
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
      return new Response(null, {
        headers: corsHeaders(env),
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "POST required" }, 405, env);
    }

    try {
      const { question, chunks } = await request.json();

      if (!question || !chunks?.length) {
        return jsonResponse({ error: "Missing question or chunks" }, 400, env);
      }

      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return jsonResponse({ error: "API key not configured" }, 500, env);
      }

      // Build the user message with the question and relevant policy chunks
      const chunksText = chunks
        .slice(0, 25) // Cap at 25 chunks to stay within token limits
        .map(c => `[${c.id}] (${c.sectionTitle})\n${c.text}`)
        .join("\n\n---\n\n");

      const userMessage = `A resident asks: "${question}"

Here are the relevant OCP policy excerpts to base your answer on:

${chunksText}

Please provide a clear, helpful answer to the resident's question based on these policy excerpts.`;

      // Call Claude API
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

      return jsonResponse({ answer }, 200, env);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: "Internal error" }, 500, env);
    }
  },
};

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
