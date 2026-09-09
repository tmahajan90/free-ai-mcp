#!/usr/bin/env node

import { askAI, getProviderStatus } from "./router.js";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, extname } from "path";
import { createInterface } from "readline";

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
free-ai — Free AI coding agent with file read/edit capabilities

Usage:
  free-ai ask "your question here"       Ask a coding question
  free-ai ask -f <file> "question"       Ask with file context
  free-ai edit <file> "instruction"      Edit a file with AI
  free-ai explain <file>                 Explain a code file
  free-ai review <file>                  Review a code file for issues
  free-ai generate <file> "instruction"  Generate a new file with AI
  free-ai status                         Show configured providers
  free-ai help                           Show this help

Examples:
  free-ai ask "how to add pagination in Rails"
  free-ai edit app/models/user.rb "add email validation"
  free-ai edit src/index.js "add error handling to the fetch call"
  free-ai explain app/controllers/sales_controller.rb
  free-ai review app/views/sales/_form.html.erb
  free-ai generate app/models/invoice.rb "Rails model with validations for invoice"

Providers are tried in order. If one is rate-limited, the next is used.
Configure API keys in: .env file
`;

const LANG_MAP = {
  rb: "ruby", js: "javascript", ts: "typescript", py: "python",
  jsx: "jsx", tsx: "tsx", go: "go", rs: "rust", java: "java",
  erb: "erb", html: "html", css: "css", sql: "sql", sh: "bash",
  yml: "yaml", yaml: "yaml", json: "json", md: "markdown",
  rake: "ruby", gemspec: "ruby", vue: "vue", svelte: "svelte",
};

function getLang(filePath) {
  const ext = filePath.split(".").pop();
  return LANG_MAP[ext] || ext;
}

function printColored(text, color) {
  const colors = {
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    magenta: "\x1b[35m",
  };
  process.stdout.write(`${colors[color] || ""}${text}${colors.reset}`);
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

function readFile(filePath) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    printColored(`File not found: ${filePath}\n`, "red");
    process.exit(1);
  }
  try {
    return readFileSync(resolved, "utf-8");
  } catch {
    printColored(`Cannot read file: ${filePath}\n`, "red");
    process.exit(1);
  }
}

function extractCodeBlock(text) {
  const match = text.match(/```[\w]*\n([\s\S]*?)```/);
  if (match) return match[1].trimEnd() + "\n";

  const lines = text.split("\n");
  const codeStart = lines.findIndex(
    (l) => !l.startsWith("Here") && !l.startsWith("I ") && !l.startsWith("The ") && l.trim().length > 0
  );
  if (codeStart >= 0) {
    return lines.slice(codeStart).join("\n").trimEnd() + "\n";
  }
  return text;
}

// --- Commands ---

async function handleAsk() {
  let fileContent = null;
  let question = null;
  const askArgs = args.slice(1);

  for (let i = 0; i < askArgs.length; i++) {
    if (askArgs[i] === "-f" && askArgs[i + 1]) {
      fileContent = readFile(askArgs[i + 1]);
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

async function handleEdit() {
  const filePath = args[1];
  const instruction = args[2];

  if (!filePath || !instruction) {
    printColored("Please provide a file and instruction.\n", "red");
    printColored('Usage: free-ai edit <file> "instruction"\n', "dim");
    process.exit(1);
  }

  const code = readFile(filePath);
  const lang = getLang(filePath);

  const prompt = `You are editing the file "${filePath}" (${lang}).

