# Contributing to DataPilot

Thanks for your interest in improving DataPilot! 🎉 This project is a multi-agent,
natural-language analytics app, and contributions of all sizes are welcome —
bug reports, docs, new agents, connector support, and UI polish.

## Ways to contribute

- 🐛 **Report a bug** — open an issue with steps to reproduce.
- 💡 **Suggest a feature** — open an issue describing the use case.
- 📖 **Improve docs** — README, `AGENTS.md`, inline comments.
- 🔌 **Add a data connector** — see `backend/db/` (`connector.py`, `factory.py`).
- 🧠 **Improve an agent** — see `backend/agents/` (planner, discovery, optimizer, etc.).

## Getting set up

1. **Fork** the repo and clone your fork.
2. Copy `.env.example` to `.env` and fill in your own keys (OpenAI + a warehouse;
   add Supabase for auth/chat). See the [README](README.md#environment-variables).
3. Install and run:

   ```bash
   # Backend
   cd backend
   python -m pip install -r requirements.txt
   python -m uvicorn main:app --reload

   # Frontend (in a second terminal)
   cd frontend
   npm install
   npm run dev
   ```

4. Read **[AGENTS.md](AGENTS.md)** — it explains the agent pipeline, critical flows,
   and the most common pitfalls. It will save you time.

## Development workflow

1. Create a branch off `main`: `git checkout -b feat/short-description`.
2. Make your change. Keep it focused — avoid unrelated drive-by refactors.
3. Match the existing code style and conventions.
4. Run the tests:

   ```bash
   cd backend
   python -m pytest tests/unit
   ```

5. Commit with a clear message and open a pull request against `main`.

## Pull request checklist

- [ ] The change is focused and described clearly in the PR.
- [ ] No secrets, API keys, or `.env` values are committed.
- [ ] Tests pass locally (and new logic has tests where practical).
- [ ] Docs (README / AGENTS.md) updated if behavior or config changed.

## Ground rules

- **Never commit secrets.** Keep all keys in `.env` (gitignored). If you think you
  may have committed one, say so in your PR so it can be scrubbed and rotated.
- Be respectful and constructive in reviews and discussions.

## Questions?

Open a [Discussion](../../discussions) or an issue. Happy to help you get started!
