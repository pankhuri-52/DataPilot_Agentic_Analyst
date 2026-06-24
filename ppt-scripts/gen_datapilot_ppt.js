/**
 * DataPilot Hackathon 2026 — Presentation Generator (v2)
 * Uses pptxgenjs to build DataPilot_Hackathon.pptx
 *
 * Design: "Midnight Executive" palette, LAYOUT_16x9 (10" × 5.625")
 * Font: Trebuchet MS for all headings · Calibri for all body / labels
 */

const PptxGenJS = require("pptxgenjs");

// ─── Color Palette ────────────────────────────────────────────────────────────
const C = {
  DARK_BG:       "0F1629",
  NAVY:          "1A2547",
  CARD_BG:       "1E2D4F",
  ACCENT_BLUE:   "3B82F6",
  ACCENT_CYAN:   "06B6D4",
  ACCENT_PURPLE: "8B5CF6",
  WHITE:         "FFFFFF",
  MUTED:         "94A3B8",
  SUCCESS:       "10B981",
  AMBER:         "F59E0B",
  RED:           "EF4444",
  SLATE:         "64748B",
  SLATE2:        "475569",
  DEEP_BLUE:     "1E3A5F",
  DEEP_PURPLE:   "1E1040",
  DARK_AMBER:    "2D1F0A",
  DEEP_NAVY:     "0D2137",
  BADGE_NUM:     "0F172A",
};

// Shadow factory — never reuse the same object
const makeShadow = () => ({
  type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.25,
});