Here is the current content of the file:
\`\`\`${lang}
${code}
\`\`\`

Instruction: ${instruction}

Return ONLY the complete updated file content inside a single code block. Do not include explanations before or after the code block. Do not omit any parts of the file — return the full file even if only a small part changed.`;

  printColored(`⏳ Editing ${filePath}...\n\n`, "dim");

  try {
    const result = await askAI(prompt);
    const newCode = extractCodeBlock(result.text);

    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");

    // Show diff summary
    const oldLines = code.split("\n").length;
    const newLines = newCode.split("\n").length;
    const diff = newLines - oldLines;
    printColored(`  File: ${filePath}\n`, "bold");
    printColored(`  Lines: ${oldLines} → ${newLines}`, "dim");
    if (diff > 0) printColored(` (+${diff})`, "green");
    else if (diff < 0) printColored(` (${diff})`, "red");
    console.log("\n");

    // Show what changed
    const oldSet = new Set(code.split("\n"));
    const newSet = new Set(newCode.split("\n"));
    const added = newCode.split("\n").filter((l) => !oldSet.has(l));
    const removed = code.split("\n").filter((l) => !newSet.has(l));

    if (removed.length > 0) {
      printColored("  Removed:\n", "red");
      removed.slice(0, 15).forEach((l) => printColored(`  - ${l}\n`, "red"));
      if (removed.length > 15) printColored(`  ... and ${removed.length - 15} more\n`, "dim");
      console.log();
    }
    if (added.length > 0) {
      printColored("  Added:\n", "green");
      added.slice(0, 15).forEach((l) => printColored(`  + ${l}\n`, "green"));
      if (added.length > 15) printColored(`  ... and ${added.length - 15} more\n`, "dim");
      console.log();
    }

    if (added.length === 0 && removed.length === 0) {
      printColored("  No changes detected.\n\n", "yellow");
      return;
    }

    const ok = await confirm("  Apply changes? (y/n) ");
    if (ok) {
      writeFileSync(resolve(filePath), newCode);
      printColored(`\n  ✓ Saved ${filePath}\n\n`, "green");
    } else {
      printColored("\n  ✗ Changes discarded.\n\n", "yellow");
    }
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
    process.exit(1);
  }
}

async function handleExplain() {
  const filePath = args[1];
  if (!filePath) {
    printColored("Please provide a file path.\n", "red");
    printColored("Usage: free-ai explain <file>\n", "dim");
    process.exit(1);
  }

  const code = readFile(filePath);
  const lang = getLang(filePath);

  const prompt = `Explain the following ${lang} code from file "${filePath}". Cover:
1. What the file does (purpose)
2. Key functions/methods and what they do
3. Important patterns or design decisions
4. Dependencies or connections to other parts of the codebase

Be concise but thorough.

\`\`\`${lang}
${code}
\`\`\``;

  printColored(`⏳ Explaining ${filePath}...\n\n`, "dim");

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

  const code = readFile(filePath);
  const lang = getLang(filePath);

  const prompt = `Review the following ${lang} code from file "${filePath}". Check for:
1. Bugs or logic errors
2. Security vulnerabilities
3. Performance issues
4. Best practice improvements

Be concise — only mention real issues.

\`\`\`${lang}
${code}
\`\`\``;

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

async function handleGenerate() {
  const filePath = args[1];
  const instruction = args[2];

  if (!filePath || !instruction) {
    printColored("Please provide a file path and instruction.\n", "red");
    printColored('Usage: free-ai generate <file> "instruction"\n', "dim");
    process.exit(1);
  }

  if (existsSync(resolve(filePath))) {
    printColored(`File already exists: ${filePath}\n`, "red");
    printColored('Use "free-ai edit" to modify existing files.\n', "dim");
    process.exit(1);
  }

  const lang = getLang(filePath);

  const prompt = `Generate the content for a new ${lang} file at "${filePath}".

Instruction: ${instruction}

Return ONLY the file content inside a single code block. No explanations before or after.`;

  printColored(`⏳ Generating ${filePath}...\n\n`, "dim");

  try {
    const result = await askAI(prompt);
    const newCode = extractCodeBlock(result.text);

    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
    printColored("  Preview:\n", "bold");

    const lines = newCode.split("\n");
    lines.slice(0, 25).forEach((l, i) => {
      printColored(`  ${String(i + 1).padStart(3)} `, "dim");
      console.log(l);
    });
    if (lines.length > 25) printColored(`  ... (${lines.length - 25} more lines)\n`, "dim");
    console.log();

    const ok = await confirm("  Create this file? (y/n) ");
    if (ok) {
      writeFileSync(resolve(filePath), newCode);
      printColored(`\n  ✓ Created ${filePath}\n\n`, "green");
    } else {
      printColored("\n  ✗ File not created.\n\n", "yellow");
    }
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
  case "edit":
    await handleEdit();
    break;
  case "explain":
    await handleExplain();
    break;
  case "review":
    await handleReview();
    break;
  case "generate":
    await handleGenerate();
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
