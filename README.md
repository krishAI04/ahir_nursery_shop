# Nature Care backend

Cloudflare Worker (Hono, TypeScript) with D1 (database) and R2 (photos). It serves the store API under `/api/store` and the staff admin under `/admin`. There is no online payment: customers ask for prices on WhatsApp (`GET /api/store/contact` gives the shop's WhatsApp link; the storefront adds `?text=` with the product and size).

## Local setup

1. Use Node 24.
2. `npm ci`
3. Copy `.dev.vars.example` to `.dev.vars`. Keep `ENVIRONMENT=development` here, for local use only. It turns off the staff login check, so never set it in production.
4. `npm run db:migrate:local` to create the local database tables.
5. `npm run dev` starts the Worker at http://127.0.0.1:8787 (local database and photo storage only).

Never run `wrangler dev --remote`, and never expose a local server through a tunnel while `ENVIRONMENT=development` is set.

## Tests

1. `npm test` runs the Worker tests. They use `test/wrangler.test.jsonc` (a copy of `wrangler.jsonc` kept beside the tests, so your `.dev.vars` is never loaded). If you change bindings or vars in `wrangler.jsonc`, change that copy too.
2. `npm run test:scripts` runs the import-script tests.

## Local import

1. `npm run import -- --dry-run` shows the counts without writing anything.
2. `npm run import` loads products, categories and photos into the local database and storage.
3. `npm run maps` regenerates the size-label and product-group mapping files from the catalogue (check them by hand before committing).

A product whose photo file is missing on disk is imported as a draft (hidden), with a warning; add its photo in the admin and publish it there.

The import only creates; it never updates what is already there:

- A photo that was missing on the first import is not attached later. Upload it in the admin.
- A size that was relabelled in the source comes back as a new size on a re-import.
- If you delete the local state but `import/out/uploaded.txt` is still there, local uploads are skipped. Delete that file too.

## Production checklist (steps for Krish; none of these are run by the code)

1. Move the domain's DNS to Cloudflare.
2. Create the D1 database `nature-care` and the R2 bucket `nature-care-photos`. Put the real `database_id` in `wrangler.jsonc`.
3. `npx wrangler d1 migrations apply nature-care --remote`
4. In Cloudflare Zero Trust, create an Access application that covers `/admin*` and allows the staff emails. Put its team domain in `ACCESS_TEAM_DOMAIN` as the bare host, e.g. `yourteam.cloudflareaccess.com` (no `https://`, no slash), and its AUD tag in `ACCESS_AUD`, both in `wrangler.jsonc`.
5. Photos: until the R2 image domain exists, set `IMAGE_BASE_URL` to `https://<worker>.workers.dev/img/` (the Worker's own address), so a storefront on another site gets full photo addresses. Once the domain is on Cloudflare, give the R2 bucket the custom domain `images.natureecarenursery.in` and change `IMAGE_BASE_URL` to `https://images.natureecarenursery.in` (photos then stop counting against the Worker's free daily requests).
6. Set `STOREFRONT_ORIGINS` to the real storefront address(es).
7. Set `SHOP_WHATSAPP` in `wrangler.jsonc` to the shop's WhatsApp number: country code + number, digits only (e.g. `9198XXXXXXXX`).
8. Import the catalogue: `npm run import -- --remote --dry-run`, then `npm run import -- --remote --yes`. The photos take about 50 minutes.
9. `npx wrangler deploy`

## Notes for staff

- Price questions arrive on the shop's WhatsApp. Prices entered in the admin are optional and only for staff reference unless the storefront shows them.
