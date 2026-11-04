# Supabase backend setup

Brew Haven uses Supabase Auth and Supabase Edge Functions for health, products,
posts, payments, and orders in both development and production. The local
Express/Vite server only serves the website; API requests always go to the
configured Supabase project. Each function's `index.ts` is self-contained and
can be pasted into the Supabase Dashboard editor.

## Configure the project

1. In Supabase, create an Auth user for each administrator. Disable public
   sign-ups unless you intentionally want users to create accounts.
2. Set `ADMIN_EMAILS` to the comma-separated, lowercase email addresses allowed
   to use the dashboard. An authenticated account not on this list cannot access
   admin API routes.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to
   your production website URL. Add the admin Vercel deployment's exact origin
   plus `/admin-reset.html?recovery=1` to the Redirect URLs allowlist. Add
   localhost reset URLs for development if needed. If using Vercel Preview
   deployments, allow their exact reset URLs or a narrowly scoped preview
   domain pattern supported by Supabase.
4. Create five Edge Functions named `health`, `products`, `posts`, `payments`,
   and `orders`. For Dashboard deployment, paste the contents of the matching
   `supabase/functions/<name>/index.ts` into that function's `index.ts` editor
   and deploy each one. The sources are self-contained. In each function's
   settings, disable JWT verification; the handlers perform admin token checks
   themselves, while public requests and Paystack webhooks do not have an admin
   session.

   To deploy from the CLI instead, use:

   ```text
   supabase login
   supabase link --project-ref <project-ref>
   supabase functions deploy health
   supabase functions deploy products
   supabase functions deploy posts
   supabase functions deploy payments
   supabase functions deploy orders
   ```

5. In each Vercel project (main website and admin deployment), set
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the same Supabase
   project URL and public anon/publishable key, then rebuild each deployment.
   Keep project-specific values scoped to the appropriate Vercel project and
   environment. Never expose `SUPABASE_SERVICE_ROLE_KEY` or other server
   secrets in `VITE_` variables or browser code.
6. Configure these Edge Function secrets in Supabase:

   ```text
   ADMIN_EMAILS
   ALLOWED_ORIGINS
   PAYSTACK_SECRET_KEY
   PAYSTACK_CALLBACK_URL
   ```

   `ALLOWED_ORIGINS` is a comma-separated list of deployed website origins,
   without trailing slashes. Supabase provides `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.
   Never add the service-role key or Paystack secret to Vercel's `VITE_`
   variables or browser code.
7. In Paystack, configure the webhook URL as
   `https://<project-ref>.supabase.co/functions/v1/payments/webhook`.

The password-reset email must use Supabase's `{{ .ConfirmationURL }}` link so
the requested redirect URL is preserved. If a link redirects to the site root
instead of `/admin-reset.html`, verify that the exact reset URL is in
**Authentication → URL Configuration → Redirect URLs** and that the email
template uses `{{ .ConfirmationURL }}`. Reset links are single-use and expire;
if a link reports `otp_expired`, request a new one and open the newest email
once. If even new links expire immediately, check the project email provider,
mail scanner/link-preview behavior, and the expiry value in
**Authentication → Providers → Email**.

For local development, set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in the ignored root `.env` file, then run `npm run
dev`. The local site calls the same Supabase Edge Functions and uses the same
Supabase Auth, database, and Edge Function secrets as production. Do not put
the service-role key, admin allowlist, or Paystack secrets in the local
frontend environment; configure them only as Supabase Edge Function secrets.
`npm start` serves the production build from `dist`.

Admin product, post, and order functions validate access against Supabase Auth
on every admin API request. Public catalog and payment routes do not require an
admin session. Database access and Paystack secrets remain in Supabase; product
image URLs and the current database tables and records are unchanged; no
migration is required.
