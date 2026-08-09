# Queueless

Queueless is a hackathon prototype with:

- a customer ordering flow
- a business login/dashboard
- Supabase Postgres for stores and orders
- Supabase Auth for business owners

## Supabase Setup

1. Create a Supabase project.
2. In Supabase, open `SQL Editor`.
3. Run the SQL in `supabase-schema.sql`.
4. Create a business owner in `Authentication > Users`:

```text
owner@beanandbloom.lk
BeanBloom!2026
```

5. Copy that Auth user's UUID.
6. In `supabase-schema.sql`, replace:

```sql
'replace-with-auth-user-id'
```

with the copied UUID, then run only the final `insert into businesses...` statement.

## Environment Variables

Add your real Supabase values to `.env`:

```env
PORT=3000
NODE_ENV=development

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=paste-your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=paste-your-service-role-key-here
```

The service role key is used only in `server.js`. Do not expose it in browser code.

## Run Locally

Install dependencies:

```powershell
npm install
```

Start the server:

```powershell
npm start
```

If PowerShell blocks `npm`, use:

```powershell
npm.cmd start
```

Then open:

- Customer site: http://localhost:3000/queless.html
- Business login: http://localhost:3000/business-portal/index.html

## Test The Workflow

1. Open the customer site.
2. Go to `Place order`.
3. Submit a mock customer order.
4. Sign in to the business portal.
5. Accept, fulfil, or cancel the order.
6. Return to the customer queue page to see the status update.

## Main Files

- `server.js` - Supabase-backed API server
- `.env` - local Supabase keys
- `supabase-schema.sql` - database tables, indexes, and RLS policies
- `order.js` - customer order submission
- `queue.js` - customer queue tracking
- `business-portal/dashboard.js` - business login and dashboard behavior
