# KEC Assistant Platform

Modular full-stack application for Kongu Engineering College with:
- Role-based chat assistant (`STUDENT`, `FACULTY`, `ADMIN`)
- MCP tool orchestration via OpenCode
- Admin ingestion pipeline for PDF upload -> parse -> chunk -> embed -> Chroma -> search

## Architecture

### Client (`client/`)
- `src/features/chat/*`: Chat UI, message streaming, formatting, conversation state
- `src/pages/*`: Route-level pages (`Login`, `Chat`, `AdminIngestion`)
- `src/hooks/useAuth.js`: Auth session + token/header injection
- `src/hooks/useIngestionAdmin.js`: Admin ingestion control hook
- `src/components/admin/*`: Admin console sections

### Server (`server/`)
- `src/index.js`: Node API bootstrap and route registration
- `src/chat/config.js`: Runtime/env constants
- `src/chat/systemPrompt.js`: Assistant system prompt
- `src/chat/runtime.js`: OpenCode lifecycle + MCP store/watch/sync + model resolution
- `src/chat/rolePolicy.js`: Role filtering and server/tool access policy
- `src/chat/chatBody.js`: Prompt body builder (role/mode/tool/model aware)
- `src/chat/utils.js`: Shared transport/parsing helpers
- `src/auth.js`: Login service (JWT issuance + DB credential check)
- `app/main.py`: FastAPI ingestion API host
- `app/ingestion_api/*`: Ingestion routers/services/models/utils

### Runtime Data
- `server/storage/chroma/`: vector store
- `server/storage/uploads/`: uploaded files
- `server/storage/ingestion_metadata.db`: ingestion metadata
- `server/logs/`: log files

## End-to-End Flow

### 1) Login Flow
1. UI posts credentials to `POST /auth/login` (Node auth service).
2. Auth service validates email pattern + DB record + password + role.
3. JWT token is returned with `allowedServers`.
4. Client stores session and injects `Authorization`, `X-Role`, and `X-Allowed-Servers` headers.

### 2) Chat Flow
1. UI posts to `POST /api/chat/stream` (Node chat service).
2. Server derives role from headers, applies student restrictions.
3. Server builds final prompt body (system rules + model + allowed MCP servers/tools).
4. Server streams OpenCode session events (text deltas + tool events) back as NDJSON.
5. Client incrementally renders assistant output and tool progress.

### 3) Ingestion Flow
1. Admin uploads PDFs to `POST /ingestion/api/v1/documents/upload`.
2. FastAPI validates and stores file, creates metadata row (`PENDING`).
3. Background task runs pipeline:
   - Parse PDF via LlamaParse
   - Chunk with LlamaIndex splitter
   - Embed with SentenceTransformers
   - Persist vectors in Chroma
   - Update metadata status (`COMPLETED`/`FAILED`)
4. Admin UI polls status and can preview/search/delete/replace documents.

## Tech Stack

### Frontend
- React 19 + Vite
- React Router
- React Markdown + KaTeX

### Backend (Node)
- Express
- OpenCode SDK
- MCP SDK
- PostgreSQL (`pg`) for auth users
- JWT (`jsonwebtoken`)

### Backend (Python)
- FastAPI
- ChromaDB
- LlamaParse
- LlamaIndex
- SentenceTransformers
- SQLite (metadata)

## Local Setup

## 0) Prerequisites
- Node.js 20+
- Python 3.10+
- PostgreSQL (local or Docker)
- LlamaParse API key
- Git (optional, if cloning)

## 1) Install JS dependencies
From repo root:

```bash
npm install
```

## 2) Install Python dependencies

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 3) Set up PostgreSQL auth database

### Option A: Local Postgres
1. Create a database (example: `kec_assist`).
2. Run the schema:

```bash
psql -d kec_assist -f server/db/schema.sql
```

### Option B: Docker
```bash
docker run --name kec-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kec_assist -p 5432:5432 -d postgres:16
```

Then run:

```bash
psql -h localhost -U postgres -d kec_assist -f server/db/schema.sql
```

## 4) Configure environment variables

### Root Node env (`.env` at repo root)

```env
# Auth
AUTH_PORT=4005
AUTH_JWT_SECRET=change-me
AUTH_JWT_ISS=kec-auth
AUTH_JWT_TTL=3600

# Postgres
DATABASE_URL=postgresql://user:password@localhost:5432/kec_assist
# or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD

# OpenCode chat backend
PORT=8787
OPENCODE_PORT=auto
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_STARTUP_TIMEOUT_MS=30000

# Ingestion auth verification (must match AUTH_JWT_SECRET)
INGESTION_ALLOWED_ROLES=ADMIN

# Ingestion parser
LLAMA_PARSE_API_KEY=your_llamaparse_key

# Optional CORS for FastAPI
CORS_ORIGINS=http://localhost:5173
```

### Client env (`client/.env`)

```env
VITE_AUTH_URL=http://localhost:4005
VITE_ADMIN_API_URL=http://localhost:9000
VITE_AUTO_INGEST_URL=http://localhost:9000/ingestion
VITE_SERVER_URL=http://localhost:8787

# Ingestion APIs per role (optional overrides)
VITE_STUDENT_2022_API_URL=http://localhost:9000/ingestion
VITE_STUDENT_2024_API_URL=http://localhost:9001/ingestion
VITE_FACULTY_API_URL=http://localhost:9002/ingestion
```

## 5) Run services
Open 4 terminals.

### Terminal A: Node services (chat + auth + client)
From repo root:

```bash
npm run dev
```

Starts:
- Client: `http://localhost:5173`
- Chat API: `http://localhost:8787`
- Auth API: `http://localhost:4005`

### Terminal B: FastAPI ingestion service
From `server/` with venv active:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload
```

Ingestion API base:
- `http://localhost:9000/ingestion`

### Terminal C: Student 2024 MCP server
From `server/student_2024/` with venv active:

```bash
python student_2024_server.py
```

### Terminal D: Student 2022 MCP server
From `server/student_2022/` with venv active:

```bash
python student_2022_server.py
```

### Optional: Faculty MCP server
From `server/faculty/` with venv active:

```bash
python faculty_server.py
```

## 6) Build client

```bash
npm run build -w client
```

## Notes on Legacy Folders
- Folders like `student_2022/`, `student_2024/`, `faculty/`, and related DB snapshots are legacy/parallel artifacts.
- Active ingestion runtime for the admin UI is `server/app/ingestion_api/*` with `server/storage/*`.
- Keep legacy folders for reference/migration unless explicitly decommissioning.

## Troubleshooting
- If the chat UI cannot reach the backend, confirm `VITE_SERVER_URL=http://localhost:8787` and the dev proxy in `client/vite.config.js`.
- If login fails, verify Postgres is running and `server/db/schema.sql` has been applied.
- If chat replies say no data, ensure the MCP servers are running and the Chroma DBs contain the ingested data.
