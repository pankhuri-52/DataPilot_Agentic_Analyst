# Supabase Setup

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project.
2. In Project Settings > API, copy:
   - Project URL → `SUPABASE_URL`
   - anon public key → `SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## 2. Run the migration

In the Supabase SQL Editor, run the contents of `migrations/001_conversations.sql`.

Or use the Supabase CLI:

```bash
supabase db push
```

## 3. Configure .env

Add to your `.env`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```
