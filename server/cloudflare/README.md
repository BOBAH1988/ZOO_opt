# Cloudflare Workers run API

This Worker is a free-tier hosting option for the protected `POST /run` API. It validates Firebase ID tokens, limits access to configured Firebase UIDs, validates workflow inputs, and keeps the GitHub token server-side.

## 1. Create a GitHub token

Create a fine-grained personal access token for `BOBAH1988/mail-automation` with **Actions: Read and write** permission. Do not send the token in chat or add it to the repository.

## 2. Install and log in

Install Node.js, then run from `server/cloudflare`:

```bash
npm install
npm test
npx wrangler login
```

## 3. Add Worker secrets

In Firebase Console, open **Authentication → Users** and copy your account's UID. Then run these commands from `server/cloudflare`; Wrangler prompts for each value:

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ALLOWED_UIDS
```

`ALLOWED_UIDS` is a comma-separated allowlist of accounts allowed to launch workflows. Real sends (`test_mode=false`) are denied unless you explicitly add an approved UID with `npx wrangler secret put REAL_SEND_UIDS`. Never enable real sends unless you intend to contact real recipients.

## 4. Deploy

```bash
npm run deploy
```

Wrangler prints a URL similar to `https://zoo-opt-run-api.<account>.workers.dev`. Check it with:

```bash
curl https://zoo-opt-run-api.<account>.workers.dev/health
```

The expected response is `{"ok":true}`.

## 5. Connect GitHub Pages

In `BOBAH1988/ZOO_opt`, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- Name: `VITE_API_BASE_URL`
- Value: the Worker URL without a trailing slash, for example `https://zoo-opt-run-api.<account>.workers.dev`

Push a commit to `main` or rerun the **Deploy PWA to GitHub Pages** workflow. The site build embeds this URL in the client. Never put `GITHUB_TOKEN` in `VITE_API_BASE_URL`, `ZOO`, or any client-side setting.

The Worker accepts browser requests only from `https://bobah1988.github.io`. Firebase ID token verification and the UID allowlist remain enforced for every workflow dispatch.
