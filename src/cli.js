#!/usr/bin/env node

import { askAI, getProviderStatus, getUsageStats } from "./router.js";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { resolve, join, extname, basename, dirname, relative } from "path";
import { createInterface } from "readline";
import { homedir } from "os";

const { execSync } = await import("child_process");

const args = process.argv.slice(2);

// If first arg is a directory path, use it as the project directory
let command = args[0];
if (command && !["chat","ask","edit","explain","review","generate","scan","status","help","--help","-h"].includes(command)) {
  const tryPath = resolve(expandPathEarly(command));
  if (existsSync(tryPath) && statSync(tryPath).isDirectory()) {
    process.chdir(tryPath);
    command = args[1] || undefined;
  }
}

function expandPathEarly(p) {
  if (p && p.startsWith("~")) {
    return p.replace("~", process.env.HOME || "/Users/" + process.env.USER);
  }
  return p || "";
}

const HELP = `
free-ai — Free AI coding agent (like Claude Code, but free)

Usage:
  free-ai                                Start in current directory
  free-ai <project-path>                 Start in a specific project
  free-ai chat                           Start interactive chat mode
  free-ai ask "your question here"       Ask a coding question
  free-ai ask -f <file> "question"       Ask with file context
  free-ai edit <file> "instruction"      Edit a file with AI
  free-ai explain <file>                 Explain a code file
  free-ai review <file>                  Review a code file for issues
  free-ai generate <file> "instruction"  Generate a new file with AI
  free-ai scan [dir]                     Scan project/directory structure
  free-ai status                         Show configured providers
  free-ai help                           Show this help

Interactive mode — type naturally:
  Edit files:
    "edit app/models/user.rb add email validation"
    "add pagination to app/controllers/products_controller.rb"
    "remove the header from app/views/layouts/application.html.erb"

  Multi-file edits:
    "add a name column to users"     Plans & edits migration + model + views
    "add a search feature"           AI plans which files to create/edit

  Auto-fix:
    fix                              Runs tests, reads errors, fixes code
    fix bundle exec rails test       Custom test command
    fix npm test                     Works with any test runner

  Search & explore:
    grep validates app/models        Search for text across files
    search "def create"              Same as grep
    find TODO                        Find all TODOs in project
    read app/models/product.rb       Read file with line numbers
    ls app/models                    List directory
    scan app/controllers             Deep scan directory

  Shell & Git:
    !bundle exec rails test          Run any shell command
    run npm install                   Same as ! prefix
    git status                        Git commands run directly
    commit                            AI writes commit message, you confirm

  Image (Gemini vision):
    image screenshot.png              Describe a screenshot
    image mockup.png build this UI    Ask AI to implement from a screenshot

  Ask questions:
    "what is the best way to add pagination in Rails?"
    "how does the auth flow work in this project?"

  Commands:
    /scan      Scan project structure
    /ls [dir]  List files
    /grep      Search across files
    /status    Show provider status + usage stats
    /undo      Undo last file edit
    /diff      Show session changes & git diff
    /commit    Smart commit with AI message
    /help      Show help
    /clear     Clear conversation + history
    /exit      Exit chat (history saved for next session)

Features:
  - Tab completion for file paths
  - Streaming responses (tokens appear as AI generates them)
  - Conversation resumes across sessions
  - Auto-retry with next provider if AI gives bad response
  - Usage tracking per provider (see /status)
  - Image analysis via Gemini vision (free)

Project memory: Create .free-ai.md in your project root with context
  like "This is a Rails 8 app using Tailwind v4" and the AI always knows it.

Edit engine uses SEARCH/REPLACE blocks (like Claude Code) for precise changes.
Providers are tried in order. If one gives a bad response, the next is tried.
`;

const LANG_MAP = {
  rb: "ruby", js: "javascript", ts: "typescript", py: "python",
  jsx: "jsx", tsx: "tsx", go: "go", rs: "rust", java: "java",
  erb: "erb", html: "html", css: "css", sql: "sql", sh: "bash",
  yml: "yaml", yaml: "yaml", json: "json", md: "markdown",
  rake: "ruby", gemspec: "ruby", vue: "vue", svelte: "svelte",
};

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "vendor", "tmp", "log", ".bundle",
  "coverage", "dist", "build", ".next", "__pycache__", ".cache",
  "storage", "public/assets", "public/packs", ".DS_Store",
]);

const IGNORE_EXTS = new Set([
  ".lock", ".map", ".min.js", ".min.css", ".ico", ".png",
  ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".ttf", ".eot",
]);

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

function expandPath(p) {
  if (p.startsWith("~")) {
    return p.replace("~", process.env.HOME || "/Users/" + process.env.USER);
  }
  return p;
}

function readFile(filePath) {
  const resolved = resolve(expandPath(filePath));
  if (!existsSync(resolved)) {
    printColored(`File not found: ${resolved}\n`, "red");
    printColored(`  (input: ${filePath}, cwd: ${process.cwd()})\n`, "dim");
    return null;
  }
  if (statSync(resolved).isDirectory()) {
    printColored(`Path is a directory: ${resolved}\n`, "yellow");
    printColored(`  Use "ls ${filePath}" or "scan ${filePath}" to see contents.\n`, "dim");
    return null;
  }
  try {
    return readFileSync(resolved, "utf-8");
  } catch (err) {
    printColored(`Cannot read file: ${resolved}\n`, "red");
    printColored(`  ${err.message}\n`, "dim");
    return null;
  }
}

