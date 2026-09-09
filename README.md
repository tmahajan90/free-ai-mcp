# free-ai-mcp

Free AI coding agent that can **read, edit, review, and generate code** — powered by multiple free AI APIs with automatic fallback. When one provider hits its rate limit, the next one takes over seamlessly.

Works as both a **CLI tool** (use directly in terminal) and an **MCP server** (use inside Claude Code, Cursor, etc.).

## Features

- **Edit files** — AI reads your file, applies changes, shows diff, and saves
- **Generate files** — Create new files from instructions
- **Review code** — Get a code review for bugs, security, and best practices
- **Explain code** — Understand any file in your project
- **Ask questions** — Ask coding questions with optional file context
- **Auto-fallback** — If one AI provider is rate-limited, the next one is tried automatically

## Supported Providers (All Free)

| Provider | Model | Free Tier | Sign Up |
|---|---|---|---|
| Google Gemini | gemini-2.5-flash | 15 req/min, 1M tokens/day | https://aistudio.google.com/apikey |
| Groq | llama-3.3-70b | 30 req/min, 14,400 req/day | https://console.groq.com |
| Mistral AI | mistral-small | Free tier | https://console.mistral.ai |
| Cerebras | qwen-3.8-27b | Free tier | https://cloud.cerebras.ai |
| OpenRouter | nex-n2.5-pro (free) | Free models available | https://openrouter.ai/keys |

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

### Edit a file with AI

```bash
node src/cli.js edit app/models/user.rb "add email validation"
node src/cli.js edit src/index.js "add error handling to the fetch call"
```

The AI reads the file, applies your instruction, shows a diff, and asks for confirmation before saving.

### Generate a new file

```bash
node src/cli.js generate app/models/invoice.rb "Rails model with validations for invoice"
```

### Explain a file

```bash
node src/cli.js explain app/controllers/sales_controller.rb
```

### Review a code file

```bash
node src/cli.js review app/views/sales/_form.html.erb
```

### Ask a coding question

```bash
node src/cli.js ask "how to add pagination in Rails"
node src/cli.js ask -f app/models/user.rb "optimize this model"
```

### Check provider status

```bash
node src/cli.js status
```

## Usage — MCP Server (Claude Code / Cursor)

### Add to Claude Code

```bash
claude mcp add free-ai node /full/path/to/free-ai-mcp/src/mcp-server.js
```

### Available MCP tools

Once added, you get these tools:

| Tool | Description |
|---|---|
| **edit_code** | Read a file, edit it with AI, and save changes |
| **read_code** | Read a file with line numbers |
| **generate_code** | Generate a new file from instructions |
| **explain_code** | Get an AI explanation of a file |
| **review_code** | Review a file for bugs, security, and improvements |
| **ask_ai** | Ask a coding question |
| **ai_status** | Check configured providers |

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
- The `edit` command always shows a diff and asks for confirmation before saving
- Use `explain` before `edit` if you want to understand a file first
