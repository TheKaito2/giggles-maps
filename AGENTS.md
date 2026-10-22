# AGENTS.md: Giggles Maps

Context for coding agents (Codex, Claude Code) working in this repo. Read this first, then the AGENTS.md in the folder you're working in.

## What the product is

Giggles Maps fills the extra time a traveller allows on a trip in Sakon Nakhon, Thailand. The user sets start, destination, leave time and "extra time I'm OK with" (minutes). The server plans a route with local stops that fits that budget. At a stop the user checks in with a selfie + GPS to collect stamps and badges (PokéStop-style). Partner shops pay per verified visit from prepaid credit. Built for the All for One University hackathon (theme "Make Me Money", bonus "improve tourism"), aiming for real App Store / Play Store launch.

## Who owns what

| Area | Folder | Owner |
|---|---|---|
| Backend (Supabase: Postgres + PostGIS, Auth, Storage, Edge Functions) | `supabase/` | Krist |
| Web: landing, web app, shop dashboard | `web/` | Krist |
| iOS app (SwiftUI) | `ios/` (not created yet) | Krist |
| **Android app (Kotlin + Jetpack Compose)** | **`android/`** | **Android collaborator** |
| Docs | `docs/` | shared |

Android work stays inside `android/`. Don't edit `supabase/`, `web/` or other folders; if the backend needs a change, write it up in the PR description or an issue for Krist.

## Read these

1. `docs/ANDROID-ROADMAP.md`: ranked feature list with "done when" criteria. Work top to bottom.
2. `docs/API.md`: the backend contract. Source of truth for requests, responses and error codes.
3. `docs/PLATFORMS.md`: which Android API to use for each feature (vs iOS).
4. `docs/ARCHITECTURE.md`: algorithms, data model, privacy rules.
5. `docs/MONETIZATION.md`: decided-but-not-built business model. Don't build its client features until `docs/API.md` covers them.
6. `web/src/app/*.tsx`, `web/src/lib/*.ts`: working reference implementation of every screen and API call.

## Hard rules

- **Never** put the Supabase secret key / service-role key in any client. Clients use only the publishable key (listed in `android/AGENTS.md`; safe to ship).
- Clients never write check-ins, billing, wallets or badges directly. Only the Edge Functions do.
- No face recognition, face embeddings or face matching anywhere. Only count faces (PDPA).
- Paid stops always show a "Partner" label ("Example partner" when `is_demo` is true). The 8 seeded partners are examples; they have not signed up. Never present them as real deals.
- The user's extra-time limit is a hard limit; the server enforces it. Don't add stops client-side.
- Commit messages: `<type>: <description>` (feat, fix, refactor, docs, test, chore, perf, ci).
- Branch per feature, open a PR to `main`. Don't push directly to `main`.
