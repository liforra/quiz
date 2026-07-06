# FISI Trainer (Quiz)

A free, extensible quiz trainer built for AP1/AP2 IT exam prep, with per-user
private quiz libraries, mode-based filtering, optional UI/quiz translations,
Gravatar profile pictures, and optional AI-assisted grading/explanations/help
(via Groq, key never exposed to the client).

## Stack

- **Frontend**: React + Vite + Tailwind, single-page app (`src/app.tsx`)
- **Data**: Firebase Auth (username/password) + Firestore
- **AI backend**: a small Express proxy (`server/index.js`) that holds the
  Groq API key server-side and injects the system prompts — the client only
  ever sends question/answer context, never sees the key or the prompts

## Quick start

```bash
npm install
cp .env.example .env              # already filled in for this project's Firebase instance
cp .env.local.example .env.local  # optional — only needed for AI features, see below
npm run dev
```

This starts both processes together (via `concurrently`, `Ctrl+C` stops both):

- Frontend: http://localhost:3849
- AI backend: http://localhost:8787 (proxied under `/api/*` by Vite in dev)

Other scripts:

- `npm run build` — production build of the frontend (`dist/`)
- `npm run server` — run just the backend
- `npm run vite:only` — run just the frontend (AI features will report as disabled)
- `npm run lint` — eslint

## Environment files

| File | Committed? | Contains |
|---|---|---|
| `.env` | Yes | Public Firebase client config (`VITE_*`). Not secret — protected by Firestore security rules, not by hiding these values. |
| `.env.local` | **No** (git-ignored via `*.local`) | Real secrets, currently just `GROQ_API_KEY`. Read only by `server/index.js`, never bundled into the client. |

Without `.env.local` / `GROQ_API_KEY`, the app works fully — AI features
(graded text-answer input, "?" explanations, the Help? chat) just stay off,
and text-input questions fall back to the old self-reported reveal flow.

## Deployment

`service.toml` runs `pnpm dev` (which maps to the same `npm run dev` script
above, just via pnpm) as a persistent background process — there is no
separate production build/serve step yet, the dev server *is* the deployment.
If you ever move to a static `vite build` + separate static host, the `/api`
proxy in `vite.config.js` needs to become a reverse-proxy rule at the hosting
layer instead, pointing at wherever `server/index.js` runs.

## Features

- **Default quizzes** — built-in FISI exam-prep quizzes shipped with the app
  (`src/quizzes/*.json`, registered in `src/defaultQuizzes.ts`). Ten subject
  quizzes (titles are the subject area, e.g. "Netzwerktechnik", "Datenbanken"),
  tagged `ap1`/`ap2` via their `modes`, 12 questions each with an even
  single/multiple/text split, mixed difficulty, fully translated DE/EN.
  They always appear in the library, can't be edited or deleted from the UI,
  and live in the repo instead of Firestore — question ids are stable strings
  so per-question stats survive app updates. To change them, edit the JSON
  files; to add one, drop a new JSON file in `src/quizzes/` and register it
  in `DEFAULT_QUIZZES`.
- **Modes/Categories** — built-in modes (`src/modes.ts`, currently AP1/AP2)
  filter the visible quiz library. Users can also create their own **private**
  custom modes (marked with a lock icon), only visible to themselves, to tag
  their own uploads. A quiz tagged with a mode doesn't need the mode name in
  its title (e.g. "Sicherheit" instead of "AP1 Sicherheit") since the active
  mode already scopes it.
- **UI language** — DE/EN toggle in the sidebar footer (`src/i18n.ts`).
- **Quiz translations** — optional, per question, see format below. Never
  required — untranslated questions silently fall back to their original text.
- **Gravatar** — set an email in Profile Settings (click your avatar in the
  sidebar) to use your Gravatar picture; falls back to initials if unset or
  unreachable.
- **Statistics** — per-category accuracy breakdown (uncategorized/legacy
  questions land under "Unknown" instead of disappearing), a "best category"
  callout, and an accuracy-over-time trend chart, filterable by category.
  Admins see the same panel for any selected user.
- **AI features** (optional, needs `GROQ_API_KEY`) — AI-graded free-text
  answers, a per-answer "explain why" popover, and a "Help?" chat that
  clarifies the question without ever revealing the answer (enforced by a
  server-side system prompt the client can't see or override).

## Quiz JSON format

Upload accepts either a bare array of questions, or `{ "questions": [...] }`.

```json
{
  "questions": [
    {
      "id": "q1",
      "type": "single",
      "category": "Sicherheit",
      "question": "Was ist ein Firewall?",
      "options": ["Ein Virenscanner", "Ein Netzwerk-Filter", "Ein Backup-Tool"],
      "answer": "Ein Netzwerk-Filter",
      "explanation": "Optional, shown on the flashcard/results review.",
      "translations": {
        "en": {
          "question": "What is a firewall?",
          "options": ["A virus scanner", "A network filter", "A backup tool"],
          "answer": "A network filter"
        }
      }
    }
  ]
}
```

- `type`: `single` (single choice), `multiple` (multi-select, `answer` is an
  array), or `text` (free-text — AI-graded if `GROQ_API_KEY` is set, otherwise
  a self-reported flashcard).
- `category`: free text, used for the per-category stats breakdown. Questions
  without one are grouped under "Unknown".
- `translations`: optional, keyed by language code (currently only `en` is
  offered in the UI). Any subset of `question` / `options` / `answer` /
  `explanation` — missing fields fall back to the base (untranslated) value.
- Quiz-level `modes: ["ap1"]` (mode ids from `src/modes.ts` or a custom
  mode's id) is set via the upload/edit dialog, not the JSON file itself.

## Admin

The account with username `liforra` gets an Admin Panel (sidebar) that can
browse every user's stats and private quizzes.
