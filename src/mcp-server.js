#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askAI, getProviderStatus } from "./router.js";

const server = new McpServer({
  name: "free-ai",
  version: "1.0.0",
});

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
  "review_code",
  "Get a code review from a free AI model. Checks for bugs, security issues, and improvements.",
  {
    code: z.string().describe("The code to review"),
    language: z
      .string()
      .optional()
      .describe("Programming language (e.g., ruby, javascript)"),
  },
  async ({ code, language }) => {
    try {
      const lang = language || "the given";
      const prompt = `Review the following ${lang} code. Check for:\n1. Bugs or logic errors\n2. Security vulnerabilities\n3. Performance issues\n4. Best practice improvements\n\nBe concise — only mention real issues.\n\n\`\`\`${language || ""}\n${code}\n\`\`\``;

      const result = await askAI(prompt);

      return {
        content: [
          {
            type: "text",
            text: `**Code Review [${result.provider}]**\n\n${result.text}`,
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
