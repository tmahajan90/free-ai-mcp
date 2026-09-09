#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askAI, getProviderStatus } from "./router.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const server = new McpServer({
  name: "free-ai",
  version: "2.0.0",
});

const LANG_MAP = {
  rb: "ruby", js: "javascript", ts: "typescript", py: "python",
  jsx: "jsx", tsx: "tsx", go: "go", rs: "rust", java: "java",
  erb: "erb", html: "html", css: "css", sql: "sql",
};

function getLang(filePath) {
  const ext = filePath.split(".").pop();
  return LANG_MAP[ext] || ext;
}

function extractCodeBlock(text) {
  const allBlocks = [...text.matchAll(/```[\w]*\n([\s\S]*?)```/g)];
  if (allBlocks.length > 0) {
    let largest = allBlocks[0][1];
    for (const block of allBlocks) {
      if (block[1].length > largest.length) largest = block[1];
    }
    return largest.trimEnd() + "\n";
  }
  return text;
}

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
    if (result.includes(block.search)) {
      result = result.replace(block.search, block.replace);
      applied.push(block);
    } else {
      const searchTrimmed = block.search.split("\n").map(l => l.trim()).join("\n");
      const lines = result.split("\n");
      let found = false;
      for (let i = 0; i <= lines.length - block.search.split("\n").length; i++) {
        const segment = lines.slice(i, i + block.search.split("\n").length);
        if (segment.map(l => l.trim()).join("\n") === searchTrimmed) {
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

// --- Tools ---

server.tool(
  "ask_ai",
  "Ask a coding question to free AI models. Automatically falls back to the next provider if one is rate-limited.",
  {
    prompt: z.string().describe("Your coding question or task"),
    context: z
      .string()
      .optional()
      .describe("Optional code context (paste relevant code here)"),
  },
  async ({ prompt, context }) => {
    try {
      const fullPrompt = context
        ? `Context:\n\`\`\`\n${context}\n\`\`\`\n\nQuestion: ${prompt}`
        : prompt;

      const result = await askAI(fullPrompt);

      return {
        content: [
          {
            type: "text",
            text: `**[${result.provider} — ${result.model}]**\n\n${result.text}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "edit_code",
  "Edit a file using SEARCH/REPLACE blocks for precise changes. Falls back to full-file mode if needed.",
  {
    file_path: z.string().describe("Path to the file to edit"),
    instruction: z.string().describe("What changes to make to the file"),
    auto_apply: z.boolean().optional().default(true).describe("Automatically apply changes (default: true)"),
  },
  async ({ file_path, instruction, auto_apply }) => {
    try {
      const resolved = resolve(file_path);
      if (!existsSync(resolved)) {
        return {
          content: [{ type: "text", text: `File not found: ${file_path}` }],
          isError: true,
        };
      }

      const code = readFileSync(resolved, "utf-8");
      const lang = getLang(file_path);
      const lineCount = code.split("\n").length;

      // Try search/replace first
      const srPrompt = `TASK: Edit a file using SEARCH/REPLACE blocks.

FILE: ${file_path} (${lang}, ${lineCount} lines)

CURRENT FILE CONTENT:
\`\`\`${lang}
${code}
\`\`\`

INSTRUCTION: ${instruction}

RESPOND WITH SEARCH/REPLACE BLOCKS:

<<<<<<< SEARCH
exact lines from original file
=======
replacement lines (or empty to delete)
>>>>>>> REPLACE

RULES:
1. SEARCH must contain EXACT text from the file
2. Include enough context for unique matching
3. To REMOVE code: leave REPLACE empty
4. Multiple blocks allowed for multiple changes`;

      const result = await askAI(srPrompt);
      const blocks = parseSearchReplace(result.text);

      let diffText = `**Edit: ${file_path}** [${result.provider}]\n\n`;
      let newCode;

      if (blocks.length > 0) {
        const { result: patched, applied, failed } = applySearchReplace(code, blocks);
        newCode = patched;
        diffText += `${applied.length} change(s) applied`;
        if (failed.length > 0) diffText += `, ${failed.length} failed to match`;
        diffText += "\n\n";

        for (const b of applied) {
          if (b.search.trim()) diffText += `**Removed:**\n\`\`\`\n${b.search.split("\n").slice(0, 10).join("\n")}\n\`\`\`\n\n`;
          if (b.replace.trim()) diffText += `**Added:**\n\`\`\`\n${b.replace.split("\n").slice(0, 10).join("\n")}\n\`\`\`\n\n`;
          else diffText += `*(deleted)*\n\n`;
        }

        if (applied.length === 0) {
          diffText += "Could not match SEARCH blocks. Retrying with full-file mode...\n\n";
        }
      }

      // Fallback to full-file if no blocks or none applied
      if (blocks.length === 0 || (blocks.length > 0 && !parseSearchReplace(result.text).some(b => code.includes(b.search)))) {
        const ffPrompt = `TASK: Edit a file. Return the COMPLETE updated file.

FILE: ${file_path} (${lang})
CURRENT FILE CONTENT:
\`\`\`${lang}
${code}
\`\`\`

INSTRUCTION: ${instruction}

Return the ENTIRE file with changes inside a code block. Do NOT truncate.`;

        const ffResult = await askAI(ffPrompt);
        newCode = extractCodeBlock(ffResult.text);
        diffText = `**Edit: ${file_path}** [${ffResult.provider}] (full-file mode)\n\n`;

        const oldSet = new Set(code.split("\n"));
        const newSet = new Set(newCode.split("\n"));
        const added = newCode.split("\n").filter(l => !oldSet.has(l));
        const removed = code.split("\n").filter(l => !newSet.has(l));
        if (removed.length > 0) diffText += `**Removed:**\n\`\`\`\n${removed.slice(0, 15).join("\n")}\n\`\`\`\n\n`;
        if (added.length > 0) diffText += `**Added:**\n\`\`\`\n${added.slice(0, 15).join("\n")}\n\`\`\`\n\n`;
      }

      if (newCode === code) {
        return { content: [{ type: "text", text: `No changes needed for ${file_path}.` }] };
      }

      if (auto_apply) {
        writeFileSync(resolved, newCode);
        diffText += `✓ Changes saved to ${file_path}`;
      } else {
        diffText += `Changes NOT applied (auto_apply=false).`;
      }

      return { content: [{ type: "text", text: diffText }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "read_code",
  "Read a file and return its contents with line numbers.",
  {
    file_path: z.string().describe("Path to the file to read"),
  },
  async ({ file_path }) => {
    try {
      const resolved = resolve(file_path);
      if (!existsSync(resolved)) {
        return {
          content: [{ type: "text", text: `File not found: ${file_path}` }],
          isError: true,
        };
      }

      const code = readFileSync(resolved, "utf-8");
      const lang = getLang(file_path);
      const lines = code.split("\n");
      const numbered = lines
        .map((l, i) => `${String(i + 1).padStart(4)} | ${l}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `**${file_path}** (${lang}, ${lines.length} lines)\n\n\`\`\`${lang}\n${numbered}\n\`\`\``,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "explain_code",
  "Read a file and get an AI explanation of what it does.",
  {
    file_path: z.string().describe("Path to the file to explain"),
  },
  async ({ file_path }) => {
    try {
      const resolved = resolve(file_path);
      if (!existsSync(resolved)) {
        return {
          content: [{ type: "text", text: `File not found: ${file_path}` }],
          isError: true,
        };
      }

      const code = readFileSync(resolved, "utf-8");
      const lang = getLang(file_path);

      const prompt = `Explain the following ${lang} code from file "${file_path}". Cover:
1. What the file does (purpose)
2. Key functions/methods and what they do
3. Important patterns or design decisions

Be concise but thorough.

\`\`\`${lang}
${code}
\`\`\``;

      const result = await askAI(prompt);

      return {
        content: [
          {
            type: "text",
            text: `**Explanation: ${file_path}** [${result.provider}]\n\n${result.text}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "generate_code",
  "Generate a new file based on instructions.",
  {
    file_path: z.string().describe("Path for the new file"),
    instruction: z.string().describe("What the file should contain"),
  },
  async ({ file_path, instruction }) => {
    try {
      const resolved = resolve(file_path);
      if (existsSync(resolved)) {
        return {
          content: [
            {
              type: "text",
              text: `File already exists: ${file_path}. Use edit_code to modify it.`,
            },
          ],
          isError: true,
        };
      }

      const lang = getLang(file_path);

      const prompt = `Generate the content for a new ${lang} file at "${file_path}".

Instruction: ${instruction}

Return ONLY the file content inside a single code block. No explanations before or after.`;

      const result = await askAI(prompt);
      const newCode = extractCodeBlock(result.text);

      writeFileSync(resolved, newCode);

      const lines = newCode.split("\n").length;
      return {
        content: [
          {
            type: "text",
            text: `**Generated: ${file_path}** [${result.provider}] (${lines} lines)\n\n\`\`\`${lang}\n${newCode}\`\`\``,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "review_code",
  "Get a code review from a free AI model. Checks for bugs, security issues, and improvements.",
  {
    file_path: z
      .string()
      .optional()
      .describe("Path to file to review (reads file automatically)"),
    code: z.string().optional().describe("Code to review (if no file_path)"),
    language: z
      .string()
      .optional()
      .describe("Programming language (auto-detected from file extension)"),
  },
  async ({ file_path, code, language }) => {
    try {
      let reviewCode = code;
      let lang = language;

      if (file_path) {
        const resolved = resolve(file_path);
        if (!existsSync(resolved)) {
          return {
            content: [{ type: "text", text: `File not found: ${file_path}` }],
            isError: true,
          };
        }
        reviewCode = readFileSync(resolved, "utf-8");
        lang = lang || getLang(file_path);
      }

      if (!reviewCode) {
        return {
          content: [
            { type: "text", text: "Provide either file_path or code to review." },
          ],
          isError: true,
        };
      }

      lang = lang || "the given";
      const prompt = `Review the following ${lang} code${file_path ? ` from "${file_path}"` : ""}. Check for:
1. Bugs or logic errors
2. Security vulnerabilities
3. Performance issues
4. Best practice improvements

Be concise — only mention real issues.

\`\`\`${lang}\n${reviewCode}\n\`\`\``;

      const result = await askAI(prompt);

      return {
        content: [
          {
            type: "text",
            text: `**Code Review${file_path ? `: ${file_path}` : ""}** [${result.provider}]\n\n${result.text}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "ai_status",
  "Check which free AI providers are configured and available.",
  {},
  async () => {
    const status = getProviderStatus();
    const lines = status.map(
      (p) =>
        `${p.configured ? "✓" : "✗"} ${p.label} (${p.model}) — ${p.freeInfo}`
    );

    return {
      content: [
        {
          type: "text",
          text: `**Free AI Providers:**\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "run_command",
  "Run a shell command and return the output. Useful for running tests, git commands, build tools, etc.",
  {
    command: z.string().describe("Shell command to execute"),
    cwd: z.string().optional().describe("Working directory (default: current directory)"),
  },
  async ({ command, cwd }) => {
    try {
      const { execSync } = await import("child_process");
      const output = execSync(command, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: cwd || process.cwd(),
      });
      return {
        content: [{ type: "text", text: `\`$ ${command}\`\n\n\`\`\`\n${output}\n\`\`\`` }],
      };
    } catch (err) {
      let text = `\`$ ${command}\`\n\nError: ${err.message}`;
      if (err.stdout) text += `\n\nstdout:\n\`\`\`\n${err.stdout}\n\`\`\``;
      if (err.stderr) text += `\n\nstderr:\n\`\`\`\n${err.stderr}\n\`\`\``;
      return { content: [{ type: "text", text }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
