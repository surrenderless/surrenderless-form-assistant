# Surrenderless — project state (source of truth)

This document aligns Cursor, ChatGPT, and humans on **product intent**, **current reality**, and **where to invest**. It describes the repo as of its last update; verify against code when in doubt.

---

## 1. True product goal

**Surrenderless is a chat-first action assistant.** The user should **not** manually fill forms, switch tabs, or go to external websites to complete submissions. The user **chats** with Surrenderless; the app:

- Gathers facts **conversationally**
- **Structures** the case
- **Generates** an in-app submission preview
- Gets **approval**
- **Submits or queues** the action when technically (and legally) possible
- **Tracks** confirmations and follow-ups
- **Carries** the issue from beginning to end

Anything that permanently treats “open another tab and paste into a government form” as the final experience is **out of scope for the long-term product**, even if it is useful as an interim step.

---

## 2. Current reality

The shipped experience is **mostly a form-first Consumer Justice case-management scaffold**:

- **Stack:** Next.js (App Router), TypeScript, **Clerk** (auth), **Supabase** (persistence via service-role API routes), **REST API routes**, **session/local storage** for active case + timeline mirror.
- **UX:** Multi-page **justice** routes (`/justice/*`): structured **form** intake (`/justice/intake`), **scripted chat** intake (`/justice/chat` — first chat-first scaffold), action plan, per-destination prep pages, dedicated evidence page, saved cases, archived cases, packet (aggregate/export). **`/justice/intake` and `/justice/chat` share** `src/lib/justice/commitIntakeToSessionAndServer.ts` (session + timeline + optional `POST /api/justice/cases` + `intake_completed` + plan handoff) and **`src/lib/justice/normalizeCompanyWebsite.ts`** (optional company website: bare domains like `amazon.com` → `https://amazon.com`, sentinels like `none` / `n/a` → empty string).
- **Persistence:** When signed in, a **`justice_cases`** row holds intake, timeline JSON, optional payment-dispute draft and client state; **evidence**, **filing records**, and **follow-up tasks** live in child tables.
- **Parallel legacy surface:** Root home (`/`) and dashboard-style flows (e.g. generic ask, form-fill demos, task logs, USPS demo) are **not** the Consumer Justice product; they share the repo.

---

## 3. What existing systems should be reused

Do **not** throw away these; they are the right backbone for a chat-first evolution:

| System | Role |
|--------|------|
| **`justice_cases`** | Canonical case: `intake`, `timeline`, `payment_dispute_draft`, `client_state`, `case_label`, `archived_at`. |
| **Timeline** | Append-only-style events (client session + server JSONB); server idempotent append for resource-linked events. |
| **Evidence** | Metadata rows (no file blobs in MVP); types/labels in `src/lib/justice/evidence.ts`. |
| **Filing records** | User-tracked external/manual filings; confirmation numbers, URLs, notes. |
| **Follow-up tasks** | Titles, text due dates, notes, completion; ties to timeline. |
| **Readiness** | `src/lib/justice/caseReadiness.ts` and plan UX (“ready to escalate” vs “needs more info”). |
| **Saved cases** | `src/app/justice/cases/page.tsx` + `GET/PATCH` case APIs; search/filter/sort (client-side). |
| **Packet generation** | `src/app/justice/packet/page.tsx` — aggregate intake, timeline, evidence, filings, tasks for review/export. |
| **Action routing / rules** | `src/lib/justice/rules.ts` — destination ordering, locks, FTC/CFPB/FCC relevance, payment dispute availability. |

New conversational UI should **read and write** these same primitives (intake shape can evolve carefully; prefer additive fields and migrations if the schema changes).

---

## 4. What should not be expanded blindly

- **Do not** keep adding **disconnected form pages** as the primary UX; each new `/justice/*` wizard is debt unless it converges on chat-first or a single shell.
- **Do not** treat **external links + manual filing** as the **final** product story; they are acceptable **transition** paths, not the north star.
- **Do not** grow **mock/demo flows** (e.g. internal practice forms) as if they were **production** regulatory submission; label them, isolate them, and avoid coupling core case state to test-only pages.

---

## 5. Near-term direction

**Bend the Consumer Justice MVP toward chat-first intake and action** while **preserving** persistence and case management:

