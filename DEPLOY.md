# Multi-tenant deployment (Railway)

The app is a single Node.js process that serves both the API and the
built React client. Tenant is resolved from the request's subdomain
(see `server/src/middleware/tenant.ts`).

## Environment variables (Railway → Variables)

Required:
- `DATABASE_URL` — Postgres (Railway auto-provides).
- `JWT_SECRET` — strong random string. Rotating this logs everyone out.
- `NODE_ENV=production`.

Multi-tenant:
- `ROOT_DOMAIN` — parent domain for subdomains (e.g. `ishuron.com`).
- `SUPER_ADMIN_SLUG` — reserved subdomain for super-admin host (default `admin`).
- `DEV_DEFAULT_SLUG` — dev-only fallback when no subdomain present.
- `SUPER_ADMIN_PASSWORD` — optional; used by seed to override default.

## DNS (wildcard)

Point a wildcard `A` / `CNAME` at Railway:
```
*.ishuron.com  CNAME  <railway-project>.up.railway.app
ishuron.com    CNAME  <railway-project>.up.railway.app   # optional apex
```

Under Railway → Settings → Domains, add:
- `ishuron.com`
- `*.ishuron.com`

Railway issues Let's Encrypt certs for each. Wildcard requires DNS-01
challenge — Railway handles this if you manage DNS at Cloudflare and
add their DNS token under Railway → Variables.

## Subdomain → tenant mapping

- `foo.ishuron.com` → resolves `School` by `slug='foo'`.
- `admin.ishuron.com` → super-admin host (bypasses tenant scoping,
  only `/api/super/*` routes are callable).
- Apex `ishuron.com` → no subdomain; in prod returns 400.

Create a school via super-admin: `POST /api/super/schools` with
`{ slug, name, adminUsername, adminPassword }`. Client should then
navigate to `{slug}.ishuron.com`.

## Running the migration

`prisma migrate deploy` is in `server/package.json`'s build command.
Railway runs it on every deploy. To run it manually against a
remote DB, use `railway run npx prisma migrate deploy` (or set
`DATABASE_URL` inline, as we did during the 2026-04-19 migration).

## Local dev with subdomains

Add to `C:\Windows\System32\drivers\etc\hosts` (or `/etc/hosts`):
```
127.0.0.1 default.localhost
127.0.0.1 admin.localhost
127.0.0.1 school2.localhost
```

Vite dev server listens on `*.localhost:5173` automatically. The
backend extracts the subdomain from `req.hostname` which Vite
forwards through the proxy.

## Rollback

Git tag `pre-multi-tenant-migration` marks the last single-tenant
commit. To revert code:
```
git checkout pre-multi-tenant-migration
```
The DB schema will not roll back on its own — a `prisma migrate
reset --force` wipes and re-applies the old migrations but
destroys all data.