function extractCodeBlock(text) {
  // Try to find the largest code block (AI sometimes returns multiple)
  const allBlocks = [...text.matchAll(/```[\w]*\n([\s\S]*?)```/g)];
  if (allBlocks.length > 0) {
    // Pick the largest code block — that's the full file
    let largest = allBlocks[0][1];
    for (const block of allBlocks) {
      if (block[1].length > largest.length) largest = block[1];
    }
    return largest.trimEnd() + "\n";
  }

  // No code block found — try to extract code by removing explanation lines
  const lines = text.split("\n");
  const codeLines = [];
  let inCode = false;
  for (const line of lines) {
    // Skip common explanation prefixes
    if (!inCode && /^(Here|I |The |This |Note|Above|Below|Let me|Sure|Okay|I've|I have|##|###|\*\*)/.test(line)) continue;
    inCode = true;
    codeLines.push(line);
  }

  if (codeLines.length > 0) {
    return codeLines.join("\n").trimEnd() + "\n";
  }
  return text;
}

function findPath(input) {
  const patterns = [
    // Absolute paths with extension
    /(?:^|\s)(\/[\w./-]+\.(?:rb|js|ts|py|jsx|tsx|erb|html|css|sql|yml|yaml|json|go|rs|java|vue|svelte|sh|rake|md))\b/,
    // Relative paths with extension
    /(?:^|\s)(\.{0,2}[\w./-]+\.(?:rb|js|ts|py|jsx|tsx|erb|html|css|sql|yml|yaml|json|go|rs|java|vue|svelte|sh|rake|md))\b/,
    // ~ paths with extension
    /(?:^|\s)(~[\w./-]+\.(?:rb|js|ts|py|jsx|tsx|erb|html|css|sql|yml|yaml|json|go|rs|java|vue|svelte|sh|rake|md))\b/,
    // Absolute directory paths (e.g., /Users/tarun/project/app/models)
    /(?:^|\s)(\/[\w./-]+\/[\w.-]+)\b/,
    // Relative directory paths (e.g., app/models, app/controllers)
    /(?:^|\s)([\w.-]+\/[\w./-]*[\w.-]+)\b/,
    // ~ directory paths
    /(?:^|\s)(~\/[\w./-]+)\b/,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return expandPath(match[1]);
    }
  }
  return null;
}

function isDirectory(p) {
  const resolved = resolve(expandPath(p));
  return existsSync(resolved) && statSync(resolved).isDirectory();
}

function isFile(p) {
  const resolved = resolve(expandPath(p));
  return existsSync(resolved) && statSync(resolved).isFile();
}

// --- Directory scanning ---

function scanDir(dirPath, prefix = "", maxDepth = 4, depth = 0) {
  if (depth >= maxDepth) return [];
  const resolved = resolve(expandPath(dirPath));
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) return [];

  const entries = [];
  try {
    const items = readdirSync(resolved).sort();
    for (const item of items) {
      if (IGNORE_DIRS.has(item) || item.startsWith(".")) continue;
      const fullPath = join(resolved, item);
      const relPath = join(dirPath, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        entries.push({ type: "dir", path: relPath, name: item });
        entries.push(...scanDir(relPath, prefix, maxDepth, depth + 1));
      } else if (stat.isFile()) {
        const ext = extname(item);
        if (IGNORE_EXTS.has(ext)) continue;
        entries.push({ type: "file", path: relPath, name: item, size: stat.size });
      }
    }
  } catch {}
  return entries;
}

function doScan(dirPath) {
  const resolved = resolve(expandPath(dirPath || "."));
  if (!existsSync(resolved)) {
    printColored(`Directory not found: ${resolved}\n`, "red");
    return null;
  }
  if (!statSync(resolved).isDirectory()) {
    printColored(`Not a directory: ${resolved}\n`, "red");
    return null;
  }

  const entries = scanDir(dirPath || ".");
  const dirs = entries.filter((e) => e.type === "dir");
  const files = entries.filter((e) => e.type === "file");

  printColored(`\n  📁 ${resolved}\n`, "bold");
  printColored(`  ${dirs.length} directories, ${files.length} files\n\n`, "dim");

  // Show tree
  let lastDir = "";
  for (const entry of entries) {
    const parts = entry.path.split("/");
    const indent = "  ".repeat(Math.min(parts.length, 6));

    if (entry.type === "dir") {
      printColored(`${indent}📁 ${entry.name}/\n`, "cyan");
      lastDir = entry.path;
    } else {
      const sizeKb = (entry.size / 1024).toFixed(1);
      printColored(`${indent}  ${entry.name}`, "dim");
      if (entry.size > 10240) {
        printColored(` (${sizeKb}KB)`, "yellow");
      }
      console.log();
    }
  }
  console.log();

  // Return as context string for AI
  const tree = entries.map((e) =>
    e.type === "dir" ? `${e.path}/` : e.path
  ).join("\n");
  return tree;
}

function doLs(dirPath) {
  const resolved = resolve(expandPath(dirPath || "."));
  if (!existsSync(resolved)) {
    printColored(`Directory not found: ${resolved}\n`, "red");
    return;
  }
  if (!statSync(resolved).isDirectory()) {
    printColored(`Not a directory: ${resolved}\n`, "red");
    return;
  }

  try {
    const items = readdirSync(resolved).sort();
    printColored(`\n  ${resolved}\n\n`, "bold");
    for (const item of items) {
      if (item.startsWith(".")) continue;
      const fullPath = join(resolved, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        printColored(`  📁 ${item}/\n`, "cyan");
      } else {
        printColored(`     ${item}\n`, "dim");
      }
    }
    console.log();
  } catch {
    printColored(`Cannot read directory: ${resolved}\n`, "red");
  }
}

// --- Project memory (.free-ai.md) ---

function loadProjectMemory() {
  const paths = [
    join(process.cwd(), ".free-ai.md"),
    join(process.cwd(), ".free-ai"),
    join(process.env.HOME || "", ".free-ai.md"),
  ];
  for (const p of paths) {
    if (existsSync(p) && !statSync(p).isDirectory()) {
      try {
        return readFileSync(p, "utf-8").trim();
      } catch { }
    }
  }
  return null;
}

const projectMemory = loadProjectMemory();

// --- Session tracking ---

const sessionEdits = [];
const sessionReads = new Set();

function trackEdit(filePath) {
  sessionEdits.push({ file: filePath, time: new Date().toLocaleTimeString() });
}

function trackRead(filePath) {
  sessionReads.add(filePath);
}

function getRecentContext() {
  const parts = [];
  if (sessionEdits.length > 0) {
    parts.push(`Recently edited: ${sessionEdits.slice(-5).map(e => e.file).join(", ")}`);
  }
  if (sessionReads.size > 0) {
    parts.push(`Recently read: ${[...sessionReads].slice(-5).join(", ")}`);
  }
  return parts.join("\n");
}

// --- Conversation persistence ---

const HISTORY_FILE = join(process.cwd(), ".free-ai-history.json");

function loadChatHistory() {
  try {
    if (existsSync(HISTORY_FILE) && !statSync(HISTORY_FILE).isDirectory()) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
      if (Array.isArray(data)) return data.slice(-20);
    }
  } catch {}
  return [];
}

function saveChatHistory(history) {
  try {
    writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-20), null, 2));
  } catch {}
}

// --- Image support (Gemini vision) ---

function loadImage(imagePath) {
  const resolved = resolve(expandPath(imagePath));
  if (!existsSync(resolved)) {
    printColored(`Image not found: ${resolved}\n`, "red");
    return null;
  }

  try {
    const data = readFileSync(resolved);
    const base64 = data.toString("base64");

    const ext = extname(imagePath).toLowerCase();
    const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
    const mimeType = mimeMap[ext] || "image/png";

    return [{ inlineData: { mimeType, data: base64 } }];
  } catch (err) {
    printColored(`Cannot read image: ${err.message}\n`, "red");
    return null;
  }
}

// --- File path autocomplete ---

