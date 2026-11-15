# GrainSmart on Netlify

This app runs on Netlify as a Next.js site:

- **Database:** Netlify Database (Postgres). The tables are created automatically
  on deploy from `netlify/database/migrations/`.
- **Uploaded images and payment proofs:** Netlify Blobs (store name `uploads`).

## Required environment variables

Set these in Netlify under **Project configuration > Environment variables**:

| Name | What it is |
|------|------------|
| `ADMIN_PASSWORD_HASH` | Hash of the password for the `admin` account. Make one with `node scripts/hash-password.mjs "your password"`. |
| `ADMIN_SESSION_SECRET` | Any long random string. Used to sign admin sign-in cookies. |

Redeploy after changing them.

## Signing in

Open `/admin` and sign in with username `admin` and the password you hashed.
Staff accounts are created from the admin screen.

## Run locally

```sh
npm install
npm install -g netlify-cli
netlify dev
```
