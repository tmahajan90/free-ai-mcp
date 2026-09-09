# free-ai-mcp

Free AI coding agent that works like Claude Code — **read, edit, search, fix, and commit** using free AI APIs with automatic fallback. When one provider hits its rate limit, the next one takes over.

Works as both a **CLI tool** (interactive terminal agent) and an **MCP server** (use inside Claude Code, Cursor, etc.).

## Features

- **Search/Replace editing** — Precise SEARCH/REPLACE blocks (like Claude Code), not entire files
- **Auto-fix loop** — Runs tests, reads errors, fixes code automatically (up to 3 attempts)
- **Multi-file edits** — "add a name column to users" plans and edits migration + model + views
- **Project memory** — `.free-ai.md` gives the AI persistent context about your project
- **Grep/search** — Search across your codebase without leaving the agent
- **Smart commit** — AI writes commit messages, you just confirm
- **Session tracking** — Remembers recently edited/read files for better context
- **Shell & Git** — Run any command with `!` prefix, git commands work directly
- **Undo** — Revert any edit instantly
- **Auto-fallback** — 5 free AI providers, automatic fallback on rate limits

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

Sign up at any of the provider links above. You need **at least one**, but more = more fallback.

Recommended:
- **Google Gemini** — best free tier (1M tokens/day)
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
generate a CRUD for invoices
```
The AI plans which files to create/edit, then executes each step.

### Auto-fix (run tests → fix errors → repeat)
```
fix                              Auto-detects test command
fix bundle exec rails test       Custom test command
fix npm test                     Works with any runner
fix pytest                       Python too
```

### Search across files
```
grep validates app/models        Find text in files
search "def create"              Same as grep
find TODO                        Find all TODOs
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
!bundle exec rails test          Run any shell command
run npm install                   Same as ! prefix
git status                        Git commands directly
git diff                          View changes
commit                            AI writes commit message
```

### Ask questions
```
what is the best way to add pagination in Rails?
how does the auth flow work in this project?
```

### All commands
| Command | Description |
|---|---|
| `grep <pattern> [path]` | Search across files |
| `fix [test cmd]` | Auto-fix: run tests → fix errors → repeat |
| `commit` | Smart commit with AI-generated message |
| `diff [file]` | Show session changes / git diff |
| `/undo` | Undo last file edit |
| `/scan` | Scan project structure |
| `/ls [dir]` | List files |
| `/status` | Show provider status |
| `/help` | Show help |
| `/clear` | Clear conversation history |
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

Why this is better than full-file replacement:
- AI only outputs changed parts — no truncation risk on large files
- Deletions work reliably (empty REPLACE = remove)
- Multiple precise changes in one pass
- Falls back to full-file mode automatically if needed

## How auto-fix works

```
You type: fix
       |
       v
  [Run tests] → Tests pass? Done!
       |
       v (tests fail)
  [Send errors to AI] → AI returns SEARCH/REPLACE fixes
       |
       v
  [Apply fixes with confirmation]
       |
       v
  [Run tests again] → Up to 3 attempts
```

## Tips

- Add all 5 provider keys to maximize free usage across the day
- Gemini has the most generous free tier (1M tokens/day)
- Groq is the fastest (responses in <1 second)
- Create `.free-ai.md` for project-specific context the AI always knows
- Use `fix` after making changes to auto-run and fix tests
- Use `commit` for AI-generated commit messages
- Use `grep` to find code before editing
- The agent remembers your recent reads/edits for better context
