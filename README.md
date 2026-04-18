# Medirush

Medirush is a full-stack, mobile-first medicine delivery app with customer shopping, prescription upload, checkout, and owner catalogue management.

## Structure

- `artifacts/medirush` - React mobile-first client
- `artifacts/api-server` - Express API server
- `lib/api-spec` - OpenAPI contract and code generation
- `lib/db` - PostgreSQL schema and database access

## Demo accounts

- User: `user@medirush.com` / `user123`
- Owner: `owner@medirush.com` / `owner123`

## Environment variables

Copy `.env.example` values into your deployment environment.

- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` or `JWT_SECRET` - token signing secret
- `UPI_ID` - editable UPI payment ID
- `QR_CODE_IMAGE_URL` - configurable QR image URL

## Run commands

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/medirush run dev
```

## Deployment

Deploy both the API server and Medirush web artifact. The app uses `/api` for backend requests and `/` for the client preview. Set the environment variables above in production before publishing.

## Notes

The original brief mentioned MongoDB and Cloudinary. This Replit-ready version uses the built-in PostgreSQL database and local/data URL prescription image storage so it runs immediately without third-party account setup. The API and UI are structured so MongoDB or Cloudinary can be swapped in later if required.
