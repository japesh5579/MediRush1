# Workspace

## Overview

Medirush is a full-stack, mobile-first medicine delivery application. It includes a customer-facing shopping and checkout experience plus an owner dashboard for managing medicines and categories.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite, Tailwind CSS, React Query
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), OpenAPI-generated schemas
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild for API, Vite for frontend

## Artifacts

- `artifacts/medirush` — Medirush mobile-first web client at `/`
- `artifacts/api-server` — shared API server at `/api`

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/medirush run dev` — run Medirush frontend locally

## Demo Accounts

- User: `user@medirush.com` / `user123`
- Owner: `owner@medirush.com` / `owner123`

## Notes

The app uses Replit PostgreSQL for persistence and local/data URL prescription uploads for immediate runnable behavior without third-party services. Payment configuration is controlled with `UPI_ID` and `QR_CODE_IMAGE_URL` environment variables.
