import PROVIDERS from "./providers.js";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path) {
  if (!existsSync(path) || statSync(path).isDirectory()) return;
  const lines = readFileSync(path, "utf-8").split("\n");
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

// Load .env from the package directory (main config)
loadEnvFile(join(__dirname, "..", ".env"));
// Also load from current working directory (project-specific overrides)
loadEnvFile(join(process.cwd(), ".env"));
// Also load from home directory (global fallback)
loadEnvFile(join(process.env.HOME || "", ".free-ai.env"));

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
    supportsVision: !!p.supportsVision,
  }));
}

// --- Usage tracking ---
const usageStats = {};

function trackUsage(providerName) {
  if (!usageStats[providerName]) {
    usageStats[providerName] = { requests: 0, firstUsed: Date.now(), lastUsed: Date.now() };
  }
  usageStats[providerName].requests++;
  usageStats[providerName].lastUsed = Date.now();
}

function getUsageStats() {
  return { ...usageStats };
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
  const callOpts = {};
  if (options.onToken) callOpts.onToken = options.onToken;
  if (options.imageParts) callOpts.imageParts = options.imageParts;

  // If image requested, prefer providers with vision support
  let providerList = active;
  if (options.imageParts) {
    const visionProviders = active.filter(p => p.supportsVision);
    const nonVision = active.filter(p => !p.supportsVision);
    providerList = [...visionProviders, ...nonVision];
  }

  // If skipProvider specified (for retry), skip that one
  if (options.skipProvider) {
    providerList = providerList.filter(p => p.name !== options.skipProvider);
  }

  for (const provider of providerList) {
    try {
      const result = await provider.call(
        process.env[provider.envKey],
        messages,
        options.model,
        callOpts,
      );
      trackUsage(provider.name);
      return {
        text: result,
        provider: provider.label,
        providerName: provider.name,
        model: options.model || provider.model,
      };
    } catch (err) {
      errors.push({ provider: provider.label, error: err.message });
      continue;
    }
  }

  throw new Error(
    "All providers failed:\n" +
      errors.map((e) => `  ${e.provider}: ${e.error}`).join("\n")
  );
}

export { askAI, getProviderStatus, getActiveProviders, getUsageStats };
