# SchoolBridge Backend 🏫🤖

> **AI-powered school communication platform** — connecting parents, teachers, and school administrators through a smart Telegram bot and a RESTful management API.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [API Reference](#api-reference)
- [Telegram Bot Guide](#telegram-bot-guide)
- [Role System](#role-system)
- [Knowledge Base](#knowledge-base)
- [Scheduled Notifications](#scheduled-notifications)
- [Security](#security)
- [Database Models](#database-models)
- [Project Structure](#project-structure)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## Overview

SchoolBridge is a full-stack school management communication system built with **Node.js**, **TypeScript**, **Express**, **MongoDB**, and a **Telegram Bot**. It uses large language models (via [OpenRouter](https://openrouter.ai/)) to power a context-aware AI assistant that responds intelligently to parents, teachers, and visitors — with strict role-based data access controls.

Parents can chat with the bot to get their child's fee status, school calendar, and class timetable. Teachers can broadcast messages to all parents in their class, send targeted messages to individual parents, and schedule future notifications — all through natural language conversation. Admins can manage students, upload knowledge documents, and approve unregistered users via the REST API.

---

## Features

### 🤖 AI-Powered Telegram Bot
- **Natural language conversations** powered by OpenRouter (Claude, GPT-4, LLaMA, Gemini, and more)
- **Role-aware responses** — different context and permissions for parents, teachers, and visitors
- **Phone verification** — users share their Telegram phone number to prove identity
- **Account-change detection** — detects and resets sessions when a different Telegram account logs into the same chat

### 👨‍👩‍👧 Parent Features
- View child's fee balance, amount paid, and outstanding amount
- Ask about school calendar, timetable, policies, and announcements
- Send messages directly to their child's class teacher via natural language (e.g., *"Tell my son's teacher he was sick"*)

### 👩‍🏫 Teacher Features
- **Class broadcast** — send a message to all parents in their assigned class instantly
- **Individual student messaging** — send a targeted message to a specific student's parent
- **Scheduled notifications** — schedule broadcasts or individual messages for a future time
- **View & cancel scheduled messages** — manage pending notification queue
- Class-level access control — teachers can only access students in their assigned class

### 🔧 Admin REST API
- Manage student records (CRUD + bulk Excel/CSV import)
- Upload and manage the school's knowledge base documents (PDF, Word, Excel, CSV, TXT)
- API key-protected endpoints
- Health check endpoint for deployment monitoring

### 🔒 Security & Trust
- Forwarded-contact rejection — phone sharing must be the user's own number
- Rate limiting — max 10 messages per 60 seconds per Telegram chat
- Audit logging for verification events and access denials
- Escalation tickets — unregistered visitors can request manual verification from the admin group
- Admin group commands (`/approve`, `/reject`) for reviewing verification requests

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      SchoolBridge Backend                     │
│                                                              │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────┐  │
│  │  Express API  │    │  Telegram Bot    │    │  Cron     │  │
│  │              │    │  (Webhook/Poll)  │    │  Worker   │  │
│  │  /api/chat   │    │                  │    │           │  │
│  │  /api/students    │  Message Handler │    │  Every    │  │
│  │  /api/knowledge   │  Intent Detection│    │  minute   │  │
│  └──────┬───────┘    └────────┬─────────┘    └─────┬─────┘  │
│         │                    │                     │        │
│         └──────────┬─────────┘                     │        │
│                    ▼                               │        │
│         ┌──────────────────┐                      │        │
│         │   School Agent   │◄─────────────────────┘        │
│         │  (OpenRouter LLM) │                               │
│         └──────────┬───────┘                               │
│                    │                                        │
│         ┌──────────▼───────┐                               │
│         │    MongoDB       │                               │
│         │  (Atlas / local) │                               │
│         └──────────────────┘                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript |
| HTTP Server | Express 5 |
| Database | MongoDB (via Mongoose) |
| AI / LLM | OpenRouter API (Claude, GPT-4, LLaMA, etc.) |
| Telegram Bot | `node-telegram-bot-api` |
| File Parsing | `xlsx`, `pdf-parse`, `mammoth` |
| File Uploads | Multer |
| Scheduling | `node-cron` |
| Email | Nodemailer (Brevo/SMTP) |
| SMS | Twilio |
| Logging | Pino + pino-pretty |

---

## Prerequisites

- **Node.js** v20 or higher
- **npm** v9 or higher
- **MongoDB** Atlas cluster (or a local MongoDB instance)
- **Telegram Bot Token** — create a bot via [@BotFather](https://t.me/BotFather)
- **OpenRouter API Key** — sign up at [openrouter.ai](https://openrouter.ai/)

---

## Installation & Setup

```bash
# 1. Clone the repository
git clone https://github.com/Gabrielduah055/schoolbridge_backend.git
cd schoolbridge_backend

# 2. Install dependencies
npm install

# 3. Copy the example environment file and fill in your values
cp .env.example .env
```

---

## Environment Variables

Create a `.env` file in the project root. **Never commit this file to Git.**

```env
# ── Server ────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development           # or "production"
FRONTEND_URL=http://localhost:5173   # CORS allowed origin

# ── MongoDB ───────────────────────────────────────────────────
MONGODB_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=SchoolBridge

# ── AI / LLM ─────────────────────────────────────────────────
OPENROUTER_API_KEY=sk-or-v1-...
# Optional: override the default model (see available models below)
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
# Optional: comma-separated fallback model list
OPENROUTER_FALLBACK_MODELS=openrouter/owl-alpha,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free

# ── School Identity ───────────────────────────────────────────
SCHOOL_NAME=AGA BASIC SCHOOL

# ── REST API Auth ─────────────────────────────────────────────
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_API_KEY=your_64_char_hex_key_here

# ── Telegram Bot ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
# Production only — must match the bot's registered webhook URL
TELEGRAM_WEBHOOK_URL=https://your-render-app.onrender.com
TELEGRAM_WEBHOOK_SECRET=your_random_secret_string
# Optional: Telegram group ID for admin escalation notifications
ADMIN_TELEGRAM_GROUP_ID=-1001234567890

# ── Email (Brevo / SMTP) ─────────────────────────────────────
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_USER=your_brevo_email@example.com
EMAIL_PASS=your_brevo_smtp_password

# ── SMS (Twilio) ─────────────────────────────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

### Available AI Models

The `OPENROUTER_MODEL` value accepts either a shorthand key or a full OpenRouter model string:

| Key | Model |
|---|---|
| `best` | `anthropic/claude-sonnet-4.5` |
| `fast` | `anthropic/claude-haiku-4.5` |
| `gpt` | `openai/gpt-4o` |
| `flash` | `google/gemini-2.5-flash-lite` |
| `cheap` | `qwen/qwen3-235b-a22b` |
| `free` | `meta-llama/llama-3.3-70b-instruct:free` *(default)* |

---

## Running the Application

### Development

```bash
npm run dev
```

Uses `nodemon` to auto-restart on file changes. The bot runs in **polling** mode locally — no webhook required.

### Production Build

```bash
npm run build    # Compile TypeScript → dist/
npm start        # Run the compiled output
```

In production, the bot switches to **webhook** mode automatically when `NODE_ENV=production`.

### Seed Sample Teachers

```bash
npx ts-node src/seedTeachers.ts
```

---

## API Reference

All protected routes require the header:
```
Authorization: Bearer <ADMIN_API_KEY>
```

### Public Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check — returns `{ message: "SchoolBridge API is running 🏫🚀" }` |
| `GET` | `/health` | Deployment health check — returns `{ status: "ok", timestamp }` |
| `POST` | `/api/chat/message` | Send a chat message to the AI agent |
| `POST` | `/api/chat/reset` | Reset a chat conversation by session ID |

#### `POST /api/chat/message`

```json
{
  "sessionId": "unique-session-id",
  "message": "What is the fee balance for my child?",
  "userRole": "parent",
  "userPhone": "+233201234567",
  "userName": "Ama Mensah",
  "modelKey": "best"
}
```

**Response:**
```json
{
  "response": "Hello Ama! Your child Kofi has an outstanding fee balance of GHS 450...",
  "sessionId": "unique-session-id",
  "model": "anthropic/claude-sonnet-4.5"
}
```

---

### Student Endpoints *(protected)*

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/students` | List all active students |
| `POST` | `/api/students` | Add a single student |
| `PUT` | `/api/students/:id` | Update a student by ID |
| `DELETE` | `/api/students/:id` | Soft-delete a student (sets status to `inactive`) |
| `POST` | `/api/students/import` | Bulk import students from Excel/CSV (max 10 MB) |

#### `POST /api/students` — Request Body

```json
{
  "name": "Kofi Mensah",
  "admissionNumber": "SB-2024-001",
  "class": "Class 3A",
  "age": 8,
  "parentName": "Ama Mensah",
  "parentPhone": "+233201234567",
  "parentEmail": "ama.mensah@gmail.com",
  "termFee": 1200
}
```

#### `POST /api/students/import` — Excel Column Mapping

The import endpoint auto-detects columns by name. Supported column headers include:

| Field | Accepted Column Names |
|---|---|
| Student Name | `Student Name`, `Full Name`, `Name` |
| Class | `Class` |
| Admission No | `Admission No`, `Admission Number`, `Student ID` |
| Parent Phone | `Parent Phone`, `Parent Contact 1`, `Phone` |
| Parent Phone 2 | `Parent Contact 2`, `Secondary Parent Phone` |
| Term Fee | `Term Fee`, `Fee` |
| Gender | `Gender` |
| Date of Birth | `Date of Birth`, `DOB` |
| Medical Condition | `Medical Condition` |
| Allergies | `Allergies` |
| Transport Needed | `Transport Needed` (`yes`/`no`) |
| Feeding Service | `Feeding Service` (`yes`/`no`) |
| *...and more* | See `src/routes/students.ts` for the full list |

---

### Knowledge Base Endpoints *(protected)*

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/knowledge` | List all knowledge documents (without content) |
| `POST` | `/api/knowledge/upload` | Upload a document and train the bot |
| `DELETE` | `/api/knowledge/:id` | Delete a document |
| `PUT` | `/api/knowledge/:id/toggle` | Toggle a document's active status |

#### `POST /api/knowledge/upload`

Send as `multipart/form-data`:

| Field | Value |
|---|---|
| `file` | The document file (PDF, XLSX, XLS, DOCX, CSV, TXT — max 10 MB) |
| `category` | One of the categories below |

**Allowed Categories:**

| Category | Description |
|---|---|
| `fee_structure` | School fee schedule |
| `student_records` | General student information |
| `school_calendar` | Academic calendar and holidays |
| `school_policies` | Conduct, uniform, and discipline policies |
| `exam_timetable` | Examination schedules |
| `class_timetable` | Daily/weekly class schedules |
| `teacher_directory` | Staff contact list |
| `other` | Any other document |

> **Note:** Uploading a new document for an existing category automatically deactivates the previous document in that category.

---

## Telegram Bot Guide

### User Commands

| Command | Description |
|---|---|
| `/start` | Begin interaction; re-sends the appropriate greeting based on current session |
| `/escalate` | Submit a manual verification request if your number is not registered |
| `/ticket` | Check the status of your most recent verification request |

### Parent Flow

1. User sends `/start`
2. Bot asks for phone number via a contact-share button
3. Phone is matched against `Students` collection — if found, user is verified as **Parent**
4. Parent can now ask about fees, timetable, calendar, policies
5. If the parent mentions forwarding a message to a teacher, the bot routes it automatically

### Teacher Flow

1. Teacher shares phone number — matched against `Teachers` collection
2. Teacher is verified and greeted with their assigned class
3. Teachers can send natural-language instructions:
   - *"Send a message to all parents that tomorrow is sports day"* → **broadcast**
   - *"Tell Kofi's parent he forgot his lunch box"* → **individual message**
   - *"Remind all parents at 6pm to bring the permission slip"* → **scheduled broadcast**
   - *"What messages have I scheduled?"* → **view pending queue**
   - *"Cancel the 6pm reminder"* → **cancel scheduled message**

### Admin Group Commands

These commands only work inside the designated admin Telegram group (`ADMIN_TELEGRAM_GROUP_ID`):

```
/approve ESC-20260601-0001
/reject  ESC-20260601-0001 Phone number belongs to a staff member, not a parent.
```

### Visitor Flow

1. User shares phone — not found in any collection → verified as **Visitor**
2. Can ask general questions (calendar, policies, admissions, contact info)
3. Cannot access any student-specific data
4. Can use `/escalate` to request manual parent verification

---

## Role System

| Role | Access Level |
|---|---|
| `parent` | Own child's data (fees, class, welfare), general school info, can message teacher |
| `teacher` | Full student records for their class, can broadcast, individual message, and schedule |
| `admin` | Full student records, school insights, management tasks (via REST API + AI chat) |
| `unregistered` | General school info only — no student or fee data |

---

## Knowledge Base

The knowledge base is the AI's primary source of school-specific information. Documents are stored in MongoDB as extracted text and injected into every AI prompt when active.

**Supported formats:** PDF, Excel (`.xlsx`, `.xls`), Word (`.docx`), CSV, plain text (`.txt`)

**Flow:**
1. Admin uploads a document via `POST /api/knowledge/upload`
2. Text is extracted from the file server-side
3. Document is saved to MongoDB with `isActive: true`
4. On every AI request, all active documents are fetched and injected into the system prompt
5. The AI answers based exclusively on this injected knowledge

---

## Scheduled Notifications

Teachers can schedule messages using natural language. The system parses the intent and stores a `ScheduledNotification` record in MongoDB.

A **cron worker** runs every minute and checks for pending notifications whose `scheduledFor` time has passed. It then executes them using the same broadcast/individual pipelines and notifies the teacher of the result.

**Example phrases teachers can use:**
- *"Remind all parents at 5:30pm that school closes early tomorrow"*
- *"Tell Afia's parent at 7pm that she received her report card"*
- *"Schedule a message to all parents for 6pm: No school on Friday"*

**Managing scheduled messages:**
- *"What messages have I scheduled?"* — lists pending queue
- *"Cancel 1"* or *"Cancel the 6pm message"* — cancels a specific job

---

## Security

| Mechanism | Implementation |
|---|---|
| **API Key Auth** | `Authorization: Bearer <key>` on all admin routes |
| **Telegram Phone Verification** | Verifies user's own Telegram-linked number; rejects forwarded contacts |
| **Account Change Detection** | Detects a different Telegram user on the same `chatId` and resets the session |
| **Rate Limiting** | Max 10 messages per 60 seconds per chat ID |
| **Class Ownership** | Teachers can only access students in their assigned class |
| **Audit Logging** | `AuditLog` collection records `verification_success`, `verification_failed`, and `access_denied` events |
| **Escalation Tickets** | Duplicate phone detection prevents gaming the verification system |
| **Webhook Secret** | Production webhook validated via `x-telegram-bot-api-secret-token` header |
| **Fail Closed** | Missing `ADMIN_API_KEY` blocks all admin routes with `503` (not `200`) |

---

## Database Models

| Model | Collection | Purpose |
|---|---|---|
| `Student` | `students` | Student records with parent contacts and medical info |
| `Teacher` | `teachers` | Teacher records with assigned class and active status |
| `User` | `users` | Parent user accounts (phone-based identity) |
| `Fee` | `fees` | Per-student fee records (term fee, amount paid, outstanding) |
| `Knowledge` | `knowledges` | Uploaded school documents (stored as extracted text) |
| `Conversation` | `conversations` | Archived chat history per parent/session |
| `Message` | `messages` | Broadcast and individual message logs |
| `TelegramSession` | `telegramsessions` | Active Telegram bot sessions with verified role and phone |
| `TelegramIdentity` | `telegramidentities` | Persistent mapping of Telegram `chatId` → phone + role |
| `ScheduledNotification` | `schedulednotifications` | Pending, sent, and cancelled scheduled messages |
| `EscalationTicket` | `escalationtickets` | Manual verification requests from unregistered users |
| `AuditLog` | `auditlogs` | Security event log |
| `Class` | `classes` | Class definitions |

---

## Project Structure

```
schoolbridge_backend/
├── src/
│   ├── index.ts                    # App entry point — wires Express, DB, bot, cron
│   ├── agents/
│   │   └── schoolAgent.ts          # Core AI agent — system prompt builder & OpenRouter caller
│   ├── bot/
│   │   └── telegram.ts             # Telegram bot — all commands, message handlers, lifecycle
│   ├── config/
│   │   └── db.ts                   # MongoDB connection
│   ├── handlers/                   # (Reserved for future HTTP handler extractions)
│   ├── middleware/
│   │   └── authorization.ts        # API key & localhost middleware
│   ├── models/                     # Mongoose schemas
│   │   ├── AuditLog.ts
│   │   ├── Class.ts
│   │   ├── Conversation.ts
│   │   ├── EscalationTicket.ts
│   │   ├── Fee.ts
│   │   ├── Knowledge.ts
│   │   ├── Message.ts
│   │   ├── ScheduledNotification.ts
│   │   ├── Students.ts
│   │   ├── Teacher.ts
│   │   ├── TelegramIdentity.ts
│   │   ├── TelegramSession.ts
│   │   └── User.ts
│   ├── routes/
│   │   ├── chat.ts                 # POST /api/chat/message, POST /api/chat/reset
│   │   ├── knowledge.ts            # Knowledge base CRUD + file upload
│   │   └── students.ts             # Student CRUD + Excel/CSV import
│   ├── services/
│   │   ├── broadcastService.ts     # Class-wide broadcast pipeline + intent detection
│   │   ├── escalationService.ts    # Manual verification ticket system
│   │   ├── parentToTeacherService.ts  # Routes parent messages to teacher
│   │   ├── scheduledNotificationService.ts  # Scheduled message management
│   │   ├── sessionService.ts       # Telegram session read/write helpers
│   │   ├── studentMessageService.ts  # Individual student-parent messaging
│   │   ├── teacherAuthService.ts   # Teacher context resolution & class validation
│   │   └── verificationService.ts  # Phone-to-parent/teacher lookup
│   ├── utils/
│   │   ├── env.ts                  # Startup environment validation
│   │   ├── logger.ts               # Pino logger instance
│   │   ├── phone.ts                # Phone number normalization & lookup helpers
│   │   └── rateLimiter.ts          # In-memory rate limiter
│   ├── workers/
│   │   └── schedulerWorker.ts      # node-cron job — fires every minute
│   └── seedTeachers.ts             # One-time seed script for teacher records
├── uploads/                        # Temporary file storage (auto-cleaned after parsing)
├── dist/                           # Compiled JavaScript output
├── .env                            # Local environment variables (do not commit)
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## Deployment

SchoolBridge is designed to deploy on [**Render**](https://render.com/) (free tier supported).

### Render Setup

1. Connect your GitHub repository to Render
2. Create a new **Web Service**
3. Set the following:

| Setting | Value |
|---|---|
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Environment** | Node |

4. Add all environment variables from the [Environment Variables](#environment-variables) section
5. Set `NODE_ENV=production`
6. Set `TELEGRAM_WEBHOOK_URL` to your Render service URL (e.g., `https://schoolbridge-backend.onrender.com`)
7. Generate a strong `TELEGRAM_WEBHOOK_SECRET` and add it

The `/health` endpoint is used by Render to confirm the service is ready before routing traffic.

### Telegram Webhook

In production, the bot automatically registers its webhook at:
```
https://<your-domain>/api/bot/webhook
```

The webhook is validated using the `x-telegram-bot-api-secret-token` header — requests without the correct secret are rejected with `403`.

---

## Contributing

Contributions are welcome! Please open an issue first to discuss the change you'd like to make.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Open a Pull Request

### Code Style

- TypeScript strict mode
- Pino structured logging (no `console.log` in production paths)
- All async errors must be caught and logged before responding

---

## Author

**Gabriel Agyeman Duah**

---

## License

ISC