function fileCompleter(line) {
  // Get the last word being typed
  const words = line.split(/\s+/);
  const partial = words[words.length - 1] || "";

  if (!partial || partial.startsWith("-")) return [[], line];

  const expanded = expandPath(partial);
  const dir = expanded.includes("/") ? dirname(expanded) : ".";
  const prefix = expanded.includes("/") ? basename(expanded) : expanded;

  try {
    const resolved = resolve(dir);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) return [[], line];

    const items = readdirSync(resolved).filter(i => !i.startsWith(".") && !IGNORE_DIRS.has(i));
    const matches = items
      .filter(i => i.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(i => {
        const full = join(dir, i);
        const resolvedFull = resolve(full);
        const isDir = existsSync(resolvedFull) && statSync(resolvedFull).isDirectory();
        return isDir ? full + "/" : full;
      });

    if (matches.length === 0) return [[], line];

    // Replace last word with matches
    const lineWithoutLast = words.slice(0, -1).join(" ");
    const completions = matches.map(m => lineWithoutLast ? `${lineWithoutLast} ${m}` : m);
    return [completions, line];
  } catch {
    return [[], line];
  }
}

// --- Shell command execution ---

function doRun(cmd) {
  printColored(`  $ ${cmd}\n\n`, "dim");
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 60000, cwd: process.cwd() });
    if (output.trim()) console.log(output);
    return output;
  } catch (err) {
    const errOutput = (err.stdout || "") + (err.stderr || "");
    if (errOutput.trim()) console.log(errOutput);
    else printColored(`  Exit code: ${err.status}\n`, "red");
    return errOutput || null;
  }
}

// --- Grep / Search ---

