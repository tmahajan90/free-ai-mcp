# free-ai-mcp

Free AI coding agent that works like Claude Code — **read, edit, search, fix, and commit** using free AI APIs with automatic fallback. When one provider hits its rate limit, the next one takes over.

Works as both a **CLI tool** (interactive terminal agent) and an **MCP server** (use inside Claude Code, Cursor, etc.).

## Features

- **Streaming responses** — Tokens appear as the AI generates them, no waiting
- **Search/Replace editing** — Precise SEARCH/REPLACE blocks (like Claude Code)
- **Auto-fix loop** — Runs tests, reads errors, fixes code automatically (up to 3 attempts)
- **Multi-file edits** — "add a name column to users" plans and edits migration + model + views
- **Project memory** — `.free-ai.md` gives the AI persistent context about your project
- **Grep/search** — Search across your codebase without leaving the agent
- **Smart commit** — AI writes commit messages, you just confirm
- **Image/screenshot support** — Send screenshots to Gemini vision, ask "build this UI"
- **Tab completion** — Press Tab to autocomplete file paths
- **Conversation persistence** — Chat history saved, resumes next session
- **Auto-retry** — Bad AI response? Automatically retries with the next provider
- **Usage tracking** — See request counts per provider with `/status`
- **Shell & Git** — Run any command with `!` prefix, git commands work directly
- **Undo** — Revert any edit instantly
- **Auto-fallback** — 5 free AI providers with automatic failover

## Supported Providers (All Free)

| Provider | Model | Free Tier | Sign Up |
|---|---|---|---|
| Google Gemini | gemini-2.5-flash | 15 req/min, 1M tokens/day, **vision** | https://aistudio.google.com/apikey |
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

Sign up at any of the provider links above. You need **at least one**, but more = more fallback.

Recommended:
- **Google Gemini** — best free tier (1M tokens/day) + image support
- **Groq** — fastest responses (<1 second)

### 3. Configure API keys

```bash
cp .env.example .env
```

Edit `.env` and paste your keys:

```
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here
```

### 4. (Optional) Project memory

Create `.free-ai.md` in your project root:

```markdown
This is a Rails 8 app using Tailwind CSS v4.
Multi-tenant with acts_as_tenant.
Use Stimulus controllers for JS.
Tests are in test/ directory, run with: bundle exec rails test
```

The AI will use this context for every interaction.

## Usage — Interactive Mode (like Claude Code)

```bash
cd your-project
free-ai
```

### Edit files
```
edit app/models/user.rb add email validation
add pagination to app/controllers/products_controller.rb
remove the header from app/views/layouts/application.html.erb
```

### Multi-file edits
```
add a name column to users
add a search feature to products
```

### Auto-fix (run tests -> fix errors -> repeat)
```
fix                              Auto-detects test command
fix bundle exec rails test       Custom test command
fix npm test                     Works with any runner
```

### Search across files
```
grep validates app/models        Find text in files
search "def create"              Same as grep
find TODO                        Find all TODOs
```

### Image / Screenshot (Gemini vision)
```
image screenshot.png             Describe what's in the image
image mockup.png build this UI   AI analyzes image and generates code
```

### Read & explore
```
read app/models/product.rb
explain app/controllers/sales_controller.rb
review app/views/sales/_form.html.erb
ls app/models
scan app/controllers
```

### Shell & Git
```
!bundle exec rails test          Run any shell command
git status                        Git commands directly
commit                            AI writes commit message
```

### All commands
| Command | Description |
|---|---|
| `grep <pattern> [path]` | Search across files |
| `fix [test cmd]` | Auto-fix: run tests, fix errors, repeat |
| `commit` | Smart commit with AI-generated message |
| `diff [file]` | Show session changes / git diff |
| `image <path> [question]` | Analyze image with Gemini vision |
| `/undo` | Undo last file edit |
| `/scan` | Scan project structure |
| `/ls [dir]` | List files |
| `/status` | Show providers + usage stats |
| `/help` | Show help |
| `/clear` | Clear conversation + saved history |
| `/exit` | Exit (history saved for next session) |

### Keyboard shortcuts
- **Tab** — Autocomplete file paths
- **Up/Down** — Navigate input history
- **Ctrl+C** — Cancel current operation

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

```bash
claude mcp add free-ai node /full/path/to/free-ai-mcp/src/mcp-server.js
```

| Tool | Description |
|---|---|
| **edit_code** | Edit files with SEARCH/REPLACE blocks |
| **read_code** | Read a file with line numbers |
| **generate_code** | Generate a new file from instructions |
| **explain_code** | Get an AI explanation of a file |
| **review_code** | Code review for bugs & security |
| **ask_ai** | Ask a coding question |
| **run_command** | Run a shell command |
| **ai_status** | Check configured providers |

## How the edit engine works

Uses **SEARCH/REPLACE blocks** (same approach as Claude Code):

```
<<<<<<< SEARCH
exact lines from the original file
=======
replacement lines (or empty to delete)
>>>>>>> REPLACE
```

**Retry chain:**
1. Ask AI for SEARCH/REPLACE blocks
2. If blocks don't match the file -> retry full-file mode
3. If AI gives garbage response -> auto-retry with next provider
4. Falls back to full-file replacement as last resort

## Tips

- Add all 5 provider keys to maximize free usage across the day
- Gemini has the most generous free tier (1M tokens/day) and supports images
- Groq is the fastest (responses in <1 second)
- Create `.free-ai.md` for project-specific context the AI always knows
- Use `fix` after making changes to auto-run and fix tests
- Use `commit` for AI-generated commit messages
- Tab-complete file paths to type faster
- Conversation persists across sessions — no need to re-explain context
- `/status` shows how many requests you've made per provider
