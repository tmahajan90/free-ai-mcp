# free-ai-mcp

Free AI coding agent that works like Claude Code — **read, edit, review, and generate code** using free AI APIs with automatic fallback. When one provider hits its rate limit, the next one takes over.

Works as both a **CLI tool** (interactive terminal agent) and an **MCP server** (use inside Claude Code, Cursor, etc.).

## Features

- **Search/Replace editing** — AI returns precise SEARCH/REPLACE blocks (like Claude Code), not entire files. Much more reliable for code changes, especially removals.
- **Shell commands** — Run any shell command with `!` prefix or `run` command
- **Git integration** — Type `git status`, `git diff`, etc. directly
- **Undo** — Revert the last edit with `/undo`
- **Natural language** — Say "add validation to app/models/user.rb" and it detects the edit intent
- **Auto-fallback** — If one AI provider is rate-limited, the next one is tried automatically
- **Project-aware** — Scans your project structure for context

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

## Usage — Interactive Mode (like Claude Code)

Start the agent in your project directory:

```bash
cd your-project
free-ai
```

Then type naturally:

### Edit files
```
edit app/models/user.rb add email validation
add pagination to app/controllers/products_controller.rb
remove the header from app/views/layouts/application.html.erb
fix the N+1 query in app/models/order.rb
```

### Read & explore
```
read app/models/product.rb
explain app/controllers/sales_controller.rb
review app/views/sales/_form.html.erb
ls app/models
scan app/controllers
```

### Create files
```
create app/services/stock_alert.rb service that checks low stock
```

### Shell & Git
```
!bundle exec rails test
run npm install
git status
git diff
git log --oneline -5
```

### Ask questions
```
what is the best way to add pagination in Rails?
how does the auth flow work in this project?
```

### Commands
| Command | Description |
|---|---|
| `/scan` | Scan project structure |
| `/ls [dir]` | List files in a directory |
| `/status` | Show provider status |
| `/undo` | Undo last file edit |
| `/help` | Show help |
| `/clear` | Clear conversation |
| `/exit` | Exit chat |

## Usage — One-shot CLI

```bash
free-ai edit app/models/user.rb "add email validation"
free-ai explain app/controllers/sales_controller.rb
free-ai review app/views/sales/_form.html.erb
free-ai generate app/models/invoice.rb "Rails model with validations"
free-ai ask "how to add pagination in Rails"
free-ai status
```

## Usage — MCP Server (Claude Code / Cursor)

### Add to Claude Code

```bash
claude mcp add free-ai node /full/path/to/free-ai-mcp/src/mcp-server.js
```

### Available MCP tools

| Tool | Description |
|---|---|
| **edit_code** | Edit files with SEARCH/REPLACE blocks |
| **read_code** | Read a file with line numbers |
| **generate_code** | Generate a new file from instructions |
| **explain_code** | Get an AI explanation of a file |
| **review_code** | Review for bugs, security, and improvements |
| **ask_ai** | Ask a coding question |
| **run_command** | Run a shell command |
| **ai_status** | Check configured providers |

## How the edit engine works

The edit engine uses **SEARCH/REPLACE blocks** (the same approach Claude Code uses):

```
<<<<<<< SEARCH
exact lines from the original file
=======
replacement lines (or empty to delete)
>>>>>>> REPLACE
```

This is much more reliable than asking the AI to return the entire file because:
- The AI only outputs the changed parts, not the whole file
- No risk of truncation on large files
- Deletions work reliably (empty REPLACE = remove)
- Multiple changes can be made in one pass

If the AI doesn't return SEARCH/REPLACE blocks, it automatically falls back to full-file mode.

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

## Tips

- Add all 5 provider keys to maximize your free AI usage across the day
- Gemini has the most generous free tier (1M tokens/day)
- Groq is the fastest (responses in <1 second)
- The `edit` command always shows a diff and asks for confirmation before saving
- Use `!` to run any shell command without leaving the agent
- Use `/undo` if an edit didn't turn out right
- Type `git status` or `git diff` to check your changes
