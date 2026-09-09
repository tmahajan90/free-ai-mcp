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
  const match = text.match(/```[\w]*\n([\s\S]*?)```/);
  if (match) return match[1].trimEnd() + "\n";
  return text;
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
  "Read a file, send it to a free AI with editing instructions, and save the updated file. Shows a diff before applying.",
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

      const prompt = `TASK: Edit a file. Apply the instruction, then return the COMPLETE updated file.

FILE: ${file_path}
LANGUAGE: ${lang}

CURRENT FILE CONTENT:
\`\`\`${lang}
${code}
\`\`\`

INSTRUCTION: ${instruction}

RULES:
1. Apply the instruction to the file above
2. Return the ENTIRE file with changes applied — do NOT skip or truncate any part
3. If the instruction says to remove something, actually remove it from the output
4. If the instruction says to add something, add it in the right place
5. Wrap your output in a single code block: \`\`\`${lang} ... \`\`\`
6. Do NOT add any text before or after the code block — ONLY the code block
7. Do NOT use "..." or "// rest of file" or any placeholders — output every single line`;

      const result = await askAI(prompt);
      const newCode = extractCodeBlock(result.text);

      const oldLines = code.split("\n");
      const newLines = newCode.split("\n");
      const oldSet = new Set(oldLines);
      const newSet = new Set(newLines);
      const added = newLines.filter((l) => !oldSet.has(l));
      const removed = oldLines.filter((l) => !newSet.has(l));

      let diffText = `**Edit: ${file_path}** [${result.provider}]\n\n`;
      diffText += `Lines: ${oldLines.length} → ${newLines.length}\n\n`;

      if (removed.length > 0) {
        diffText += "**Removed:**\n```\n" + removed.slice(0, 20).join("\n") + "\n```\n\n";
      }
      if (added.length > 0) {
        diffText += "**Added:**\n```\n" + added.slice(0, 20).join("\n") + "\n```\n\n";
      }

      if (added.length === 0 && removed.length === 0) {
        return {
          content: [{ type: "text", text: `No changes needed for ${file_path}.` }],
        };
      }

      if (auto_apply) {
        writeFileSync(resolved, newCode);
        diffText += `✓ Changes saved to ${file_path}`;
      } else {
        diffText += `Changes NOT applied (auto_apply=false). Review the diff above.`;
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

const transport = new StdioServerTransport();
await server.connect(transport);