// ─── Init ──────────────────────────────────────────────────────────────────────
const pres = new PptxGenJS();
pres.layout = "LAYOUT_16x9"; // 10" × 5.625"
pres.title  = "DataPilot — Hackathon 2026";
pres.author = "Pankhuri Trikha";

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 1 — Title / Hook
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  // Tag pill background
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 1.2, w: 3.0, h: 0.35,
    fill: { color: "1E3A5F" },
    line: { color: C.ACCENT_BLUE, pt: 1 },
  });
  sl.addText("AGENTIC AI HACKATHON · 2026", {
    x: 3.5, y: 1.2, w: 3.0, h: 0.35,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, charSpacing: 2, align: "center", valign: "middle",
  });

  // Accent line under tag
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 1.65, w: 1.2, h: 0.04,
    fill: { color: C.ACCENT_BLUE }, line: { color: C.ACCENT_BLUE },
  });

  // Main title
  sl.addText("DataPilot", {
    x: 0.5, y: 1.75, w: 9.0, h: 0.75,
    fontSize: 56, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });
  sl.addText("Your Warehouse Partner", {
    x: 0.5, y: 2.55, w: 9.0, h: 0.45,
    fontSize: 22, fontFace: "Calibri",
    color: C.MUTED, align: "center",
  });
  sl.addText("Ask anything. Get answers. No SQL required.", {
    x: 0.5, y: 3.1, w: 9.0, h: 0.4,
    fontSize: 16, italic: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, align: "center",
  });

  // Divider
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 3.7, w: 3.0, h: 0.025,
    fill: { color: C.ACCENT_BLUE }, line: { color: C.ACCENT_BLUE },
  });

  // Presenter
  sl.addText("Pankhuri Trikha", {
    x: 0.5, y: 3.85, w: 9.0, h: 0.3,
    fontSize: 14, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });
  sl.addText("AgentZero · DataGrokr Agentic AI Hackathon 2026", {
    x: 0.5, y: 4.2, w: 9.0, h: 0.25,
    fontSize: 11, fontFace: "Calibri",
    color: C.SLATE, align: "center",
  });

  // Bottom-left logo
  sl.addText("DataPilot", {
    x: 0.2, y: 5.3, w: 1.5, h: 0.2,
    fontSize: 11, fontFace: "Calibri",
    color: C.ACCENT_BLUE, align: "left",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 2 — The Problem & Why the Gap Persists
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.NAVY };

  // Left dark panel
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.3, y: 0.3, w: 4.6, h: 5.1,
    fill: { color: C.DARK_BG }, line: { color: C.DARK_BG },
    shadow: makeShadow(),
  });

  // Left — section tag
  sl.addText("THE PROBLEM", {
    x: 0.5, y: 0.55, w: 4.0, h: 0.25,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_BLUE, charSpacing: 2,
  });

  // Left — slide title
  sl.addText("Data is everywhere.\nAnswers aren't.", {
    x: 0.5, y: 0.88, w: 4.0, h: 1.05,
    fontSize: 32, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE,
  });

  // Left — problem bullets
  const bullets = [
    { color: C.AMBER,         text: "Analysts wait days for SQL from engineers" },
    { color: C.RED,           text: "Business users can't self-serve on warehouses" },
    { color: C.ACCENT_PURPLE, text: "BI tools need deep schema expertise" },
    { color: C.ACCENT_BLUE,   text: "Questions get lost in Slack threads" },
  ];
  bullets.forEach((b, i) => {
    const ry = 2.1 + i * 0.52;
    sl.addShape(pres.shapes.OVAL, {
      x: 0.5, y: ry + 0.08, w: 0.26, h: 0.26,
      fill: { color: b.color }, line: { color: b.color },
    });
    sl.addText(b.text, {
      x: 0.88, y: ry, w: 3.85, h: 0.4,
      fontSize: 13, fontFace: "Calibri",
      color: "CBD5E1", valign: "middle",
    });
  });

  // Right — section tag
  sl.addText("WHY THE GAP PERSISTS", {
    x: 5.2, y: 0.55, w: 4.1, h: 0.25,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, charSpacing: 2,
  });

  // Right — 3 stat cards
  const stats = [
    {
      stat:  "3–5 days",
      label: "average time to fulfil a business data request\nvia the engineering queue",
      color: C.AMBER,
    },
    {
      stat:  "80%",
      label: "of business users cannot query their warehouse\ndirectly without SQL expertise",
      color: C.ACCENT_PURPLE,
    },
    {
      stat:  "60%+",
      label: "of data team bandwidth consumed by ad-hoc\nreport requests vs. strategic work",
      color: C.RED,
    },
  ];
  stats.forEach((s, i) => {
    const cy = 0.92 + i * 1.28;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 5.2, y: cy, w: 4.1, h: 1.18,
      fill: { color: C.CARD_BG }, line: { color: C.CARD_BG },
      shadow: makeShadow(),
    });
    // Left accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 5.2, y: cy, w: 0.06, h: 1.18,
      fill: { color: s.color }, line: { color: s.color },
    });
    sl.addText(s.stat, {
      x: 5.4, y: cy + 0.08, w: 3.7, h: 0.44,
      fontSize: 26, bold: true, fontFace: "Trebuchet MS",
      color: s.color,
    });
    sl.addText(s.label, {
      x: 5.4, y: cy + 0.54, w: 3.7, h: 0.56,
      fontSize: 11, fontFace: "Calibri",
      color: C.MUTED, wrap: true,
    });
  });

  // Bottom callout
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 5.2, y: 4.76, w: 4.1, h: 0.55,
    fill: { color: C.DEEP_NAVY },
    line: { color: C.ACCENT_BLUE, pt: 1 },
    shadow: makeShadow(),
  });
  sl.addText("\"DataPilot brings self-serve analytics to any warehouse — out of the box.\"", {
    x: 5.3, y: 4.79, w: 3.9, h: 0.48,
    fontSize: 12, italic: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, align: "center", valign: "middle",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 3 — Architecture (Hub-and-Spoke)
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  // Title
  sl.addText("How DataPilot Thinks", {
    x: 0.4, y: 0.2, w: 9.2, h: 0.42,
    fontSize: 28, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE,
  });
  sl.addText("Hub-and-spoke: Orchestrator (LLM) decides which agent runs next — no hardcoded routing paths", {
    x: 0.4, y: 0.65, w: 9.2, h: 0.26,
    fontSize: 11, fontFace: "Calibri",
    color: C.SLATE,
  });

  // ── Orchestrator center box ──
  const OX = 3.85, OY = 1.92, OW = 2.3, OH = 0.95;
  const OCY = OY + OH / 2; // 2.395

  sl.addShape(pres.shapes.RECTANGLE, {
    x: OX, y: OY, w: OW, h: OH,
    fill: { color: "101C35" },
    line: { color: C.ACCENT_CYAN, pt: 2 },
    shadow: makeShadow(),
  });
  // Orchestrator left accent bar
  sl.addShape(pres.shapes.RECTANGLE, {
    x: OX, y: OY, w: 0.08, h: OH,
    fill: { color: C.ACCENT_CYAN }, line: { color: C.ACCENT_CYAN },
  });
  sl.addText("Orchestrator", {
    x: OX + 0.14, y: OY + 0.1, w: OW - 0.18, h: 0.32,
    fontSize: 14, bold: true, fontFace: "Calibri",
    color: C.WHITE,
  });
  sl.addText("LLM-powered dynamic router", {
    x: OX + 0.14, y: OY + 0.48, w: OW - 0.18, h: 0.32,
    fontSize: 10, fontFace: "Calibri",
    color: C.ACCENT_CYAN,
  });

  // ── Agent node drawing helper ──
  const NW = 1.6, NH = 0.52;

  function drawAgent(x, y, label, sub, accent) {
    sl.addShape(pres.shapes.RECTANGLE, {
      x, y, w: NW, h: NH,
      fill: { color: C.CARD_BG }, line: { color: accent, pt: 1 },
      shadow: makeShadow(),
    });
    sl.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.05, h: NH,
      fill: { color: accent }, line: { color: accent },
    });
    sl.addText(label, {
      x: x + 0.1, y: y + 0.05, w: NW - 0.13, h: 0.24,
      fontSize: 10, bold: true, fontFace: "Calibri",
      color: C.WHITE,
    });
    sl.addText(sub, {
      x: x + 0.1, y: y + 0.29, w: NW - 0.13, h: 0.2,
      fontSize: 8, fontFace: "Calibri",
      color: C.MUTED,
    });
  }

  // ── Left agents (x = 0.25) ──
  const LX = 0.25;
  const leftAgents = [
    { y: 0.92, label: "Query KB",          sub: "pgvector semantic cache", accent: C.ACCENT_PURPLE },
    { y: 1.66, label: "Planner",           sub: "Intent & scope",          accent: C.ACCENT_BLUE   },
    { y: 2.40, label: "Discovery",         sub: "Schema feasibility",      accent: C.ACCENT_CYAN   },
    { y: 3.14, label: "Optimizer Prepare", sub: "SQL + cost estimate",     accent: C.ACCENT_PURPLE },
  ];
  leftAgents.forEach(a => drawAgent(LX, a.y, a.label, a.sub, a.accent));

  // ── Right agents (x = 8.15) ──
  const RX = 8.15;
  const rightAgents = [
    { y: 0.92, label: "Optimizer Gate",  sub: "HITL SQL approval",     accent: C.AMBER       },
    { y: 1.66, label: "Executor",        sub: "Runs SQL on BQ / PG",   accent: C.AMBER       },
    { y: 2.40, label: "Validator",       sub: "Relevance check (LLM)", accent: C.SUCCESS     },
    { y: 3.14, label: "Visualization",   sub: "Chart + explanation",   accent: C.ACCENT_BLUE },
  ];
  rightAgents.forEach(a => drawAgent(RX, a.y, a.label, a.sub, a.accent));

  // ── Bent-connector hub-and-spoke wiring ──
  const L_RE    = LX + NW;        // left agent right edge  = 1.85
  const R_LE    = RX;              // right agent left edge  = 8.15
  const O_LE    = OX;              // orchestrator left edge = 3.85
  const O_RE    = OX + OW;        // orchestrator right edge= 6.15
  const LSPINE  = 2.45;           // left vertical spine x
  const RSPINE  = 7.55;           // right vertical spine x

  // Left vertical spine
  const L_TOPC = leftAgents[0].y + NH / 2;
  const L_BOTC = leftAgents[leftAgents.length - 1].y + NH / 2;
  sl.addShape(pres.shapes.RECTANGLE, {
    x: LSPINE - 0.015, y: L_TOPC, w: 0.03, h: L_BOTC - L_TOPC,
    fill: { color: C.SLATE2 }, line: { color: C.SLATE2 },
  });

  // Right vertical spine
  const R_TOPC = rightAgents[0].y + NH / 2;
  const R_BOTC = rightAgents[rightAgents.length - 1].y + NH / 2;
  sl.addShape(pres.shapes.RECTANGLE, {
    x: RSPINE - 0.015, y: R_TOPC, w: 0.03, h: R_BOTC - R_TOPC,
    fill: { color: C.SLATE2 }, line: { color: C.SLATE2 },
  });

  // Left stubs: agent right edge → left spine
  leftAgents.forEach(a => {
    const cy = a.y + NH / 2;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: L_RE, y: cy - 0.015, w: LSPINE - L_RE, h: 0.03,
      fill: { color: a.accent }, line: { color: a.accent },
    });
    // Junction dot on spine
    sl.addShape(pres.shapes.OVAL, {
      x: LSPINE - 0.06, y: cy - 0.06, w: 0.12, h: 0.12,
      fill: { color: a.accent }, line: { color: a.accent },
    });
  });

  // Right stubs: right spine → agent left edge
  rightAgents.forEach(a => {
    const cy = a.y + NH / 2;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: RSPINE, y: cy - 0.015, w: R_LE - RSPINE, h: 0.03,
      fill: { color: a.accent }, line: { color: a.accent },
    });
    // Junction dot on spine
    sl.addShape(pres.shapes.OVAL, {
      x: RSPINE - 0.06, y: cy - 0.06, w: 0.12, h: 0.12,
      fill: { color: a.accent }, line: { color: a.accent },
    });
  });

  // Left spine → Orchestrator left edge
  sl.addShape(pres.shapes.RECTANGLE, {
    x: LSPINE, y: OCY - 0.015, w: O_LE - LSPINE, h: 0.03,
    fill: { color: C.ACCENT_CYAN }, line: { color: C.ACCENT_CYAN },
  });
  // Orchestrator right edge → Right spine
  sl.addShape(pres.shapes.RECTANGLE, {
    x: O_RE, y: OCY - 0.015, w: RSPINE - O_RE, h: 0.03,
    fill: { color: C.ACCENT_CYAN }, line: { color: C.ACCENT_CYAN },
  });

  // ── Feedback loops legend ──
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.25, y: 4.02, w: 9.5, h: 0.025,
    fill: { color: C.DEEP_BLUE }, line: { color: C.DEEP_BLUE },
  });
  sl.addText("KEY FEEDBACK LOOPS", {
    x: 0.25, y: 4.08, w: 3.0, h: 0.2,
    fontSize: 9, bold: true, fontFace: "Calibri",
    color: C.SLATE, charSpacing: 1,
  });

  const loops = [
    { color: C.RED,           label: "Relevance FAIL",  detail: "Validator → Orchestrator → Optimizer rewrites SQL" },
    { color: C.AMBER,         label: "User Decline",    detail: "Optimizer Gate → Orchestrator → New SQL generated" },
    { color: C.ACCENT_PURPLE, label: "Executor ERROR",  detail: "Executor → Orchestrator → Optimizer auto-rectifies" },
  ];
  loops.forEach((l, i) => {
    const lx = [0.25, 3.42, 6.59][i];
    sl.addShape(pres.shapes.RECTANGLE, {
      x: lx, y: 4.32, w: 3.0, h: 0.72,
      fill: { color: C.NAVY }, line: { color: l.color, pt: 1 },
      shadow: makeShadow(),
    });
    sl.addText(l.label, {
      x: lx + 0.12, y: 4.36, w: 2.76, h: 0.25,
      fontSize: 11, bold: true, fontFace: "Calibri",
      color: l.color,
    });
    sl.addText(l.detail, {
      x: lx + 0.12, y: 4.62, w: 2.76, h: 0.36,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, wrap: true,
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 4 — Live Demo
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  sl.addText("LIVE DEMO", {
    x: 0.5, y: 0.22, w: 9.0, h: 0.28,
    fontSize: 11, bold: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, charSpacing: 3, align: "center",
  });
  sl.addText("Let's Ask DataPilot", {
    x: 0.5, y: 0.55, w: 9.0, h: 0.62,
    fontSize: 38, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });

  const demos = [
    {
      x: 0.3,
      tag:       "BIGQUERY  ·  FIRST-TIME QUERY",
      tagColor:  C.ACCENT_CYAN,
      q:         "What is the average order value by product category in Q3 2024?",
      flow:      "query_kb miss → planner → discovery → optimizer prepare → HITL approval → executor → validator → visualization",
      note:      "Full pipeline. Every agent visible in the trace.",
    },
    {
      x: 3.55,
      tag:       "POSTGRES  ·  PREVIOUSLY ASKED",
      tagColor:  C.ACCENT_PURPLE,
      q:         "Which sales rep had the highest revenue in 2024?",
      flow:      "query_kb HIT → cached SQL surfaced → HITL → executor → visualization (planner + discovery + optimizer skipped)",
      note:      "Query KB cache hit. Shows how the system learns.",
    },
    {
      x: 6.8,
      tag:       "FAILURE CASE  ·  GUARDRAIL FIRES",
      tagColor:  C.RED,
      q:         "Show me revenue for last month",
      flow:      "time_window_guard fires — data ends Dec 2024, 'last month' = March 2026 → blocked before any SQL is generated",
      note:      "Clear user-facing message. No SQL attempted.",
    },
  ];

  const CW = 3.0, CH = 3.98;
  demos.forEach(({ x, tag, tagColor, q, flow, note }) => {
    // Card background
    sl.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.35, w: CW, h: CH,
      fill: { color: C.CARD_BG }, line: { color: tagColor, pt: 1 },
      shadow: makeShadow(),
    });
    // Top accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.35, w: CW, h: 0.06,
      fill: { color: tagColor }, line: { color: tagColor },
    });
    // Tag label
    sl.addText(tag, {
      x: x + 0.12, y: 1.46, w: CW - 0.2, h: 0.22,
      fontSize: 8, bold: true, fontFace: "Calibri",
      color: tagColor, charSpacing: 1,
    });
    // Question text
    sl.addText(q, {
      x: x + 0.12, y: 1.74, w: CW - 0.2, h: 1.0,
      fontSize: 14, bold: true, fontFace: "Trebuchet MS",
      color: C.WHITE, wrap: true,
    });
    // Divider
    sl.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.12, y: 2.87, w: CW - 0.24, h: 0.025,
      fill: { color: C.DEEP_BLUE }, line: { color: C.DEEP_BLUE },
    });
    // Flow heading
    sl.addText("PIPELINE FLOW", {
      x: x + 0.12, y: 2.92, w: CW - 0.2, h: 0.2,
      fontSize: 8, bold: true, fontFace: "Calibri",
      color: C.SLATE, charSpacing: 1,
    });
    // Flow detail
    sl.addText(flow, {
      x: x + 0.12, y: 3.14, w: CW - 0.2, h: 0.9,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, wrap: true,
    });
    // Divider 2
    sl.addShape(pres.shapes.RECTANGLE, {
      x: x + 0.12, y: 4.08, w: CW - 0.24, h: 0.025,
      fill: { color: C.DEEP_BLUE }, line: { color: C.DEEP_BLUE },
    });
    // Note
    sl.addText(note, {
      x: x + 0.12, y: 4.13, w: CW - 0.2, h: 0.36,
      fontSize: 9, italic: true, fontFace: "Calibri",
      color: tagColor, wrap: true,
    });
  });

  sl.addText("Narrate: orchestrator routing decisions · HITL interrupt pause · SQL + result table → chart", {
    x: 0.5, y: 5.4, w: 9.0, h: 0.18,
    fontSize: 8, italic: true, fontFace: "Calibri",
    color: C.SLATE2, align: "center",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 5 — What Makes It Agentic?
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.NAVY };

  sl.addText("NOT JUST A CHAIN OF API CALLS", {
    x: 0.5, y: 0.2, w: 9.0, h: 0.26,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_BLUE, charSpacing: 2,
  });
  sl.addText("What Makes DataPilot Genuinely Agentic", {
    x: 0.5, y: 0.5, w: 9.0, h: 0.5,
    fontSize: 30, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE,
  });
  sl.addText("Real decisions made at runtime — not scripted logic, not a fixed pipeline", {
    x: 0.5, y: 1.05, w: 9.0, h: 0.26,
    fontSize: 12, fontFace: "Calibri",
    color: C.SLATE,
  });

  // 5 behavior cards — row 1 (3 cards) + row 2 (2 cards centered)
  const behaviors = [
    {
      accent: C.ACCENT_CYAN,
      title: "LLM Orchestrator routing",
      body:  "After every agent completes, the orchestrator model reads the full pipeline state and picks the next node. No Python if/else — the LLM reasons about gaps in the state and decides what to do next.",
    },
    {
      accent: C.ACCENT_PURPLE,
      title: "Query KB cache hit → pipeline skip",
      body:  "Orchestrator checks pgvector KB first. On a semantic + schema match, it surfaces the cached SQL and skips planner, discovery, and optimizer entirely. The system remembers.",
    },
    {
      accent: C.AMBER,
      title: "Human-in-the-loop with real consequences",
      body:  "Optimizer Gate interrupts for SQL + cost review. Decline once → Orchestrator routes back to Optimizer to regenerate a better query. Decline twice → pipeline stops gracefully.",
    },
    {
      accent: C.SUCCESS,
      title: "Relevance check reroute",
      body:  "Validator asks the model: do these returned rows actually answer the question? If NO, Orchestrator routes back to Optimizer to rewrite the SQL — without any user intervention.",
    },
    {
      accent: C.RED,
      title: "Executor error recovery",
      body:  "If the database rejects the SQL, the raw error is forwarded through Orchestrator to Optimizer. Optimizer rewrites and auto-approves, bypassing HITL re-prompt on the corrected attempt.",
    },
  ];

  const CW = 2.82, CH = 1.74;
  const R1Y = 1.38, R2Y = 3.24;
  const R1X = [0.4, 3.49, 6.58];
  const R2X = [1.94, 5.04];

  behaviors.forEach((b, i) => {
    const cx = i < 3 ? R1X[i] : R2X[i - 3];
    const cy = i < 3 ? R1Y : R2Y;

    sl.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: CW, h: CH,
      fill: { color: C.DARK_BG }, line: { color: b.accent, pt: 1 },
      shadow: makeShadow(),
    });
    sl.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 0.05, h: CH,
      fill: { color: b.accent }, line: { color: b.accent },
    });
    sl.addText(b.title, {
      x: cx + 0.12, y: cy + 0.1, w: CW - 0.16, h: 0.34,
      fontSize: 12, bold: true, fontFace: "Calibri",
      color: C.WHITE, wrap: true,
    });
    sl.addText(b.body, {
      x: cx + 0.12, y: cy + 0.5, w: CW - 0.16, h: 1.14,
      fontSize: 10, fontFace: "Calibri",
      color: C.MUTED, wrap: true,
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 6 — Production Readiness
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  sl.addText("Built for the Real World", {
    x: 0.4, y: 0.2, w: 9.2, h: 0.44,
    fontSize: 30, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE,
  });
  sl.addText("Guardrails, observability, evals, and deployment — production-grade from day one", {
    x: 0.4, y: 0.68, w: 9.2, h: 0.27,
    fontSize: 12, fontFace: "Calibri",
    color: C.SLATE,
  });
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.02, w: 9.0, h: 0.025,
    fill: { color: C.DEEP_BLUE }, line: { color: C.DEEP_BLUE },
  });

  // Card dimensions and row positions
  const CW2 = 2.6, CH2 = 1.87;
  const R1Y = 1.1, R2Y = 3.1;

  // Helper — draw a section card
  function drawSectionCard(card) {
    sl.addShape(pres.shapes.RECTANGLE, {
      x: card.x, y: card.y, w: CW2, h: CH2,
      fill: { color: C.NAVY }, line: { color: C.DEEP_BLUE, pt: 1 },
      shadow: makeShadow(),
    });
    // Top accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x: card.x, y: card.y, w: CW2, h: 0.06,
      fill: { color: card.accent }, line: { color: card.accent },
    });
    // Title
    sl.addText(card.title, {
      x: card.x + 0.1, y: card.y + 0.1, w: CW2 - 0.15, h: 0.28,
      fontSize: 13, bold: true, fontFace: "Trebuchet MS",
      color: C.WHITE,
    });
  }

  // ── Guardrails ──
  drawSectionCard({ x: 0.4, y: R1Y, accent: C.SUCCESS, title: "Guardrails" });
  [
    "SQL Injection Prevention — only SELECT ever runs",
    "Date Range Validation — blocks queries outside data window",
    "Schema Hallucination Guard — every table & column verified",
    "Self-Correction Loop — executor error → optimizer retries (×2)",
    "Cost Control — BQ dry-run; ceiling blocks expensive queries",
  ].forEach((line, bi) => {
    sl.addText(line, {
      x: 0.5, y: R1Y + 0.43 + bi * 0.27, w: CW2 - 0.15, h: 0.24,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, bullet: true,
    });
  });

  // ── Observability ──
  drawSectionCard({ x: 3.15, y: R1Y, accent: C.ACCENT_BLUE, title: "Observability" });
  // "Tool: Langfuse" header
  sl.addText("Tool: ", {
    x: 3.25, y: R1Y + 0.43, w: 0.48, h: 0.22,
    fontSize: 10, fontFace: "Calibri", color: C.MUTED,
  });
  sl.addText("Langfuse", {
    x: 3.7, y: R1Y + 0.43, w: 1.8, h: 0.22,
    fontSize: 11, bold: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN,
  });
  [
    "End-to-end traces: per-agent spans for every query",
    "Remote prompt versioning (production label, 5-min cache)",
    "Session tracking: thread_id → Langfuse session",
    "LLM call logs: input, output, latency, cost per call",
    "Custom spans: BQ dry-run bytes + Postgres table size",
  ].forEach((line, bi) => {
    sl.addText(line, {
      x: 3.25, y: R1Y + 0.69 + bi * 0.233, w: CW2 - 0.15, h: 0.22,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, bullet: true,
    });
  });

  // ── Evals & Tests ──
  drawSectionCard({ x: 5.9, y: R1Y, accent: C.ACCENT_PURPLE, title: "Evals & Tests" });
  [
    '"ignore prev instructions…" → injection guard ✓',
    '"last month revenue" → time-window guard ✓',
    '"Capital of France?" → LLM: out_of_scope ✓',
    '"Show me everything" → LLM: needs_clarification ✓',
    "Inconsistent result columns → validator fails ✓",
  ].forEach((line, bi) => {
    sl.addText(line, {
      x: 6.0, y: R1Y + 0.43 + bi * 0.27, w: CW2 - 0.15, h: 0.24,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, bullet: true,
    });
  });

  // ── Cloud Deployment ──
  drawSectionCard({ x: 1.75, y: R2Y, accent: C.AMBER, title: "Cloud Deployment" });
  [
    "OpenAI mini model — LLM for all agent reasoning",
    "Google BigQuery — warehouse + dry-run cost API",
    "Supabase Postgres — auth, checkpointer, pgvector KB",
    "GCP Service Account — B64 key injected via env var",
    "Vercel — frontend deployment + edge env vars",
  ].forEach((line, bi) => {
    sl.addText(line, {
      x: 1.85, y: R2Y + 0.43 + bi * 0.27, w: CW2 - 0.15, h: 0.24,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, bullet: true,
    });
  });

  // ── Scalability ──
  drawSectionCard({ x: 5.25, y: R2Y, accent: C.ACCENT_CYAN, title: "Scalability" });
  [
    "Stateless FastAPI — each request independent",
    "Async LangGraph — non-blocking agent execution",
    "SSE streaming — agent traces to UI in real time",
    "Postgres checkpointer — threads survive restarts",
    "pgvector KB cache — repeated patterns skip LLM calls",
  ].forEach((line, bi) => {
    sl.addText(line, {
      x: 5.35, y: R2Y + 0.43 + bi * 0.27, w: CW2 - 0.15, h: 0.24,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, bullet: true,
    });
  });

  // Bottom callout
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.06, w: 9.0, h: 0.42,
    fill: { color: C.CARD_BG }, line: { color: C.ACCENT_BLUE, pt: 1 },
    shadow: makeShadow(),
  });
  sl.addText(
    [
      { text: "Query KB: ", options: { color: C.MUTED, fontSize: 10, fontFace: "Calibri" } },
      { text: "pgvector", options: { color: C.ACCENT_CYAN, bold: true, fontSize: 10, fontFace: "Calibri" } },
      { text: " + ", options: { color: C.MUTED, fontSize: 10, fontFace: "Calibri" } },
      { text: "text-embedding-3-small", options: { color: C.ACCENT_CYAN, bold: true, fontSize: 10, fontFace: "Calibri" } },
      { text: " · dialect-aware · schema fingerprint matching · configurable similarity threshold",
        options: { color: C.MUTED, fontSize: 10, fontFace: "Calibri" } },
    ],
    { x: 0.5, y: 5.06, w: 9.0, h: 0.42, align: "center", valign: "middle" }
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 7 — Learnings & What's Next
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.NAVY };

  sl.addText("Learnings & What's Next", {
    x: 0.5, y: 0.2, w: 9.0, h: 0.5,
    fontSize: 32, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 0.82, w: 3.0, h: 0.025,
    fill: { color: C.DEEP_BLUE }, line: { color: C.DEEP_BLUE },
  });

  // ── Left column — Learnings ──
  sl.addText("LEARNINGS", {
    x: 0.4, y: 1.0, w: 4.0, h: 0.25,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.AMBER, charSpacing: 2,
  });

  const learnings = [
    {
      num: "1",
      text: "LLM-as-router is powerful but needs loop guards — without retry counters and explicit end-state signals in orchestrator state, the model can stall by re-calling the same agent.",
    },
    {
      num: "2",
      text: "LangGraph interrupt + async SSE handshake was the hardest integration — thread_id must align exactly across graph checkpoint, resume API, and frontend SSE subscription. One mismatch = silent hang.",
    },
    {
      num: "3",
      text: "pgvector similarity alone yields false cache hits across different schemas. Compound key (dialect + schema fingerprint + embedding) eliminated false positives and fixed hit precision.",
    },
  ];

  learnings.forEach((l, i) => {
    const cardY = 1.35 + i * 1.12;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y: cardY, w: 4.3, h: 1.0,
      fill: { color: C.DARK_BG }, line: { color: C.DEEP_BLUE, pt: 1 },
      shadow: makeShadow(),
    });
    // Left accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y: cardY, w: 0.05, h: 1.0,
      fill: { color: C.AMBER }, line: { color: C.AMBER },
    });
    // Number badge
    sl.addShape(pres.shapes.OVAL, {
      x: 0.55, y: cardY + 0.28, w: 0.3, h: 0.3,
      fill: { color: C.AMBER }, line: { color: C.AMBER },
    });
    sl.addText(l.num, {
      x: 0.55, y: cardY + 0.28, w: 0.3, h: 0.3,
      fontSize: 10, bold: true, fontFace: "Calibri",
      color: C.BADGE_NUM, align: "center", valign: "middle",
    });
    // Body text
    sl.addText(l.text, {
      x: 0.95, y: cardY + 0.08, w: 3.6, h: 0.84,
      fontSize: 11, fontFace: "Calibri",
      color: "CBD5E1", wrap: true, valign: "middle",
    });
  });

  // ── Right column — Roadmap ──
  sl.addText("ROADMAP", {
    x: 5.0, y: 1.0, w: 4.5, h: 0.25,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.SUCCESS, charSpacing: 2,
  });

  // Vertical timeline line
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 5.22, y: 1.35, w: 0.03, h: 3.05,
    fill: { color: C.DEEP_BLUE }, line: { color: C.DEEP_BLUE },
  });

  const roadmap = [
    { color: C.ACCENT_BLUE,   text: "Arbitrary warehouse connector — plug in any URL, auto-introspect schema, start asking" },
    { color: C.SUCCESS,       text: "Scheduled agentic reports — cron-triggered pipeline runs (e.g., top products every Monday)" },
    { color: C.ACCENT_CYAN,   text: "Collaborative queries — share results with teammates; branch into follow-up questions" },
    { color: C.ACCENT_PURPLE, text: "Eval-based CI — LLM-judge scores agent decision quality automatically on every PR" },
  ];
  roadmap.forEach((r, i) => {
    const ry = 1.38 + i * 0.76;
    sl.addShape(pres.shapes.OVAL, {
      x: 5.13, y: ry + 0.02, w: 0.2, h: 0.2,
      fill: { color: r.color }, line: { color: r.color },
    });
    sl.addText(r.text, {
      x: 5.45, y: ry, w: 4.0, h: 0.42,
      fontSize: 11, fontFace: "Calibri",
      color: "CBD5E1", valign: "middle", wrap: true,
    });
  });

  // ── Bottom stats strip ──
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.0, y: 4.72, w: 10.0, h: 0.55,
    fill: { color: C.DARK_BG }, line: { color: C.DARK_BG },
  });

  const stats = [
    { stat: "9",  label: "Graph Nodes",          x: 2.0 },
    { stat: "2",  label: "Warehouses Supported",  x: 5.0 },
    { stat: "0",  label: "Hardcoded SQL",          x: 8.0 },
  ];
  stats.forEach(({ stat, label, x }) => {
    sl.addText(stat, {
      x: x - 0.5, y: 4.68, w: 1.0, h: 0.32,
      fontSize: 32, bold: true, fontFace: "Trebuchet MS",
      color: C.ACCENT_BLUE, align: "center",
    });
    sl.addText(label, {
      x: x - 0.8, y: 5.0, w: 1.6, h: 0.22,
      fontSize: 11, fontFace: "Calibri",
      color: C.MUTED, align: "center",
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 8 — Thank You
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  // Decorative orb — bottom-left
  sl.addShape(pres.shapes.OVAL, {
    x: -0.8, y: 2.5, w: 4.5, h: 4.5,
    fill: { color: C.ACCENT_BLUE, transparency: 75 },
    line: { color: C.ACCENT_BLUE, transparency: 75 },
  });
  // Decorative orb — top-right
  sl.addShape(pres.shapes.OVAL, {
    x: 8.2, y: -0.6, w: 3.0, h: 3.0,
    fill: { color: C.ACCENT_CYAN, transparency: 80 },
    line: { color: C.ACCENT_CYAN, transparency: 80 },
  });

  sl.addText("Thank You", {
    x: 0.5, y: 1.5, w: 9.0, h: 0.95,
    fontSize: 64, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });

  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 2.6, w: 3.0, h: 0.04,
    fill: { color: C.ACCENT_BLUE }, line: { color: C.ACCENT_BLUE },
  });

  sl.addText("DataPilot — Ask anything. Get answers. No SQL required.", {
    x: 0.5, y: 2.78, w: 9.0, h: 0.4,
    fontSize: 16, italic: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, align: "center",
  });

  const chips = [
    { label: "Built by",  value: "Pankhuri Trikha",                        accent: C.ACCENT_BLUE   },
    { label: "Event",     value: "DataGrokr Agentic AI Hackathon 2026",     accent: C.ACCENT_PURPLE },
    { label: "Date",      value: "April 3, 2026 · Session 1 · 11:45 AM",   accent: C.ACCENT_CYAN   },
  ];
  chips.forEach((chip, i) => {
    const cx = 0.3 + i * 3.25;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: 3.55, w: 3.1, h: 0.7,
      fill: { color: C.CARD_BG }, line: { color: chip.accent, pt: 1 },
      shadow: makeShadow(),
    });
    sl.addText(chip.label, {
      x: cx + 0.1, y: 3.6, w: 2.9, h: 0.24,
      fontSize: 10, bold: true, fontFace: "Calibri",
      color: chip.accent,
    });
    sl.addText(chip.value, {
      x: cx + 0.1, y: 3.84, w: 2.9, h: 0.33,
      fontSize: 11, fontFace: "Calibri",
      color: C.WHITE, wrap: true,
    });
  });

  sl.addText("Questions welcome!", {
    x: 0.5, y: 4.6, w: 9.0, h: 0.35,
    fontSize: 14, fontFace: "Calibri",
    color: C.MUTED, align: "center", italic: true,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Save
// ──────────────────────────────────────────────────────────────────────────────
const OUTPUT = "DataPilot_Hackathon.pptx";
pres.writeFile({ fileName: OUTPUT })
  .then(() => console.log(`✓ Saved: ${OUTPUT}`))
  .catch((err) => { console.error("Error:", err); process.exit(1); });
