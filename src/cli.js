#!/usr/bin/env node

import { askAI, getProviderStatus } from "./router.js";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, extname, basename, dirname } from "path";
import { createInterface } from "readline";

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
free-ai — Free AI coding agent with file read/edit capabilities

Usage:
  free-ai                                Start interactive chat mode
  free-ai chat                           Start interactive chat mode
  free-ai ask "your question here"       Ask a coding question
  free-ai ask -f <file> "question"       Ask with file context
  free-ai edit <file> "instruction"      Edit a file with AI
  free-ai explain <file>                 Explain a code file
  free-ai review <file>                  Review a code file for issues
  free-ai generate <file> "instruction"  Generate a new file with AI
  free-ai status                         Show configured providers
  free-ai help                           Show this help

Interactive mode commands:
  Just type naturally:
    "edit app/models/user.rb add email validation"
    "explain app/controllers/sales_controller.rb"
    "review app/views/sales/_form.html.erb"
    "create app/services/stock_alert.rb service that checks low stock"
    "read app/models/product.rb"
    "what is the best way to add pagination in Rails?"

  Special commands:
    /status    Show provider status
    /help      Show help
    /exit      Exit chat

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
    return null;
  }
  try {
    return readFileSync(resolved, "utf-8");
  } catch {
    printColored(`Cannot read file: ${filePath}\n`, "red");
    return null;
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

function findFilePath(input) {
  const patterns = [
    /(?:^|\s)([\w./-]+\.(?:rb|js|ts|py|jsx|tsx|erb|html|css|sql|yml|yaml|json|go|rs|java|vue|svelte|sh|rake|md))\b/,
    /(?:^|\s)([\w./-]+\/[\w.-]+)\b/,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// --- Core operations (shared by CLI commands and chat) ---

async function doEdit(filePath, instruction) {
  const code = readFile(filePath);
  if (code === null) return;

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

    const oldLines = code.split("\n").length;
    const newLines = newCode.split("\n").length;
    const diff = newLines - oldLines;
    printColored(`  File: ${filePath}\n`, "bold");
    printColored(`  Lines: ${oldLines} → ${newLines}`, "dim");
    if (diff > 0) printColored(` (+${diff})`, "green");
    else if (diff < 0) printColored(` (${diff})`, "red");
    console.log("\n");

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
  }
}

async function doExplain(filePath) {
  const code = readFile(filePath);
  if (code === null) return;

  const lang = getLang(filePath);
  const prompt = `Explain the following ${lang} code from file "${filePath}". Cover:
1. What the file does (purpose)
2. Key functions/methods and what they do
3. Important patterns or design decisions

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
  }
}

async function doReview(filePath) {
  const code = readFile(filePath);
  if (code === null) return;

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
  }
}

async function doRead(filePath) {
  const code = readFile(filePath);
  if (code === null) return;

  const lang = getLang(filePath);
  const lines = code.split("\n");
  printColored(`\n  ${filePath} (${lang}, ${lines.length} lines)\n\n`, "bold");
  lines.forEach((l, i) => {
    printColored(`  ${String(i + 1).padStart(4)} `, "dim");
    console.log(l);
  });
  console.log();
}

async function doGenerate(filePath, instruction) {
  if (existsSync(resolve(filePath))) {
    printColored(`File already exists: ${filePath}. Use "edit" instead.\n`, "red");
    return;
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
  }
}

async function doAsk(question, fileContext) {
  const prompt = fileContext
    ? `Context:\n\`\`\`\n${fileContext}\n\`\`\`\n\nQuestion: ${question}`
    : question;

  printColored("⏳ Thinking...\n\n", "dim");

  try {
    const result = await askAI(prompt, { context: chatHistory });
    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
    console.log(result.text);
    console.log();

    // Add to conversation history
    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: result.text });

    // Keep history manageable
    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(-14);
    }
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
  }
}

// --- Conversation history for chat mode ---
let chatHistory = [];

// --- Interactive Chat Mode ---

