# Supabase Setup

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project.
2. In Project Settings > API, copy:
   - Project URL → `SUPABASE_URL`
   - anon public key → `SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## 2. Run the migration

In the Supabase SQL Editor, run the migrations in order:
1. `migrations/001_conversations.sql` – creates `conversations` and `messages` tables, indexes, RLS.
2. `migrations/002_chat_schema_docs.sql` – adds schema comments (optional).
3. `migrations/003_query_kb.sql` – RPCs `match_query_kb` and `insert_query_kb_entry` for the query knowledge base. Requires the `vector` extension and a `public.query_kb_entries` table whose `embedding` column size matches `GEMINI_EMBEDDING_DIMENSION` (default **768**).

Or use the Supabase CLI:

```bash
supabase db push
```

## 3. Configure .env

Add to your `.env` (backend):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
FRONTEND_URL=http://localhost:3000
```

For the frontend (password reset flow), add to `frontend/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

## 4. Auth redirect URLs (for password reset)

In Supabase Dashboard → Authentication → URL Configuration, add to **Redirect URLs**:

- `http://localhost:3000/reset-password` (local dev)
- Your production URL + `/reset-password` when deploying

## 5. Email confirmation (optional)

To require email verification before sign-in, enable **Confirm email** in Supabase Dashboard → Authentication → Providers → Email. Users will see a "Check your email" message after signup.

## 6. Password reset email template (fixes "link expired" and "no email" issues)

**Problem:** Many email providers (Gmail, Outlook, etc.) automatically prefetch links in emails for security scanning. This consumes the single-use reset token before the user can click it, causing "expired" errors. Supabase may also rate-limit repeated reset requests.

**Solution:** Update the "Reset password" email template in Supabase Dashboard → Authentication → Email Templates → "Reset password":

1. **Use a custom link** so the email points to your app first (token is only consumed when the user clicks "Continue" on your page):

Replace the default template body with:

```html
<h2>Reset Password</h2>
<p>Reset the password for your account by clicking the button below:</p>
<p><a href="{{ .SiteURL }}/reset-password?confirmation_url={{ .ConfirmationURL | urlquery }}">Reset password</a></p>
<p>Or use this 6-digit code on the reset page: <strong>{{ .Token }}</strong></p>
<p>This code expires in 24 hours.</p>
```

If `urlquery` causes errors, try without it: `confirmation_url={{ .ConfirmationURL }}` (some Supabase versions may not support it).

2. Ensure **Site URL** in Authentication → URL Configuration is set correctly (e.g. `http://localhost:3000` for local dev).

3. If you don't receive reset emails on repeated requests, wait 1 hour (Supabase rate limit) or check your spam folder.
