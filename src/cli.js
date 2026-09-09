#!/usr/bin/env node

import { askAI, getProviderStatus } from "./router.js";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { resolve, join, extname, basename, dirname, relative } from "path";
import { createInterface } from "readline";

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
free-ai — Free AI coding agent (like Claude Code, but free)

Usage:
  free-ai                                Start interactive chat mode
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
    "fix the N+1 query in app/models/order.rb"

  Read/explore:
    "read app/models/product.rb"
    "explain app/controllers/sales_controller.rb"
    "review app/views/sales/_form.html.erb"
    "ls app/models"  or  "scan app/controllers"

  Create files:
    "create app/services/stock_alert.rb service that checks low stock"

  Shell & Git:
    !bundle exec rails test           Run any shell command
    run npm install                    Same as ! prefix
    git status                         Git commands run directly
    git diff                           View changes

  Ask questions:
    "what is the best way to add pagination in Rails?"
    "how does the auth flow work in this project?"

  Commands:
    /scan      Scan project structure
    /ls [dir]  List files in a directory
    /status    Show provider status
    /undo      Undo last file edit
    /help      Show help
    /clear     Clear conversation
    /exit      Exit chat

Edit engine uses SEARCH/REPLACE blocks (like Claude Code) for precise changes.
Providers are tried in order. If one is rate-limited, the next is used.
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

// --- Shell command execution ---

async function doRun(cmd) {
  const { execSync } = await import("child_process");
  printColored(`  $ ${cmd}\n\n`, "dim");
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 30000, cwd: process.cwd() });
    if (output.trim()) console.log(output);
    return output;
  } catch (err) {
    printColored(`  Error: ${err.message}\n`, "red");
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) printColored(`  ${err.stderr}\n`, "red");
    return null;
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

  const prompt = `TASK: Edit a file using SEARCH/REPLACE blocks.

FILE: ${filePath} (${lang}, ${lineCount} lines)
${treeContext}
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
        printColored(`\n  ✓ Saved ${filePath}\n\n`, "green");
      } else {
        printColored("\n  ✗ Changes discarded.\n\n", "yellow");
      }
    } else {
      // No search/replace blocks — try extracting a full file code block
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

async function doAsk(question, fileContext) {
  // Include project structure in context for better answers
  const projectTree = scanDir(".", "", 2);
  const treeSnippet = projectTree.length > 0
    ? projectTree.map(e => e.type === "dir" ? e.path + "/" : e.path).slice(0, 40).join("\n")
    : "";

  let fullContext = "";
  if (treeSnippet) fullContext += `Project structure:\n${treeSnippet}\n\n`;
  if (fileContext) fullContext += `File content:\n\`\`\`\n${fileContext}\n\`\`\`\n\n`;

  const prompt = fullContext
    ? `${fullContext}Question: ${question}`
    : question;

  printColored("⏳ Thinking...\n\n", "dim");

  try {
    const result = await askAI(prompt, { context: chatHistory });
    printColored(`[${result.provider} — ${result.model}]\n\n`, "cyan");
    console.log(result.text);
    console.log();

    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: result.text });

    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(-14);
    }
  } catch (err) {
    printColored(`Error: ${err.message}\n`, "red");
  }
}

// --- Conversation history ---
let chatHistory = [];

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

  console.log();
  printColored("  Type naturally — I can read, edit, review, and scan your project.\n", "dim");
  printColored("  Shell: !<command> or run <command>  |  Git: git status, git diff, etc.\n", "dim");
  printColored("  Commands: /scan /ls /status /undo /help /clear /exit\n", "dim");
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

    // Exit commands (with or without slash)
    if (input === "/exit" || input === "/quit" || input === "/q" ||
        input === "exit" || input === "quit" || input === "q" || input === "bye") {
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
    if (input === "/undo" || input === "undo") {
      doUndo();
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
      await doRun(input.slice(1).trim());
      showPrompt();
      return;
    }
    if (lowerInput.startsWith("run ") && !findPath(input)) {
      await doRun(input.slice(4).trim());
      showPrompt();
      return;
    }

    // Git shorthand: "git status", "git diff", etc.
    if (input.startsWith("git ")) {
      await doRun(input);
      showPrompt();
      return;
    }

    const foundPath = findPath(input);

    // Detect edit intent from natural language
    const editKeywords = /\b(add|remove|delete|change|replace|update|fix|rename|refactor|move|insert|modify|make|set|convert|wrap|unwrap|extract|inline)\b/i;
    const isEditIntent = editKeywords.test(input) && foundPath && isFile(foundPath);

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
