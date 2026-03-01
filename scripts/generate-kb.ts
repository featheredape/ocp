#!/usr/bin/env npx tsx
/**
 * generate-kb.ts — Converts ocp_chunks_v2.json into the TypeScript knowledge base.
 *
 * Usage:
 *   npx tsx scripts/generate-kb.ts [path/to/ocp_chunks_v2.json]
 *
 * Defaults to ../ocp_chunks_v2.json if no path is given.
 * Output: src/data/ocp-knowledge-base.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const inputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(projectRoot, "..", "ocp_chunks_v2.json");

const outputPath = resolve(projectRoot, "src/data/ocp-knowledge-base.ts");

interface Chunk {
  id: string;
  parent: string;
  sectionTitle: string;
  text: string;
}

// Read and parse
console.log(`Reading: ${inputPath}`);
const raw = readFileSync(inputPath, "utf-8");
const chunks: Chunk[] = JSON.parse(raw);
console.log(`Parsed ${chunks.length} chunks`);

// Build sectionMeta: parent → sectionTitle (first occurrence wins)
const sectionMeta: Record<string, string> = {};
for (const c of chunks) {
  if (!sectionMeta[c.parent]) {
    sectionMeta[c.parent] = c.sectionTitle;
  }
}

// Escape backticks and backslashes for template literals
function escapeTemplate(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

// Generate TypeScript
const lines: string[] = [];
lines.push("// Auto-generated from ocp_chunks_v2.json");
lines.push("// DO NOT EDIT MANUALLY — run: npx tsx scripts/generate-kb.ts");
lines.push("");
lines.push("export interface PolicyChunk {");
lines.push("  id: string;");
lines.push("  parent: string;");
lines.push("  sectionTitle: string;");
lines.push("  text: string;");
lines.push("}");
lines.push("");
lines.push("export const ocpChunks: PolicyChunk[] = [");

for (const c of chunks) {
  lines.push("  {");
  lines.push(`    id: '${escapeTemplate(c.id)}',`);
  lines.push(`    parent: '${escapeTemplate(c.parent)}',`);
  lines.push(`    sectionTitle: '${escapeTemplate(c.sectionTitle)}',`);
  lines.push(`    text: \`${escapeTemplate(c.text)}\`,`);
  lines.push("  },");
}

lines.push("];");
lines.push("");
lines.push("export const sectionMeta: Record<string, string> = {");

for (const [key, val] of Object.entries(sectionMeta)) {
  lines.push(`  '${escapeTemplate(key)}': '${escapeTemplate(val)}',`);
}

lines.push("};");

const output = lines.join("\n") + "\n";
writeFileSync(outputPath, output, "utf-8");
console.log(`Written: ${outputPath} (${chunks.length} chunks, ${Object.keys(sectionMeta).length} section titles)`);