function doGrep(pattern, searchPath) {
  const dir = resolve(expandPath(searchPath || "."));
  if (!existsSync(dir)) {
    printColored(`Path not found: ${dir}\n`, "red");
    return null;
  }

  printColored(`  Searching for "${pattern}" in ${searchPath || "."}...\n\n`, "dim");

  try {
    const output = execSync(
      `grep -rn --include='*.rb' --include='*.js' --include='*.ts' --include='*.jsx' --include='*.tsx' --include='*.py' --include='*.go' --include='*.java' --include='*.erb' --include='*.html' --include='*.css' --include='*.yml' --include='*.yaml' --include='*.json' --include='*.vue' --include='*.svelte' --include='*.sql' --include='*.sh' --color=never "${pattern.replace(/"/g, '\\"')}" "${dir}" 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 15000 }
    );

    if (!output.trim()) {
      printColored(`  No results found for "${pattern}"\n\n`, "yellow");
      return null;
    }

    const lines = output.trim().split("\n");
    const cwd = process.cwd();
    let shown = 0;
    for (const line of lines) {
      if (shown >= 50) {
        printColored(`  ... and ${lines.length - 50} more results\n`, "dim");
        break;
      }
      const display = line.startsWith(cwd) ? line.slice(cwd.length + 1) : line;
      const colonIdx = display.indexOf(":");
      const secondColon = display.indexOf(":", colonIdx + 1);
      if (colonIdx > 0 && secondColon > 0) {
        printColored(`  ${display.slice(0, secondColon)}`, "cyan");
        console.log(display.slice(secondColon));
      } else {
        console.log(`  ${display}`);
      }
      shown++;
    }
    console.log();
    printColored(`  ${lines.length} result(s)\n\n`, "dim");
    return output;
  } catch {
    printColored("  Search failed.\n\n", "red");
    return null;
  }
}

// --- Diff (session changes) ---

function doDiff(filePath) {
  if (filePath) {
    printColored(`  Changes to ${filePath}:\n\n`, "bold");
    try {
      const output = execSync(`git diff "${resolve(expandPath(filePath))}" 2>/dev/null || true`, { encoding: "utf-8" });
      if (output.trim()) {
        for (const line of output.split("\n")) {
          if (line.startsWith("+") && !line.startsWith("+++")) printColored(`  ${line}\n`, "green");
          else if (line.startsWith("-") && !line.startsWith("---")) printColored(`  ${line}\n`, "red");
          else printColored(`  ${line}\n`, "dim");
        }
      } else {
        printColored("  No uncommitted changes.\n", "dim");
      }
    } catch {
      printColored("  Not a git repo or git not available.\n", "yellow");
    }
  } else {
    printColored("  Session changes:\n\n", "bold");
    if (sessionEdits.length === 0) {
      printColored("  No files edited this session.\n", "dim");
    } else {
      for (const e of sessionEdits) {
        printColored(`  ${e.time}  `, "dim");
        printColored(`${e.file}\n`, "cyan");
      }
    }
    console.log();
    try {
      const output = execSync("git diff --stat 2>/dev/null || true", { encoding: "utf-8" });
      if (output.trim()) {
        printColored("  Git diff:\n", "bold");
        console.log(output);
      }
    } catch { }
  }
  console.log();
}

// --- Smart commit ---

async function doCommit() {
  printColored("  Checking changes...\n\n", "dim");

  let diffOutput;
  try {
    diffOutput = execSync("git diff --cached --stat 2>/dev/null", { encoding: "utf-8" });
    if (!diffOutput.trim()) {
      execSync("git add -A", { encoding: "utf-8" });
      diffOutput = execSync("git diff --cached --stat 2>/dev/null", { encoding: "utf-8" });
    }
  } catch {
    printColored("  Not a git repo.\n\n", "red");
    return;
  }

  if (!diffOutput.trim()) {
    printColored("  Nothing to commit.\n\n", "yellow");
    return;
  }

  printColored("  Staged:\n", "bold");
  console.log(diffOutput);

  let diffDetail;
  try {
    diffDetail = execSync("git diff --cached 2>/dev/null", { encoding: "utf-8" });
  } catch { diffDetail = ""; }

  const truncatedDiff = diffDetail.length > 8000 ? diffDetail.slice(0, 8000) + "\n... (truncated)" : diffDetail;

  const prompt = `Generate a git commit message for these changes.

${truncatedDiff}

Rules:
1. First line: concise summary under 72 chars (imperative mood: "Add...", "Fix...", "Update...")
2. If needed, add a blank line then 1-2 bullet points explaining WHY
3. Return ONLY the commit message, nothing else — no code blocks, no explanation`;

  printColored("  Generating commit message...\n\n", "dim");

  try {
    const result = await askAI(prompt);
    let msg = result.text.trim();
    // Strip code blocks if AI wrapped it
    msg = msg.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();

    printColored(`  [${result.provider}]\n\n`, "cyan");
    printColored("  Commit message:\n", "bold");
    for (const line of msg.split("\n")) {
      printColored(`  ${line}\n`, "green");
    }
    console.log();

    const ok = await confirm("  Commit with this message? (y/n) ");
    if (ok) {
      try {
        execSync(`git commit -m ${JSON.stringify(msg)}`, { encoding: "utf-8" });
        printColored("\n  ✓ Committed.\n\n", "green");
      } catch (err) {
        printColored(`\n  Commit failed: ${err.message}\n\n`, "red");
      }
    } else {
      printColored("\n  ✗ Commit cancelled.\n\n", "yellow");
      execSync("git reset HEAD 2>/dev/null || true", { encoding: "utf-8" });
    }
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
  }
}

// --- Auto-fix loop ---

async function doFix(testCmd) {
  const cmd = testCmd || detectTestCommand();
  if (!cmd) {
    printColored("  Could not detect test command. Usage: fix <test command>\n", "yellow");
    printColored("  Examples: fix bundle exec rails test, fix npm test, fix pytest\n\n", "dim");
    return;
  }

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    printColored(`\n  Attempt ${attempt}/${MAX_ATTEMPTS}: Running tests...\n\n`, "bold");
    const output = doRun(cmd);

    if (!output || output.trim() === "") {
      printColored("  ✓ Tests passed (no output).\n\n", "green");
      return;
    }

    // Check if tests passed
    const lower = output.toLowerCase();
    const passed = (lower.includes("0 failures") && lower.includes("0 errors")) ||
      lower.includes("all tests passed") ||
      lower.includes("tests passed") ||
      (lower.includes("passing") && !lower.includes("failing")) ||
      /\b0 failed\b/.test(lower) ||
      (/passed/.test(lower) && !/failed|error|failure/i.test(lower));

    if (passed) {
      printColored("  ✓ All tests passing!\n\n", "green");
      return;
    }

    printColored(`\n  Tests failed. Asking AI to fix...\n\n`, "yellow");

    // Get project context
    const projectTree = scanDir(".", "", 2);
    const treeContext = projectTree.map(e => e.type === "dir" ? e.path + "/" : e.path).slice(0, 40).join("\n");

    // Truncate test output
    const truncatedOutput = output.length > 6000 ? output.slice(-6000) : output;

    const prompt = `Test command "${cmd}" failed with this output:

\`\`\`
${truncatedOutput}
\`\`\`

Project structure:
${treeContext}

${projectMemory ? `Project context:\n${projectMemory}\n` : ""}

Analyze the error and tell me:
1. Which file(s) need to be fixed (give exact paths)
2. What specific change is needed in each file

For each file, provide SEARCH/REPLACE blocks:

<<<<<<< SEARCH
exact lines from the file
=======
fixed replacement
>>>>>>> REPLACE

If you need to see a file's content first, say "NEED_FILE: <path>" and I'll show it.`;

    try {
      const result = await askAI(prompt);
      printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");

      // Check if AI needs to see files
      const needFiles = [...result.text.matchAll(/NEED_FILE:\s*(\S+)/g)];
      if (needFiles.length > 0) {
        let fileContext = "";
        for (const [, path] of needFiles) {
          const content = readFile(path);
          if (content) {
            fileContext += `\n--- ${path} ---\n\`\`\`\n${content}\n\`\`\`\n`;
          }
        }

        const followUp = `Here are the files you requested:\n${fileContext}\n\nNow provide the SEARCH/REPLACE fixes.`;
        const result2 = await askAI(followUp, { context: [
          { role: "user", content: prompt },
          { role: "assistant", content: result.text },
        ]});
        await applyAIFixes(result2.text);
      } else {
        await applyAIFixes(result.text);
      }
    } catch (err) {
      printColored(`  Error: ${err.message}\n\n`, "red");
      return;
    }
  }

  printColored(`  Reached max attempts (${MAX_ATTEMPTS}). Some tests may still be failing.\n\n`, "yellow");
}

function detectTestCommand() {
  if (existsSync("Gemfile")) return "bundle exec rails test";
  if (existsSync("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
      if (pkg.scripts?.test) return "npm test";
    } catch { }
  }
  if (existsSync("pytest.ini") || existsSync("setup.py") || existsSync("pyproject.toml")) return "pytest";
  if (existsSync("go.mod")) return "go test ./...";
  if (existsSync("Cargo.toml")) return "cargo test";
  return null;
}

async function applyAIFixes(text) {
  // Extract file paths and their search/replace blocks
  const fileBlocks = {};
  let currentFile = null;

  // Try to detect file paths mentioned before search/replace blocks
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const fileMatch = lines[i].match(/(?:File|file|In|in|Edit|edit)[:\s]+[`"']?([^\s`"']+\.\w+)[`"']?/);
    if (fileMatch) currentFile = fileMatch[1];

    if (lines[i].includes("<<<<<<< SEARCH") && currentFile) {
      if (!fileBlocks[currentFile]) fileBlocks[currentFile] = [];
    }
  }

  // Parse all blocks
  const allBlocks = parseSearchReplace(text);

  if (allBlocks.length === 0) {
    console.log(text);
    return;
  }

  // Try to match blocks to files by searching for the search text
  for (const block of allBlocks) {
    let matched = false;
    // Check all project files for this block's search text
    const entries = scanDir(".", "", 3);
    const files = entries.filter(e => e.type === "file" && e.size < 100000);

    for (const f of files) {
      try {
        const content = readFileSync(resolve(f.path), "utf-8");
        if (content.includes(block.search)) {
          if (!fileBlocks[f.path]) fileBlocks[f.path] = [];
          fileBlocks[f.path].push(block);
          matched = true;
          break;
        }
      } catch { }
    }

    if (!matched) {
      printColored(`  ⚠ Could not find file for SEARCH block: ${block.search.split("\n")[0].slice(0, 60)}...\n`, "yellow");
    }
  }

  // Apply fixes to each file
  for (const [filePath, blocks] of Object.entries(fileBlocks)) {
    const code = readFile(filePath);
    if (!code) continue;

    const { result: newCode, applied, failed } = applySearchReplace(code, blocks);

    if (applied.length === 0) {
      printColored(`  ⚠ No changes matched in ${filePath}\n`, "yellow");
      continue;
    }

    printColored(`  ${filePath}: ${applied.length} fix(es)\n`, "bold");
    for (const b of applied) {
      if (b.search.trim()) {
        printColored(`    - ${b.search.split("\n")[0].slice(0, 60)}\n`, "red");
      }
      if (b.replace.trim()) {
        printColored(`    + ${b.replace.split("\n")[0].slice(0, 60)}\n`, "green");
      }
    }

    const ok = await confirm(`  Apply fix to ${filePath}? (y/n) `);
    if (ok) {
      saveUndo(filePath, code);
      writeFileSync(resolve(expandPath(filePath)), newCode);
      trackEdit(filePath);
      printColored(`  ✓ Fixed ${filePath}\n`, "green");
    }
  }
  console.log();
}

// --- Multi-file edit ---

async function doMultiEdit(instruction) {
  printColored("⏳ Planning multi-file edit...\n\n", "dim");

  const projectTree = scanDir(".", "", 2);
  const treeContext = projectTree.map(e => e.type === "dir" ? e.path + "/" : e.path).slice(0, 50).join("\n");

  const planPrompt = `TASK: Plan a multi-file code change.

Project structure:
${treeContext}

${projectMemory ? `Project context:\n${projectMemory}\n` : ""}
${getRecentContext() ? `\n${getRecentContext()}\n` : ""}

INSTRUCTION: ${instruction}

List the files that need to be created or modified. For each file:
- If it EXISTS, describe what changes are needed
- If it's NEW, describe what it should contain

Format your response as:
EDIT: <filepath> — <description of changes>
CREATE: <filepath> — <description of content>

List ALL files needed, then I'll handle each one.`;

  try {
    const result = await askAI(planPrompt);
    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
    console.log(result.text);
    console.log();

    // Parse the plan
    const edits = [...result.text.matchAll(/EDIT:\s*(\S+)\s*[—-]\s*(.+)/g)];
    const creates = [...result.text.matchAll(/CREATE:\s*(\S+)\s*[—-]\s*(.+)/g)];

    if (edits.length === 0 && creates.length === 0) {
      printColored("  Could not parse a file plan. Try being more specific.\n\n", "yellow");
      return;
    }

    printColored(`  Plan: ${edits.length} edit(s), ${creates.length} new file(s)\n\n`, "bold");

    const ok = await confirm("  Execute this plan? (y/n) ");
    if (!ok) {
      printColored("\n  ✗ Plan cancelled.\n\n", "yellow");
      return;
    }
    console.log();

    // Execute edits
    for (const [, filePath, desc] of edits) {
      await doEdit(filePath, desc);
    }

    // Execute creates
    for (const [, filePath, desc] of creates) {
      await doGenerate(filePath, desc);
    }

    printColored("  ✓ Multi-file edit complete.\n\n", "green");
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
  }
}

// --- Search/Replace edit engine (like Claude Code) ---

function parseSearchReplace(text) {
  const blocks = [];
  const pattern = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  return blocks;
}

function applySearchReplace(code, blocks) {
  let result = code;
  const applied = [];
  const failed = [];

  for (const block of blocks) {
    // Try exact match first
    if (result.includes(block.search)) {
      result = result.replace(block.search, block.replace);
      applied.push(block);
    } else {
      // Try trimmed match (whitespace differences)
      const searchTrimmed = block.search.split("\n").map(l => l.trim()).join("\n");
      const lines = result.split("\n");
      let found = false;

      for (let i = 0; i <= lines.length - block.search.split("\n").length; i++) {
        const segment = lines.slice(i, i + block.search.split("\n").length);
        const segmentTrimmed = segment.map(l => l.trim()).join("\n");
        if (segmentTrimmed === searchTrimmed) {
          const before = lines.slice(0, i);
          const after = lines.slice(i + block.search.split("\n").length);
          result = [...before, ...block.replace.split("\n"), ...after].join("\n");
          applied.push(block);
          found = true;
          break;
        }
      }
      if (!found) failed.push(block);
    }
  }

  return { result, applied, failed };
}

// --- Core operations ---

async function doEdit(filePath, instruction) {
  const code = readFile(filePath);
  if (code === null) return;

  const lang = getLang(filePath);
  const lineCount = code.split("\n").length;

  // Get project structure for context
  const projectTree = scanDir(".", "", 2);
  const treeContext = projectTree.length > 0
    ? `\nProject structure:\n${projectTree.map(e => e.type === "dir" ? e.path + "/" : e.path).slice(0, 40).join("\n")}\n`
    : "";

  const memoryContext = projectMemory ? `\nProject context:\n${projectMemory}\n` : "";

  const prompt = `TASK: Edit a file using SEARCH/REPLACE blocks.

FILE: ${filePath} (${lang}, ${lineCount} lines)
${treeContext}${memoryContext}
CURRENT FILE CONTENT:
\`\`\`${lang}
${code}
\`\`\`

INSTRUCTION: ${instruction}

RESPOND WITH SEARCH/REPLACE BLOCKS. For each change, output:

<<<<<<< SEARCH
exact lines from the original file to find
=======
replacement lines (or empty to delete)
>>>>>>> REPLACE

RULES:
1. Each SEARCH block must contain the EXACT text from the file (copy-paste, don't retype)
2. Include enough context lines in SEARCH so it matches uniquely
3. To REMOVE code: leave the REPLACE section empty
4. To ADD code: use a SEARCH block with the lines around where you want to insert
5. You can output multiple SEARCH/REPLACE blocks for multiple changes
6. After all blocks, write a one-line summary of what changed`;

  printColored(`⏳ Editing ${filePath}...\n\n`, "dim");

  try {
    const result = await askAI(prompt);
    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");

    // Try search/replace approach first
    const blocks = parseSearchReplace(result.text);

    if (blocks.length > 0) {
      // Search/replace mode
      const { result: newCode, applied, failed } = applySearchReplace(code, blocks);

      if (applied.length === 0) {
        printColored("  ⚠ Could not match any SEARCH blocks in the file.\n", "yellow");
        printColored("  AI response:\n\n", "dim");
        console.log(result.text.slice(0, 800));
        console.log();

        // Fallback: try full-file mode
        printColored("  Retrying with full-file mode...\n\n", "dim");
        await doEditFullFile(filePath, code, lang, instruction, treeContext);
        return;
      }

      if (failed.length > 0) {
        printColored(`  ⚠ ${failed.length} change(s) could not be matched.\n`, "yellow");
      }

      // Show changes
      printColored(`  File: ${filePath}\n`, "bold");
      printColored(`  ${applied.length} change(s) applied:\n\n`, "green");

      for (const block of applied) {
        if (block.search.trim()) {
          const searchLines = block.search.split("\n");
          searchLines.slice(0, 8).forEach(l => printColored(`  - ${l}\n`, "red"));
          if (searchLines.length > 8) printColored(`  ... (${searchLines.length - 8} more)\n`, "dim");
        }
        if (block.replace.trim()) {
          const replaceLines = block.replace.split("\n");
          replaceLines.slice(0, 8).forEach(l => printColored(`  + ${l}\n`, "green"));
          if (replaceLines.length > 8) printColored(`  ... (${replaceLines.length - 8} more)\n`, "dim");
        } else {
          printColored(`  (removed)\n`, "red");
        }
        console.log();
      }

      const ok = await confirm("  Apply changes? (y/n) ");
      if (ok) {
        saveUndo(filePath, code);
        writeFileSync(resolve(expandPath(filePath)), newCode);
        trackEdit(filePath);
        printColored(`\n  ✓ Saved ${filePath}\n\n`, "green");
      } else {
        printColored("\n  ✗ Changes discarded.\n\n", "yellow");
      }
    } else {
      // No search/replace blocks — check if we got a usable code block
      const codeBlock = extractCodeBlock(result.text);
      const hasCode = codeBlock !== result.text && codeBlock.trim().length > 10;

      if (!hasCode && result.providerName) {
        // Bad response — retry with next provider
        printColored("  ⚠ AI didn't return usable edits. Retrying with next provider...\n\n", "yellow");
        try {
          const retry = await askAI(prompt, { skipProvider: result.providerName });
          printColored(`[${retry.provider} — ${retry.model}]\n\n`, "cyan");
          const retryBlocks = parseSearchReplace(retry.text);
          if (retryBlocks.length > 0) {
            const { result: newCode, applied } = applySearchReplace(code, retryBlocks);
            if (applied.length > 0) {
              printColored(`  File: ${filePath}\n`, "bold");
              printColored(`  ${applied.length} change(s):\n\n`, "green");
              for (const b of applied) {
                if (b.search.trim()) b.search.split("\n").slice(0, 5).forEach(l => printColored(`  - ${l}\n`, "red"));
                if (b.replace.trim()) b.replace.split("\n").slice(0, 5).forEach(l => printColored(`  + ${l}\n`, "green"));
                else printColored(`  (removed)\n`, "red");
                console.log();
              }
              const ok = await confirm("  Apply changes? (y/n) ");
              if (ok) {
                saveUndo(filePath, code);
                writeFileSync(resolve(expandPath(filePath)), newCode);
                trackEdit(filePath);
                printColored(`\n  ✓ Saved ${filePath}\n\n`, "green");
              } else {
                printColored("\n  ✗ Changes discarded.\n\n", "yellow");
              }
              return;
            }
          }
        } catch {}
        // Still no luck — fall back to full-file mode
      }

      await doEditFullFile(filePath, code, lang, instruction, treeContext);
    }
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
  }
}

async function doEditFullFile(filePath, code, lang, instruction, treeContext) {
  const prompt = `TASK: Edit a file. Return the COMPLETE updated file.

FILE: ${filePath} (${lang})
${treeContext || ""}
CURRENT FILE CONTENT:
\`\`\`${lang}
${code}
\`\`\`

INSTRUCTION: ${instruction}

Return the ENTIRE file with changes applied inside a code block.
Do NOT truncate, skip, or use placeholders. Every line must be present.`;

  printColored(`⏳ Applying edit (full-file mode)...\n\n`, "dim");

  try {
    const result = await askAI(prompt);
    const newCode = extractCodeBlock(result.text);

    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");

    const originalLen = code.length;
    const newLen = newCode.length;
    if (newLen < originalLen * 0.3 && originalLen > 100) {
      printColored("  ⚠ AI returned a much shorter file — likely truncated.\n", "yellow");
      printColored(`  Original: ${originalLen} chars → AI: ${newLen} chars\n\n`, "yellow");
      return;
    }

    const oldLines = code.split("\n").length;
    const newLines = newCode.split("\n").length;
    printColored(`  File: ${filePath}\n`, "bold");
    printColored(`  Lines: ${oldLines} → ${newLines}\n\n`, "dim");

    const oldSet = new Set(code.split("\n"));
    const newSet = new Set(newCode.split("\n"));
    const added = newCode.split("\n").filter(l => !oldSet.has(l));
    const removed = code.split("\n").filter(l => !newSet.has(l));

    if (removed.length > 0) {
      printColored("  Removed:\n", "red");
      removed.slice(0, 10).forEach(l => printColored(`  - ${l}\n`, "red"));
      if (removed.length > 10) printColored(`  ... +${removed.length - 10} more\n`, "dim");
      console.log();
    }
    if (added.length > 0) {
      printColored("  Added:\n", "green");
      added.slice(0, 10).forEach(l => printColored(`  + ${l}\n`, "green"));
      if (added.length > 10) printColored(`  ... +${added.length - 10} more\n`, "dim");
      console.log();
    }

    if (added.length === 0 && removed.length === 0) {
      printColored("  No changes detected.\n\n", "yellow");
      return;
    }

    const ok = await confirm("  Apply changes? (y/n) ");
    if (ok) {
      saveUndo(filePath, code);
      const dir = dirname(resolve(expandPath(filePath)));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(expandPath(filePath)), newCode);
      trackEdit(filePath);
      printColored(`\n  ✓ Saved ${filePath}\n\n`, "green");
    } else {
      printColored("\n  ✗ Changes discarded.\n\n", "yellow");
    }
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
  }
}

async function doExplain(filePath) {
  // If it's a directory, explain the project structure
  if (isDirectory(filePath)) {
    const tree = doScan(filePath);
    if (!tree) return;

    const prompt = `Explain the project structure of this directory "${filePath}":

${tree}

Describe:
1. What kind of project this is (framework, language, purpose)
2. Key directories and what they contain
3. Important files to look at first
4. Architecture pattern used

Be concise.`;

    printColored(`⏳ Analyzing project structure...\n\n`, "dim");

    try {
      const result = await askAI(prompt);
      printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
      console.log(result.text);
      console.log();
    } catch (err) {
      printColored(`Error: ${err.message}\n`, "red");
    }
    return;
  }

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
  // If it's a directory, review all files in it
  if (isDirectory(filePath)) {
    const entries = scanDir(filePath, "", 1);
    const files = entries.filter((e) => e.type === "file" && e.size < 50000);
    if (files.length === 0) {
      printColored(`No reviewable files in ${filePath}\n`, "yellow");
      return;
    }

    printColored(`\n  Reviewing ${files.length} files in ${filePath}/...\n\n`, "bold");

    let allCode = "";
    for (const f of files.slice(0, 10)) {
      try {
        const content = readFileSync(resolve(expandPath(f.path)), "utf-8");
        allCode += `\n--- ${f.path} ---\n${content}\n`;
      } catch {}
    }

    const prompt = `Review the following code files from "${filePath}/". Check for:
1. Bugs or logic errors
2. Security vulnerabilities
3. Performance issues
4. Best practice improvements

Be concise — only mention real issues. Reference file names.

${allCode}`;

    printColored(`⏳ Reviewing ${filePath}/...\n\n`, "dim");

    try {
      const result = await askAI(prompt);
      printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
      console.log(result.text);
      console.log();
    } catch (err) {
      printColored(`Error: ${err.message}\n`, "red");
    }
    return;
  }

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

async function doRead(pathArg) {
  if (isDirectory(pathArg)) {
    doLs(pathArg);
    return;
  }

  const code = readFile(pathArg);
  if (code === null) return;

  trackRead(pathArg);
  const lang = getLang(pathArg);
  const lines = code.split("\n");
  printColored(`\n  ${pathArg} (${lang}, ${lines.length} lines)\n\n`, "bold");
  lines.forEach((l, i) => {
    printColored(`  ${String(i + 1).padStart(4)} `, "dim");
    console.log(l);
  });
  console.log();
}

async function doGenerate(filePath, instruction) {
  if (existsSync(resolve(expandPath(filePath)))) {
    printColored(`File already exists: ${filePath}. Use "edit" instead.\n`, "red");
    return;
  }

  const lang = getLang(filePath);

  // Get project structure for context
  const projectTree = scanDir(".", "", 2);
  const treeContext = projectTree.length > 0
    ? `\nProject structure:\n${projectTree.map(e => e.type === "dir" ? e.path + "/" : e.path).slice(0, 50).join("\n")}\n`
    : "";

  const prompt = `Generate the content for a new ${lang} file at "${filePath}" in this project.
${treeContext}
Instruction: ${instruction}

Follow the patterns and conventions used in the existing project files.
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
      const dir = dirname(resolve(expandPath(filePath)));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(expandPath(filePath)), newCode);
      printColored(`\n  ✓ Created ${filePath}\n\n`, "green");
    } else {
      printColored("\n  ✗ File not created.\n\n", "yellow");
    }
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
  }
}

async function doAsk(question, fileContext, imageParts) {
  const projectTree = scanDir(".", "", 2);
  const treeSnippet = projectTree.length > 0
    ? projectTree.map(e => e.type === "dir" ? e.path + "/" : e.path).slice(0, 40).join("\n")
    : "";

  let fullContext = "";
  if (projectMemory) fullContext += `Project context:\n${projectMemory}\n\n`;
  if (treeSnippet) fullContext += `Project structure:\n${treeSnippet}\n\n`;
  const recent = getRecentContext();
  if (recent) fullContext += `${recent}\n\n`;
  if (fileContext) fullContext += `File content:\n\`\`\`\n${fileContext}\n\`\`\`\n\n`;

  const prompt = fullContext
    ? `${fullContext}Question: ${question}`
    : question;

  // Stream response
  let providerInfo = "";
  const opts = {
    context: chatHistory,
    onToken: (token) => process.stdout.write(token),
  };
  if (imageParts) opts.imageParts = imageParts;

  try {
    const result = await askAI(prompt, opts);
    console.log("\n");
    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");

    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: result.text });

    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(-14);
    }
    saveChatHistory(chatHistory);
  } catch (err) {
    printColored(`\nError: ${err.message}\n`, "red");
  }
}

