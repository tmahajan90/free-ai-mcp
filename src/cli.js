#!/usr/bin/env node

import { askAI, getProviderStatus } from "./router.js";
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
free-ai — Chain free AI APIs with automatic fallback

Usage:
  free-ai ask "your question here"       Ask a coding question
  free-ai ask -f <file> "question"       Ask with file context
  free-ai review <file>                  Review a code file
  free-ai status                         Show configured providers
  free-ai help                           Show this help

Examples:
  free-ai ask "how to add pagination in Rails"
  free-ai ask -f app/models/user.rb "optimize this model"
  free-ai review app/controllers/sales_controller.rb

Providers are tried in order. If one is rate-limited, the next is used.
Configure API keys in: ~/.free-ai/.env (or project .env)
`;

function printColored(text, color) {
  const colors = {
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
    bold: "\x1b[1m",
  };
  process.stdout.write(`${colors[color] || ""}${text}${colors.reset}`);
}

async function handleAsk() {
  let fileContent = null;
  let question = null;
  const askArgs = args.slice(1);

  for (let i = 0; i < askArgs.length; i++) {
    if (askArgs[i] === "-f" && askArgs[i + 1]) {
      try {
        fileContent = readFileSync(askArgs[i + 1], "utf-8");
      } catch {
        printColored(`Cannot read file: ${askArgs[i + 1]}\n`, "red");
        process.exit(1);
      }
      i++;
    } else {
      question = askArgs[i];
    }
  }

  if (!question) {
    printColored("Please provide a question.\n", "red");
    printColored('Usage: free-ai ask "your question"\n', "dim");
    process.exit(1);
  }

  const prompt = fileContent
    ? `Context:\n\`\`\`\n${fileContent}\n\`\`\`\n\nQuestion: ${question}`
    : question;

  printColored("⏳ Asking free AI...\n\n", "dim");

  try {
    const result = await askAI(prompt);
    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
    console.log(result.text);
    console.log();
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
    process.exit(1);
  }
}

async function handleReview() {
  const filePath = args[1];
  if (!filePath) {
    printColored("Please provide a file path.\n", "red");
    printColored("Usage: free-ai review <file>\n", "dim");
    process.exit(1);
  }

  let code;
  try {
    code = readFileSync(filePath, "utf-8");
  } catch {
    printColored(`Cannot read file: ${filePath}\n`, "red");
    process.exit(1);
  }

  const ext = filePath.split(".").pop();
  const langMap = {
    rb: "ruby", js: "javascript", ts: "typescript", py: "python",
    jsx: "jsx", tsx: "tsx", go: "go", rs: "rust", java: "java",
    erb: "erb", html: "html", css: "css", sql: "sql",
  };
  const lang = langMap[ext] || ext;

  const prompt = `Review the following ${lang} code from file "${filePath}". Check for:\n1. Bugs or logic errors\n2. Security vulnerabilities\n3. Performance issues\n4. Best practice improvements\n\nBe concise — only mention real issues.\n\n\`\`\`${lang}\n${code}\n\`\`\``;

  printColored(`⏳ Reviewing ${filePath}...\n\n`, "dim");

  try {
    const result = await askAI(prompt);
    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
    console.log(result.text);
    console.log();
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
    process.exit(1);
  }
}

function handleStatus() {
  const status = getProviderStatus();
  console.log("\nFree AI Providers:\n");
  for (const p of status) {
    const icon = p.configured ? "✓" : "✗";
    const color = p.configured ? "green" : "red";
    printColored(`  ${icon} `, color);
    printColored(`${p.label}`, "bold");
    printColored(` (${p.model})\n`, "dim");
    printColored(`    ${p.freeInfo}\n`, "dim");
  }
  console.log();

  const configured = status.filter((p) => p.configured).length;
  if (configured === 0) {
    printColored(
      "  No providers configured! Add API keys to .env file.\n\n",
      "yellow"
    );
  } else {
    printColored(
      `  ${configured}/${status.length} providers active\n\n`,
      "green"
    );
  }
}

switch (command) {
  case "ask":
    await handleAsk();
    break;
  case "review":
    await handleReview();
    break;
  case "status":
    handleStatus();
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(HELP);
    break;
  default:
    printColored(`Unknown command: ${command}\n`, "red");
    console.log(HELP);
    process.exit(1);
}
