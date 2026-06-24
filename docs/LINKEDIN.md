# LinkedIn launch content for DataPilot

Two pieces below: a **long-form article** (for LinkedIn Articles / newsletter) and a
**short feed post** (the actual scroll-stopping post that links to the repo + article).
Replace the bracketed placeholders before publishing.

---

## 1) Long-form article

**Title:** I built an AI analyst that turns plain-English questions into SQL, charts, and answers — here's the architecture

**Subtitle:** DataPilot is a multi-agent analytics app I built and just open-sourced. Here's how the agents actually work — and why I added an approval gate before any query runs.

---

Most "chat with your data" demos hide a scary truth: an LLM writes some SQL, runs it against your warehouse, and hopes for the best. That's fine for a toy. It's not fine when the query is wrong, expensive, or pointed at the wrong dates.

So for a recent hackathon I built **DataPilot** — and today I'm open-sourcing it.

DataPilot lets anyone ask a question like _"What were our top 10 products by revenue last month?"_ and get back a planned analysis, the SQL, an interactive chart, and a plain-English explanation. The interesting part isn't the chat box. It's what happens between the question and the answer.

### It's not one prompt — it's a team of agents

Instead of one giant prompt, DataPilot runs a **hub-and-spoke pipeline** orchestrated with **LangGraph**. An LLM orchestrator routes the question through specialist agents, each with one job:

- **Planner** — decides the metrics, dimensions, and filters, and classifies scope (is this even a data question?).
- **Discovery** — checks the request against the actual schema. Can we even answer this with the tables we have?
- **Optimizer** — generates and tightens the SQL.
- **Executor** — runs the query against BigQuery or PostgreSQL.
- **Validator** — sanity-checks the results.
- **Visualization** — picks the right chart (bar, line, pie, table) and builds the spec.

Breaking the problem into focused agents made each step debuggable and testable — and made the whole thing far more reliable than a single mega-prompt.

### The part I'm most proud of: guardrails

A natural-language analyst is only useful if you can trust it. Three things make DataPilot trustworthy:

1. **Human-in-the-loop approval.** Before any query executes, the graph pauses and asks the user to approve — with an optional cost estimate on BigQuery. The AI proposes; the human decides.
2. **Scope guardrails.** Off-topic questions get a clear "that's outside your data" response instead of a hallucinated answer. Vague questions trigger a clarification.
3. **Time-window guardrails.** "Last month" is validated against the actual date ranges in the data *before* SQL runs — so you never get confidently wrong results for a window that doesn't exist.

On top of that, every LLM call is traced in **Langfuse**, so I can see exactly what each agent did, what it cost, and where it went wrong.

### The stack

- **Frontend:** Next.js 14 (App Router), Tailwind, shadcn/ui, Recharts
- **Backend:** FastAPI with SSE streaming so you watch the agents work in real time
- **Agents:** LangGraph (orchestrator + 6 specialists)
- **LLM:** OpenAI
- **Warehouse:** BigQuery or PostgreSQL (swappable via a connector factory)
- **Auth + chat history:** Supabase
- **Observability:** Langfuse

### Why open source instead of a SaaS?

I thought hard about this. A SaaS would mean billing, multi-tenancy, support, and uptime — months of plumbing that has nothing to do with the actual idea. Open source means anyone can clone it, plug in their own keys, point it at their own warehouse, and use it today. And the architecture is genuinely useful to learn from if you're building agentic systems.

So it's **MIT licensed, bring-your-own-key, and open to contributions.**

👉 **Repo:** [GITHUB_REPO_LINK]
🎬 **60-second demo** is in the README.

If you're building agentic apps — or you've wrestled with "chat with your data" reliability — I'd love your thoughts, issues, and PRs.

What would you add next: more warehouse connectors, a semantic layer, or a self-correcting SQL loop? Let me know. 👇

#AI #LLM #DataEngineering #Analytics #LangGraph #OpenSource #Agents #SQL #BuildInPublic

---

## 2) Short feed post (recommended for reach)

> Most "chat with your data" tools let an LLM write SQL and run it blind. 😬
>
> So I built **DataPilot** — and just open-sourced it.
>
> Ask a question in plain English → it plans the analysis, checks your schema, writes the SQL, ⛔️ pauses for your approval, runs it, validates the result, and draws the chart.
>
> Under the hood it's not one prompt — it's a team of 6 specialist AI agents orchestrated with LangGraph, with real guardrails:
> ✅ Human-in-the-loop approval before any query runs
> ✅ Scope checks (no hallucinated answers to off-topic questions)
> ✅ Time-window validation against real data ranges
> ✅ Full Langfuse tracing on every step
>
> Stack: Next.js + FastAPI + LangGraph + OpenAI + BigQuery/Postgres + Supabase.
>
> It's MIT licensed and bring-your-own-key — clone it, plug in your keys, point it at your warehouse.
>
> ⭐ Repo + 60s demo: [GITHUB_REPO_LINK]
>
> Building agentic apps or fighting "chat with your data" reliability? I'd love your feedback, issues, and PRs.
>
> #AI #LLM #DataEngineering #LangGraph #OpenSource #Analytics #BuildInPublic

---

### Posting tips

- **Post the short version to your feed**, and publish the long version as a LinkedIn Article — then link the article in a comment (not the body) so the post's reach isn't penalized for an external link in the first comment instead.
- Lead with the **demo GIF/video** as the post media — video crushes text-only reach.
- Reply to every early comment in the first hour; it compounds reach.
- Tag the tooling communities where relevant (LangChain/LangGraph, Supabase) — but only if genuinely relevant.