// --- Conversation history ---
let chatHistory = loadChatHistory();

// --- Undo stack ---
let undoStack = [];

function saveUndo(filePath, content) {
  undoStack.push({ filePath, content, time: new Date().toLocaleTimeString() });
  if (undoStack.length > 20) undoStack.shift();
}

function doUndo() {
  if (undoStack.length === 0) {
    printColored("  Nothing to undo.\n\n", "yellow");
    return;
  }
  const last = undoStack.pop();
  writeFileSync(resolve(expandPath(last.filePath)), last.content);
  printColored(`  ✓ Undone last edit to ${last.filePath} (from ${last.time})\n\n`, "green");
}

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

  // Show quick project summary
  const entries = scanDir(".", "", 1);
  const dirs = entries.filter((e) => e.type === "dir");
  const files = entries.filter((e) => e.type === "file");
  printColored(`  Structure: ${dirs.length} dirs, ${files.length} top-level files\n`, "dim");

  const active = getProviderStatus().filter((p) => p.configured);
  if (active.length === 0) {
    printColored("\n  ⚠ No providers configured! Add API keys to .env\n", "yellow");
    printColored("  Run: free-ai status\n\n", "dim");
    process.exit(1);
  }
  printColored(`  Providers: ${active.map((p) => p.label).join(", ")}\n`, "dim");

  if (projectMemory) {
    printColored(`  Memory: .free-ai.md loaded\n`, "green");
  }
  if (chatHistory.length > 0) {
    printColored(`  History: ${chatHistory.length / 2} previous messages restored\n`, "cyan");
  }

  console.log();
  printColored("  Type naturally — edit, review, search, fix, commit.\n", "dim");
  printColored("  Shell: !<cmd>  Git: git status  Search: grep <text>  Tests: fix\n", "dim");
  printColored("  Image: image <path>  Tab: autocomplete file paths\n", "dim");
  printColored("  /help for all commands  |  /exit to quit\n", "dim");
  console.log();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
    completer: fileCompleter,
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

    // Exit commands (with or without slash)
    if (input === "/exit" || input === "/quit" || input === "/q" ||
        input === "exit" || input === "quit" || input === "q" || input === "bye") {
      saveChatHistory(chatHistory);
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
      saveChatHistory([]);
      printColored("  Conversation cleared.\n\n", "dim");
      showPrompt();
      return;
    }
    if (input === "/undo" || input === "undo") {
      doUndo();
      showPrompt();
      return;
    }
    if (input === "/diff" || input === "diff") {
      doDiff();
      showPrompt();
      return;
    }
    if (input.startsWith("/diff ") || input.startsWith("diff ")) {
      doDiff(input.replace(/^\/?diff\s+/, "").trim());
      showPrompt();
      return;
    }
    if (input === "/commit" || input === "commit") {
      await doCommit();
      showPrompt();
      return;
    }
    if (input.startsWith("/scan")) {
      const dir = input.replace("/scan", "").trim() || ".";
      doScan(dir);
      showPrompt();
      return;
    }
    if (input.startsWith("/ls")) {
      const dir = input.replace("/ls", "").trim() || ".";
      doLs(dir);
      showPrompt();
      return;
    }

    const lowerInput = input.toLowerCase();

    // Shell commands: !<command> or "run <command>"
    if (input.startsWith("!")) {
      doRun(input.slice(1).trim());
      showPrompt();
      return;
    }
    if (lowerInput.startsWith("run ") && !findPath(input)) {
      doRun(input.slice(4).trim());
      showPrompt();
      return;
    }

    // Git shorthand: "git status", "git diff", etc.
    if (input.startsWith("git ")) {
      doRun(input);
      showPrompt();
      return;
    }

    // Grep/search: "grep <pattern> [path]" or "search <pattern> [path]" or "find <pattern> [path]"
    if (lowerInput.startsWith("grep ") || lowerInput.startsWith("search ") || lowerInput.startsWith("find ")) {
      const rest = input.replace(/^(?:grep|search|find)\s+/i, "").trim();
      const parts = rest.split(/\s+/);
      const pattern = parts[0];
      const searchPath = parts[1] || ".";
      if (pattern) {
        doGrep(pattern, searchPath);
      } else {
        printColored('  Usage: grep <pattern> [path]\n\n', "yellow");
      }
      showPrompt();
      return;
    }

    // Image command: "image <path> [question]" — send screenshot to AI (Gemini vision)
    if (lowerInput.startsWith("image ") || lowerInput.startsWith("screenshot ")) {
      const rest = input.replace(/^(?:image|screenshot)\s+/i, "").trim();
      const imgPath = findPath(rest) || rest.split(/\s+/)[0];
      const question = rest.replace(imgPath, "").trim() || "Describe this image. If it's a UI, explain what you see.";
      const parts = loadImage(imgPath);
      if (parts) {
        printColored(`  Loaded image: ${imgPath}\n\n`, "dim");
        await doAsk(question, null, parts);
      }
      showPrompt();
      return;
    }

    // Fix command: "fix [test command]"
    if (lowerInput.startsWith("fix ") || lowerInput === "fix") {
      const testCmd = input.replace(/^fix\s*/i, "").trim() || null;
      await doFix(testCmd);
      showPrompt();
      return;
    }

    const foundPath = findPath(input);

    // Detect edit intent from natural language
    const editKeywords = /\b(add|remove|delete|change|replace|update|fix|rename|refactor|move|insert|modify|make|set|convert|wrap|unwrap|extract|inline)\b/i;
    const isEditIntent = editKeywords.test(input) && foundPath && isFile(foundPath);

    // Detect multi-file intent (no specific file path, but a broad instruction)
    const multiFileKeywords = /\b(add a .+ column|add .+ to .+ and|create .+ with .+ migration|scaffold|generate .+ crud|add .+ feature)\b/i;
    const isMultiFile = multiFileKeywords.test(input) && !foundPath;

    // Scan/ls: "scan <dir>" or "ls <dir>"
    if ((lowerInput.startsWith("scan ") || lowerInput.startsWith("ls ")) && foundPath) {
      if (isDirectory(foundPath)) {
        if (lowerInput.startsWith("scan ")) doScan(foundPath);
        else doLs(foundPath);
      } else {
        printColored(`Not a directory: ${foundPath}\n`, "yellow");
      }
    }
    // Edit: "edit <path> <instruction>"
    else if (lowerInput.startsWith("edit ") && foundPath && isFile(foundPath)) {
      const instruction = input.replace(/^edit\s+/i, "").replace(foundPath, "").trim();
      if (instruction) {
        await doEdit(foundPath, instruction);
      } else {
        printColored('  What changes? e.g., edit app/models/user.rb "add email validation"\n\n', "yellow");
      }
    }
    // Review: "review <path>" (file or directory)
    else if (lowerInput.startsWith("review ") && foundPath) {
      await doReview(foundPath);
    }
    // Explain: "explain <path>" (file or directory)
    else if (lowerInput.startsWith("explain ") && foundPath) {
      await doExplain(foundPath);
    }
    // Read/show/cat: "read <path>" (file or directory)
    else if ((lowerInput.startsWith("read ") || lowerInput.startsWith("show ") || lowerInput.startsWith("cat ")) && foundPath) {
      await doRead(foundPath);
    }
    // Create/Generate: "create <path> <instruction>"
    else if ((lowerInput.startsWith("create ") || lowerInput.startsWith("generate ")) && foundPath) {
      const instruction = input.replace(/^(?:create|generate)\s+/i, "").replace(foundPath, "").trim();
      if (instruction) {
        await doGenerate(foundPath, instruction);
      } else {
        printColored('  What should the file contain? e.g., create app/models/invoice.rb "model with validations"\n\n', "yellow");
      }
    }
    // Multi-file edit: broad instructions without a specific file
    else if (isMultiFile) {
      await doMultiEdit(input);
    }
    // Natural language edit: "add validation to app/models/user.rb", "remove the header from app/views/..."
    else if (isEditIntent) {
      const instruction = input.replace(foundPath, "").trim();
      await doEdit(foundPath, instruction);
    }
    // If input has a file path + instruction, treat as edit
    else if (foundPath && isFile(foundPath) && input.replace(foundPath, "").trim().length > 5) {
      const instruction = input.replace(foundPath, "").trim();
      await doEdit(foundPath, instruction);
    }
    // Default: ask as a question (with file/dir context if mentioned)
    else {
      let fileContext = null;
      if (foundPath && isFile(foundPath)) {
        fileContext = readFileSync(resolve(expandPath(foundPath)), "utf-8");
      } else if (foundPath && isDirectory(foundPath)) {
        const tree = scanDir(foundPath, "", 2);
        fileContext = `Directory "${foundPath}" contents:\n` + tree.map(e => e.type === "dir" ? e.path + "/" : e.path).join("\n");
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

// --- One-shot CLI command handlers ---

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
  const path = args[1];
  if (!path) {
    printColored("Please provide a file or directory path.\n", "red");
    printColored("Usage: free-ai explain <file|dir>\n", "dim");
    process.exit(1);
  }
  await doExplain(path);
}

async function handleReview() {
  const path = args[1];
  if (!path) {
    printColored("Please provide a file or directory path.\n", "red");
    printColored("Usage: free-ai review <file|dir>\n", "dim");
    process.exit(1);
  }
  await doReview(path);
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

async function handleScan() {
  const dir = args[1] || ".";
  doScan(dir);
}

function handleStatus() {
  const status = getProviderStatus();
  const usage = getUsageStats();

  console.log("\nFree AI Providers:\n");
  for (const p of status) {
    const icon = p.configured ? "✓" : "✗";
    const color = p.configured ? "green" : "red";
    printColored(`  ${icon} `, color);
    printColored(`${p.label}`, "bold");
    printColored(` (${p.model})`, "dim");
    if (p.supportsVision) printColored(` [vision]`, "magenta");
    console.log();
    printColored(`    ${p.freeInfo}\n`, "dim");

    const u = usage[p.name];
    if (u) {
      const ago = Math.round((Date.now() - u.lastUsed) / 60000);
      printColored(`    Session: ${u.requests} request(s)`, "cyan");
      if (ago > 0) printColored(` (last: ${ago}m ago)`, "dim");
      console.log();
    }
  }
  console.log();

  const configured = status.filter((p) => p.configured).length;
  if (configured === 0) {
    printColored(
      "  No providers configured! Add API keys to .env file.\n\n",
      "yellow"
    );
  } else {
    const totalRequests = Object.values(usage).reduce((sum, u) => sum + u.requests, 0);
    printColored(`  ${configured}/${status.length} providers active`, "green");
    if (totalRequests > 0) printColored(` | ${totalRequests} total requests this session`, "dim");
    console.log("\n");
  }
}

// --- Main ---

switch (command) {
  case "chat":
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
  case "scan":
    await handleScan();
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
    // If no known command, start chat mode
    await startChat();
    break;
}
