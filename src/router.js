import PROVIDERS from "./providers.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

function loadEnv() {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

function getActiveProviders() {
  return PROVIDERS.filter((p) => process.env[p.envKey]);
}

function getProviderStatus() {
  return PROVIDERS.map((p) => ({
    name: p.name,
    label: p.label,
    model: p.model,
    configured: !!process.env[p.envKey],
    freeInfo: p.freeInfo,
  }));
}

const SYSTEM_PROMPT = `You are an expert coding assistant. Provide clear, concise, and accurate answers.
When writing code, use best practices and include brief explanations.
Focus on practical solutions. If the question is ambiguous, state your assumptions.`;

async function askAI(prompt, options = {}) {
  const active = getActiveProviders();

  if (active.length === 0) {
    throw new Error(
      "No AI providers configured. Add API keys to .env file.\n\n" +
        "Free API keys:\n" +
        PROVIDERS.map((p) => `  ${p.label}: ${p.freeInfo}`).join("\n")
    );
  }

  const messages = [
    { role: "system", content: options.systemPrompt || SYSTEM_PROMPT },
    ...(options.context || []),
    { role: "user", content: prompt },
  ];

  const errors = [];

  for (const provider of active) {
    try {
      const result = await provider.call(
        process.env[provider.envKey],
        messages,
        options.model
      );
      return {
        text: result,
        provider: provider.label,
        model: options.model || provider.model,
      };
    } catch (err) {
      errors.push({ provider: provider.label, error: err.message });
      // Rate limited or quota exceeded — try next provider
      continue;
    }
  }

  throw new Error(
    "All providers failed:\n" +
      errors.map((e) => `  ${e.provider}: ${e.error}`).join("\n")
  );
}

export { askAI, getProviderStatus, getActiveProviders };