- **`/justice/chat` is now shipped** as the **first chat-first Justice intake scaffold**: **scripted** Q&A (not LLM-driven yet), **one question at a time**, answers accumulated into the same **`JusticeIntake`** shape, then committed via **`src/lib/justice/commitIntakeToSessionAndServer.ts`** (same path as form intake: **`STORAGE_INTAKE` / `STORAGE_CASE_ID`**, **`case_started`**, optional **`POST /api/justice/cases`**, server id/timeline merge, **`intake_completed`**, caller navigates to **`/justice/plan`**). Company website uses **`src/lib/justice/normalizeCompanyWebsite.ts`** on both **`/justice/intake`** and **`/justice/chat`**. **`/justice/intake` stays the form fallback** (also linked from the header as “Consumer case”).
- Introduce a **conversational intake** that still produces (or updates) the same **`JusticeIntake`** / case row — forms become fallback or “edit details,” not the only path.
- Surface **one** primary workspace (shell) that shows **case status**, **next actions**, and **approval previews** instead of scattering state across many routes without a narrative.
- Reuse **timeline + tasks + filings** for “what happened / what’s next” instead of duplicating status in ad-hoc UI only.
- Keep **server timeline append** and **PATCH case** patterns for anything that must stay consistent under automation later.
- **Next:** evolve chat toward **LLM-assisted** follow-ups and previews while keeping the same persistence primitives; avoid parallel ad-hoc state outside `JusticeIntake` + session keys.

---

## 6. Current technical map

### Major app routes (`src/app/**/page.tsx`)

| Area | Paths (representative) |
|------|-------------------------|
| Legacy / misc | `/` (home), `/dashboard`, `/admin`, `/sign-in`, `/debug/me` |
| Justice | `/justice/intake` (form intake), **`/justice/chat`** (scripted chat intake → plan), `/justice/plan`, `/justice/merchant`, `/justice/payment-dispute`, `/justice/ftc-review`, `/justice/bbb`, `/justice/state-ag`, `/justice/cfpb`, `/justice/fcc`, `/justice/evidence`, `/justice/cases`, `/justice/cases/archived`, `/justice/packet` |
| Internal QA | `/mock/ftc-complaint` |

### Major Justice components (`src/app/components/`)

- **`Header.tsx`** — Global nav links: **Consumer case** (`/justice/intake`), **Chat intake** (`/justice/chat`), plus Clerk controls; used across Justice pages.
- **`JusticeActionResumeSignInPrompt.tsx`** — Hydration gate when session/user is insufficient.
- **`JusticeSavedEvidenceList.tsx`** — Evidence list for current session case (prep pages).
- **`JusticeFilingRecords.tsx`** — Filing CRUD for current case.
- **`JusticeCaseTasks.tsx`** — Task CRUD + due badges; used on **plan** and **packet** (not every prep page).

### Justice API routes (`src/app/api/justice/`)

- **`cases`** — `GET` list (non-archived default; `?archived=1` for archived); `POST` create. **`GET` is capped (e.g. limit 10)** — see limitations.
- **`cases/[id]`** — `GET` one case; `PATCH` intake, timeline, drafts, `archived_at`, `case_label`.
- **`evidence`**, **`evidence/[id]`** — List/create; update/delete; POST may append server timeline (`evidence_added`).
- **`filings`**, **`filings/[id]`** — Same pattern; `filing_recorded` on create.
- **`tasks`**, **`tasks/[id]`** — Same pattern; `task_added` / completion-related updates.
- **`events`** — Authenticated analytics append (expects a `history`-style table in Supabase; **not defined in repo migrations** — see limitations).

### Supabase tables (from `supabase/migrations/`)

| Table | Purpose |
|-------|---------|
| **`justice_cases`** | `id`, `user_id` (text), `intake` (jsonb), `timeline` (jsonb), `payment_dispute_draft`, `client_state`, timestamps, `archived_at`, `case_label`. RLS enabled; **no policies on cases** — access enforced in API with Clerk `user_id` + admin client. |
| **`justice_case_evidence`** | Metadata evidence rows; optional `source_url`, `storage_note`. RLS policies use **`authenticated` / `auth.uid()`** — **not** how server routes access data (service role bypasses RLS). |
| **`justice_case_filings`** | Manual/external filing records. |
| **`justice_case_tasks`** | Follow-up tasks. |

**Referenced in code but not in repo migrations:** `users` (profile init upsert), `history` (justice events). Deployments must define these separately or migrations must be added.

### Key libraries (`src/lib/justice/`)