async function startChat() {
  const cwd = process.cwd();
  const projectName = basename(cwd);

  console.log();
  printColored("╔══════════════════════════════════════════════╗\n", "cyan");
  printColored("║        free-ai — AI Coding Agent            ║\n", "cyan");
  printColored("╚══════════════════════════════════════════════╝\n", "cyan");
  console.log();
  printColored(`  Project: ${cwd}\n`, "dim");

  const active = getProviderStatus().filter((p) => p.configured);
  if (active.length === 0) {
    printColored("\n  ⚠ No providers configured! Add API keys to .env\n", "yellow");
    printColored("  Run: free-ai status\n\n", "dim");
    process.exit(1);
  }
  printColored(`  Providers: ${active.map((p) => p.label).join(", ")}\n`, "dim");

  console.log();
  printColored("  Type naturally — I can read, edit, review, and generate code.\n", "dim");
  printColored("  Commands: /status /help /clear /exit\n", "dim");
  console.log();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  });

  function showPrompt() {
    printColored(`${projectName}`, "green");
    printColored(` > `, "dim");
  }

  showPrompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      showPrompt();
      return;
    }

    // Slash commands
    if (input === "/exit" || input === "/quit" || input === "/q") {
      printColored("\n  Goodbye!\n\n", "cyan");
      process.exit(0);
    }
    if (input === "/help") {
      console.log(HELP);
      showPrompt();
      return;
    }
    if (input === "/status") {
      handleStatus();
      showPrompt();
      return;
    }
    if (input === "/clear") {
      chatHistory = [];
      printColored("  Conversation cleared.\n\n", "dim");
      showPrompt();
      return;
    }

    // Parse intent from natural language
    const lowerInput = input.toLowerCase();
    const filePath = findFilePath(input);

    // Edit: "edit <file> <instruction>"
    if (lowerInput.startsWith("edit ") && filePath) {
      const instruction = input.replace(/^edit\s+/i, "").replace(filePath, "").trim();
      if (instruction) {
        await doEdit(filePath, instruction);
      } else {
        printColored('  What changes? e.g., edit app/models/user.rb "add email validation"\n\n', "yellow");
      }
    }
    // Review: "review <file>"
    else if (lowerInput.startsWith("review ") && filePath) {
      await doReview(filePath);
    }
    // Explain: "explain <file>"
    else if (lowerInput.startsWith("explain ") && filePath) {
      await doExplain(filePath);
    }
    // Read: "read <file>" or "show <file>" or "cat <file>"
    else if ((lowerInput.startsWith("read ") || lowerInput.startsWith("show ") || lowerInput.startsWith("cat ")) && filePath) {
      await doRead(filePath);
    }
    // Create/Generate: "create <file> <instruction>" or "generate <file> <instruction>"
    else if ((lowerInput.startsWith("create ") || lowerInput.startsWith("generate ")) && filePath) {
      const instruction = input.replace(/^(?:create|generate)\s+/i, "").replace(filePath, "").trim();
      if (instruction) {
        await doGenerate(filePath, instruction);
      } else {
        printColored('  What should the file contain? e.g., create app/models/invoice.rb "model with validations"\n\n', "yellow");
      }
    }
    // If input has a file path + instruction, treat as edit
    else if (filePath && existsSync(resolve(filePath)) && input.replace(filePath, "").trim().length > 5) {
      const instruction = input.replace(filePath, "").trim();
      await doEdit(filePath, instruction);
    }
    // Default: ask as a question
    else {
      let fileContext = null;
      // If a file is mentioned, include its content as context
      if (filePath && existsSync(resolve(filePath))) {
        fileContext = readFileSync(resolve(filePath), "utf-8");
      }
      await doAsk(input, fileContext);
    }

    showPrompt();
  });

  rl.on("close", () => {
    printColored("\n  Goodbye!\n\n", "cyan");
    process.exit(0);
  });
}

// --- One-shot CLI command handlers (call shared functions) ---

async function handleAsk() {
  let fileContent = null;
  let question = null;
  const askArgs = args.slice(1);

  for (let i = 0; i < askArgs.length; i++) {
    if (askArgs[i] === "-f" && askArgs[i + 1]) {
      const f = readFile(askArgs[i + 1]);
      if (f === null) process.exit(1);
      fileContent = f;
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

  await doAsk(question, fileContent);
}

async function handleEdit() {
  const filePath = args[1];
  const instruction = args[2];
  if (!filePath || !instruction) {
    printColored("Please provide a file and instruction.\n", "red");
    printColored('Usage: free-ai edit <file> "instruction"\n', "dim");
    process.exit(1);
  }
  await doEdit(filePath, instruction);
}

async function handleExplain() {
  const filePath = args[1];
  if (!filePath) {
    printColored("Please provide a file path.\n", "red");
    printColored("Usage: free-ai explain <file>\n", "dim");
    process.exit(1);
  }
  await doExplain(filePath);
}

async function handleReview() {
  const filePath = args[1];
  if (!filePath) {
    printColored("Please provide a file path.\n", "red");
    printColored("Usage: free-ai review <file>\n", "dim");
    process.exit(1);
  }
  await doReview(filePath);
}

async function handleGenerate() {
  const filePath = args[1];
  const instruction = args[2];
  if (!filePath || !instruction) {
    printColored("Please provide a file path and instruction.\n", "red");
    printColored('Usage: free-ai generate <file> "instruction"\n', "dim");
    process.exit(1);
  }
  await doGenerate(filePath, instruction);
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

// --- Main ---

switch (command) {
  case "chat":
  case undefined:
    await startChat();
    break;
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
    console.log(HELP);
    break;
  default:
    printColored(`Unknown command: ${command}\n`, "red");
    console.log(HELP);
    process.exit(1);
}
