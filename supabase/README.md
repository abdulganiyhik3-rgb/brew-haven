# Supabase backend setup

Brew Haven uses Supabase Auth for admin sign-in and separate, self-contained
Edge Functions for health, products, posts, payments, and orders. Each
function's `index.ts` can be pasted by itself into the Supabase Dashboard
editor; it has no imports from local project files. The existing Express API
remains available for local development.

## Configure the project

1. In Supabase, create an Auth user for each administrator. Disable public
   sign-ups unless you intentionally want users to create accounts.
2. Set `ADMIN_EMAILS` to the comma-separated, lowercase email addresses allowed
   to use the dashboard. An authenticated account not on this list cannot access
   admin API routes.
3. Configure the Supabase Auth site URL and redirect URL for the deployed
   website, plus localhost URLs used during development.
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

5. In Vercel, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the
   project's URL and public anon/publishable key, then rebuild the site.
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

For local development, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, and the Paystack settings in the
ignored root `.env` file. Set the two `VITE_` variables there as well for the
browser client. `npm run dev` continues to run the Express API and Vite site.

Admin product, post, and order functions validate access against Supabase Auth
on every admin API request. Public catalog and payment routes do not require an
admin session. Database access and Paystack secrets remain server-side; product
image URLs and the current database tables and records are unchanged; no
migration is required.