- **`types.ts`** — `JusticeIntake`, timeline types, **storage key constants**.
- **`commitIntakeToSessionAndServer.ts`** — Shared client helper used by **`/justice/intake`** and **`/justice/chat`**: after validation, commits a completed **`JusticeIntake`** into **`STORAGE_INTAKE`** / **`STORAGE_CASE_ID`**, clears prior timeline scope, appends **`case_started`**, clears FTC/mock session keys, **`POST /api/justice/cases`** with `{ intake, timeline }` when signed in (with **session-only fallback** if the request fails), replaces local case id with server id/timeline when returned, fires **`intake_completed`** analytics; callers **`router.push("/justice/plan")`**.
- **`normalizeCompanyWebsite.ts`** — Shared normalizer for **`company_website`** on **`/justice/intake`** and **`/justice/chat`**: empty / `none` / `n/a` / `-` / `no` → `""`; values already starting with **`http://`** or **`https://`** unchanged; bare hosts (e.g. **`amazon.com`**) → **`https://amazon.com`**. Form intake uses **`type="text"`** (not **`type="url"`**) so bare domains are not blocked by the browser.
- **`timeline.ts`** — Session timeline store, sync helpers, many `append*Once` helpers.
- **`rules.ts`** — Destination computation and gating.
- **`caseReadiness.ts`**, **`caseApiValidation.ts`**, **`hydrateActiveCaseFromServer.ts`**, **`clearLocalJusticeSession.ts`**, **`taskDueStatus.ts`**, **`useJusticeActionPageHydration.ts`**, etc.

### Session / local storage keys (from `src/lib/justice/types.ts` and `clearLocalJusticeSession.ts`)

| Key constant | Storage key string | Purpose |
|--------------|-------------------|---------|
| `STORAGE_INTAKE` | `justice_intake_v1` | Active case intake JSON |
| `STORAGE_CASE_ID` | `justice_case_id` | Active case UUID |
| `STORAGE_TIMELINE_V1` | `justice_timeline_v1` | JSON map of case id → timeline entries |
| `STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1` | `justice_payment_dispute_checklist_draft_v1` | Payment dispute draft |
| `STORAGE_FTC_MANUAL_UNLOCK` | `justice_ftc_manual_unlock` | Manual FTC unlock flag |
| (session) | `justice_ftc_mock_completed` | Mock FTC lane completion (cleared with full justice session clear) |

### Auth / server

- **Clerk:** `ClerkProvider` in `src/app/layout.tsx` and `src/app/providers.tsx` (duplicate provider wrap — known quirk).
- **Middleware:** `src/middleware.ts` — `clerkMiddleware`; optional `DEPLOY_PASSWORD` Basic Auth gate.
- **API auth:** `src/server/requireUser.ts` — `getAuth(request).userId` for Justice routes.

### Known limitations (non-exhaustive)

- **Case list cap:** `GET /api/justice/cases` returns a **limited** number of rows (e.g. 10) — “resume latest” and saved list omit older cases.
- **Dual timeline:** Session + DB can drift if sync fails or multiple tabs are used.
- **Pre-server case id:** Intake can generate a non-UUID id in edge environments; evidence/task APIs require UUID `case_id`.
- **RLS vs Clerk:** Child-table RLS policies target Supabase Auth `uid`; app uses **Clerk id + service role** — fine for current server-only access, confusing if client-side Supabase is introduced without redesign.
- **Analytics / profile tables** not versioned in this repo’s migrations.

---

## 7. Development workflow

1. **Branch:** Do feature work on **`cursor-dev`** (or team-agreed equivalent), not directly on `main` for risky changes.
2. **Typecheck:** Run **`npx tsc --noEmit`** before commit/PR.
3. **Test:** Exercise flows locally (intake → plan → cases → evidence/tasks/filings as relevant).
4. **Commit:** Clear, scoped commits.
5. **Push** `cursor-dev` and open a **PR to `main`**.
6. **Merge** after review.
7. **Sync:** Merge or rebase **`main` back into `cursor-dev`** so the long-lived branch stays current.

Adjust branch names if the team renames them; the pattern is **integration branch → PR → main → back-merge**.

---

## Document maintenance

Update this file when:

- Product north star changes.
- A new persistent subsystem is added (new tables, major routes).
- Known limitations are fixed (e.g. pagination for cases).

**Do not** duplicate every file path here forever — link to `docs/` or code search for exhaustive inventories when needed.
