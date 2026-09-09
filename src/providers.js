import { readFileSync } from "fs";

// Parse SSE stream for OpenAI-compatible APIs
async function parseOpenAIStream(resp, onToken) {
  let full = "";
  const decoder = new TextDecoder();
  for await (const chunk of resp.body) {
    const text = decoder.decode(chunk, { stream: true });
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const data = JSON.parse(line.slice(6));
        const token = data.choices?.[0]?.delta?.content;
        if (token) {
          full += token;
          if (onToken) onToken(token);
        }
      } catch {}
    }
  }
  return full;
}

const PROVIDERS = [
  {
    name: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    model: "gemini-2.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    freeInfo: "15 req/min, 1M tokens/day — https://aistudio.google.com/apikey",
    supportsVision: true,

    async call(apiKey, messages, model, { onToken, imageParts } = {}) {
      const m = model || this.model;
      const stream = !!onToken;
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      const url = `${this.endpoint}/${m}:${action}&key=${apiKey}`;

      const contents = messages.map(msg => {
        const parts = [{ text: msg.content }];
        if (msg.role === "user" && imageParts) parts.push(...imageParts);
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts,
        };
      });

      // Only add image to the last user message
      if (imageParts) {
        const lastUser = contents.filter(c => c.role === "user").pop();
        if (lastUser && !lastUser.parts.some(p => p.inlineData)) {
          lastUser.parts.push(...imageParts);
        }
      }

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: contents.filter(c => {
            if (imageParts) return true;
            return true;
          }),
          generationConfig: { maxOutputTokens: 8192 },
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Gemini ${resp.status}: ${err}`);
      }

      if (stream) {
        let full = "";
        const decoder = new TextDecoder();
        for await (const chunk of resp.body) {
          const text = decoder.decode(chunk, { stream: true });
          for (const line of text.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              const token = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (token) {
                full += token;
                onToken(token);
              }
            } catch {}
          }
        }
        return full;
      }

      const data = await resp.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    },
  },

  {
    name: "groq",
    label: "Groq (Llama)",
    envKey: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    freeInfo: "30 req/min, 14,400 req/day — https://console.groq.com",

    async call(apiKey, messages, model, { onToken } = {}) {
      const stream = !!onToken;
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || this.model,
          messages,
          max_tokens: 8192,
          stream,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Groq ${resp.status}: ${err}`);
      }

      if (stream) return parseOpenAIStream(resp, onToken);
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    },
  },

  {
    name: "mistral",
    label: "Mistral AI",
    envKey: "MISTRAL_API_KEY",
    model: "mistral-small-latest",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    freeInfo: "Free tier available — https://console.mistral.ai",

    async call(apiKey, messages, model, { onToken } = {}) {
      const stream = !!onToken;
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || this.model,
          messages,
          max_tokens: 8192,
          stream,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Mistral ${resp.status}: ${err}`);
      }

      if (stream) return parseOpenAIStream(resp, onToken);
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    },
  },

  {
    name: "cerebras",
    label: "Cerebras",
    envKey: "CEREBRAS_API_KEY",
    model: "qwen-3.8-27b",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    freeInfo: "Free tier — https://cloud.cerebras.ai",

    async call(apiKey, messages, model, { onToken } = {}) {
      const stream = !!onToken;
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || this.model,
          messages,
          max_tokens: 8192,
          stream,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Cerebras ${resp.status}: ${err}`);
      }

      if (stream) return parseOpenAIStream(resp, onToken);
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    },
  },

  {
    name: "openrouter",
    label: "OpenRouter (Free models)",
    envKey: "OPENROUTER_API_KEY",
    model: "nex-agi/nex-n2.5-pro:free",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    freeInfo: "Free models available — https://openrouter.ai",

    async call(apiKey, messages, model, { onToken } = {}) {
      const stream = !!onToken;
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || this.model,
          messages,
          max_tokens: 8192,
          stream,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`OpenRouter ${resp.status}: ${err}`);
      }

      if (stream) return parseOpenAIStream(resp, onToken);
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    },
  },
];

export default PROVIDERS;
