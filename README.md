# free-ai-mcp

Chain multiple free AI APIs with automatic fallback. When one provider hits its rate limit, the next one takes over seamlessly.

Works as both a **CLI tool** (use directly in terminal) and an **MCP server** (use inside Claude Code, Cursor, etc.).

## Supported Providers (All Free)

| Provider | Model | Free Tier | Sign Up |
|---|---|---|---|
| Google Gemini | gemini-2.0-flash | 15 req/min, 1M tokens/day | https://aistudio.google.com/apikey |
| Groq | llama-3.3-70b | 30 req/min, 14,400 req/day | https://console.groq.com |
| Mistral AI | mistral-small | Free tier | https://console.mistral.ai |
| Cerebras | llama-4-scout | Free tier | https://cloud.cerebras.ai |
| OpenRouter | deepseek-v3 (free) | Free models available | https://openrouter.ai/keys |

## Setup

### 1. Clone and install

```bash
git clone https://github.com/tmahajan90/free-ai-mcp.git
cd free-ai-mcp
npm install
```

### 2. Get your free API keys

Sign up at any of the provider links above and grab an API key. You need **at least one**, but adding more gives you automatic fallback.

Recommended to start with:
- **Google Gemini** — best free tier, sign up takes 30 seconds
- **Groq** — fastest responses, sign up takes 1 minute

### 3. Configure API keys

```bash
cp .env.example .env
```

Edit `.env` and paste your keys:

```
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here
```

## Usage — CLI (Direct)

### Ask a coding question

```bash
node src/cli.js ask "how to add pagination in Rails"
```

### Ask with file context

```bash
node src/cli.js ask -f app/models/user.rb "optimize this model"
```

### Review a code file

```bash
node src/cli.js review app/controllers/sales_controller.rb
```

### Check provider status

```bash
node src/cli.js status
```

## Usage — MCP Server (Claude Code)

### Add to Claude Code

```bash
claude mcp add free-ai node /full/path/to/free-ai-mcp/src/mcp-server.js
```

### Available MCP tools

Once added, Claude Code gets these tools:

- **ask_ai** — Ask a coding question to free AI models
- **review_code** — Get a code review from a free AI model
- **ai_status** — Check which providers are configured and available

## How fallback works

```
You ask a question
       |
       v
  [Google Gemini] --> Success? Return answer
       |
       v (rate limited / failed)
  [Groq]          --> Success? Return answer
       |
       v (rate limited / failed)
  [Mistral]       --> Success? Return answer
       |
       v (rate limited / failed)
  [Cerebras]      --> Success? Return answer
       |
       v (rate limited / failed)
  [OpenRouter]    --> Success? Return answer
       |
       v (all failed)
  Error: All providers exhausted
```

Providers are tried in the order listed. Add more API keys = more fallback options = more free usage.

## Tips

- Add all 5 provider keys to maximize your free AI usage across the day
- Gemini has the most generous free tier (1M tokens/day)
- Groq is the fastest (responses in <1 second)
- OpenRouter gives access to DeepSeek which is excellent for coding
