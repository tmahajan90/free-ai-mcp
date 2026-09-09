const PROVIDERS = [
  {
    name: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    model: "gemini-2.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    freeInfo: "15 req/min, 1M tokens/day — https://aistudio.google.com/apikey",

    async call(apiKey, messages, model) {
      const m = model || this.model;
      const url = `${this.endpoint}/${m}:generateContent?key=${apiKey}`;

      const contents = messages.map(msg => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 8192 },
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Gemini ${resp.status}: ${err}`);
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

    async call(apiKey, messages, model) {
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
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Groq ${resp.status}: ${err}`);
      }

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

    async call(apiKey, messages, model) {
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
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Mistral ${resp.status}: ${err}`);
      }

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

    async call(apiKey, messages, model) {
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
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Cerebras ${resp.status}: ${err}`);
      }

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

    async call(apiKey, messages, model) {
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
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`OpenRouter ${resp.status}: ${err}`);
      }

      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    },
  },
];

export default PROVIDERS;
