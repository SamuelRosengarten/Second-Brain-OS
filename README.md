# Second Brain OS (V1 - Legacy)

> [!WARNING]
> ### ⚠️ Legacy Version Notice
> This repository contains **Second Brain OS V1 (Legacy)**. Active development on this codebase has concluded, and the project has been completely redesigned and rebuilt from the ground up as **[Synapse OS (V2)](https://synapse-os.ca/)**.
>
> All new features, performance updates, and ongoing support are exclusive to Synapse OS. If you are starting fresh or looking for the actively maintained version, visit **[https://synapse-os.ca/](https://synapse-os.ca/)**.

---

## Project Description

**Second Brain OS (V1)** is a private, local-first personal knowledge management (PKM) and productivity system. Built as a self-hosted desktop web application, it enables users to:

- **Capture thoughts and ideas** instantly from your computer or phone.
- **Store notes as plain Markdown files** with YAML frontmatter, backlinks, and tags.
- **Manage tasks and projects** with weekly planning, timeline scheduling, and dependency graphs.
- **Process and search context locally** using an embedded SQLite database (FTS5 full-text search) and optional local AI models via Ollama (for automated structuring, embeddings-based semantic search, and grounded Q&A).
- **Keep complete ownership of your data** with zero required external paid APIs or cloud dependencies.

---

## Prerequisites

Before running Second Brain OS V1, make sure you have the following installed:

- **Node.js**: Version `22.0.0` or higher ([nodejs.org](https://nodejs.org/))
- **Package Manager**: `npm` (comes bundled with Node.js) or `pnpm`
- **Git**: For cloning the repository
- **Ollama** *(Optional, recommended for AI features)*:
  - Install [Ollama](https://ollama.ai/) to enable local AI summarization, automatic inbox classification, and semantic vector search.
  - Pull the recommended models:
    ```bash
    # Chat and structuring model
    ollama pull qwen3.5:9b

    # Semantic search embedding model
    ollama pull nomic-embed-text
    ```
  > **Note:** Ollama is optional. Core PKM features—including creating notes, Markdown editing, task management, projects, and keyword search—function completely offline without AI models running.

---

## Setup Instructions

Follow these step-by-step commands to get the development server running locally:

### 1. Clone the repository
```bash
git clone https://github.com/SamuelRosengarten/Second-Brain-OS.git
cd Second-Brain-OS
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env.local` configuration file from the template:

- **Linux / macOS**:
  ```bash
  cp .env.example .env.local
  ```
- **Windows (PowerShell)**:
  ```powershell
  copy .env.example .env.local
  ```

Generate a secure random session secret and assign it to `SBOS_SESSION_SECRET` in `.env.local`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> User data (SQLite database, markdown notes vault, attachments) defaults to `~/SecondBrainOS` (or `%USERPROFILE%\SecondBrainOS` on Windows). You can customize this path by setting `SBOS_DATA_DIR` in `.env.local`.

### 4. Set the master password
Initialize your local master login password (minimum 12 characters, hashed with scrypt):
```bash
npm run set-password
```

### 5. Start the development server
```bash
npm run dev
```

The application will start on [http://127.0.0.1:3000](http://127.0.0.1:3000).

*(Optional)* To test a production build instead:
```bash
npm run build
npm run start
```

---

## Usage Guide

Once the server is running and you have logged in with your password, you can interact with the app via:

- **Command Palette (`Ctrl+K` / `Cmd+K`)**: Global launcher to jump between notes, run searches, create tasks, or access any view instantly.
- **Quick Capture (`N` or `/capture`)**: Save quick notes, raw thoughts, links, and snippets. When local AI is enabled, it automatically drafts suggested tags, summaries, and extractable action items for your review.
- **Inbox Review (`/inbox`)**: Process captured entries. Accept, edit, or discard suggested structure before notes and tasks are saved to your permanent vault.
- **Notes & Knowledge Base (`/knowledge`)**: Create, organize, and edit your notes in Markdown with live preview and wiki-style backlinks (`[[Note Title]]`). Notes are stored directly as plain `.md` files on your local filesystem.
- **Search**: Search across your knowledge base using fast SQLite FTS5 keyword matching or hybrid semantic search (when embeddings are enabled).
- **Projects & Planning (`/workflow`)**: Organize tasks into projects, set priorities and due dates, and visualize workloads via week-by-week schedules, timelines, and dependency graphs.
- **Ask AI (`/ask`)**: Ask questions directly to a local LLM grounded in your personal notes and tasks, complete with source citations.

---

## Status

> [!IMPORTANT]
> **This repository is no longer actively maintained.**
>
> Second Brain OS V1 is in legacy mode and will **not** receive new features, enhancements, or bug fixes.
>
> All active development, design evolutions, and future roadmaps are centered exclusively on **[Synapse OS (V2)](https://synapse-os.ca/)**. If you are looking for an up-to-date, modern experience, please migrate to [Synapse OS](https://synapse-os.ca/).
