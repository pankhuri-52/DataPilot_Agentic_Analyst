/**
 * DataPilot Hackathon 2026 — Presentation Generator
 * Uses pptxgenjs to build DataPilot_Hackathon.pptx
 *
 * Design: "Midnight Executive" palette, LAYOUT_16x9 (10" × 5.625")
 */

const PptxGenJS = require("pptxgenjs");

// ─── Color Palette ────────────────────────────────────────────────────────────
const C = {
  DARK_BG:      "0F1629",
  NAVY:         "1A2547",
  CARD_BG:      "1E2D4F",
  ACCENT_BLUE:  "3B82F6",
  ACCENT_CYAN:  "06B6D4",
  ACCENT_PURPLE:"8B5CF6",
  WHITE:        "FFFFFF",
  MUTED:        "94A3B8",
  LIGHT_BG:     "F8FAFC",
  DARK_TEXT:    "0F172A",
  SUCCESS:      "10B981",
  AMBER:        "F59E0B",
  RED:          "EF4444",
  SLATE:        "64748B",
  SLATE2:       "475569",
  SLATE3:       "334155",
  DEEP_BLUE:    "1E3A5F",
  DEEP_PURPLE:  "1E1040",
  DARK_AMBER:   "2D1F0A",
  DEEP_NAVY:    "0D2137",
  BADGE_NUM:    "0F172A",
};

// Shadow factory — never reuse the same object
const makeShadow = () => ({
  type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.25,
});

// ─── Init ──────────────────────────────────────────────────────────────────────
const pres = new PptxGenJS();
pres.layout = "LAYOUT_16x9"; // 10" × 5.625"
pres.title = "DataPilot — Hackathon 2026";
pres.author = "Pankhuri Trikha";

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 1 — Title / Hook
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  // Decorative orb — bottom-left (partially off-slide)
  sl.addShape(pres.shapes.OVAL, {
    x: -0.5, y: 2.8, w: 4, h: 4,
    fill: { color: C.ACCENT_BLUE, transparency: 70 },
    line: { color: C.ACCENT_BLUE, transparency: 70 },
    shadow: makeShadow(),
  });

  // Decorative orb — top-right
  sl.addShape(pres.shapes.OVAL, {
    x: 8.0, y: -0.4, w: 2.5, h: 2.5,
    fill: { color: C.ACCENT_CYAN, transparency: 80 },
    line: { color: C.ACCENT_CYAN, transparency: 80 },
  });

  // Tag pill background
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 1.2, w: 3.0, h: 0.35,
    fill: { color: "1E3A5F" },
    line: { color: C.ACCENT_BLUE, pt: 1 },
    rounding: 0.1,
  });
  sl.addText("AGENTIC AI HACKATHON · 2026", {
    x: 3.5, y: 1.2, w: 3.0, h: 0.35,
    fontSize: 10, bold: true, color: C.ACCENT_CYAN,
    charSpacing: 2, align: "center", valign: "middle",
    fontFace: "Calibri",
  });

  // Accent line under tag
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.6, y: 1.65, w: 1.2, h: 0.04,
    fill: { color: C.ACCENT_BLUE },
    line: { color: C.ACCENT_BLUE },
  });

  // Main title line 1
  sl.addText("DataPilot", {
    x: 0.5, y: 1.75, w: 9.0, h: 0.75,
    fontSize: 56, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });

  // Main title line 2
  sl.addText("Your Warehouse Partner", {
    x: 0.5, y: 2.55, w: 9.0, h: 0.45,
    fontSize: 22, bold: false, fontFace: "Calibri",
    color: C.MUTED, align: "center",
  });

  // One-liner
  sl.addText("Ask anything. Get answers. No SQL required.", {
    x: 0.5, y: 3.1, w: 9.0, h: 0.4,
    fontSize: 16, italic: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, align: "center",
  });

  // Divider line
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 3.7, w: 3.0, h: 0.025,
    fill: { color: C.ACCENT_BLUE },
    line: { color: C.ACCENT_BLUE },
  });

  // Presenter name
  sl.addText("Pankhuri Trikha", {
    x: 0.5, y: 3.85, w: 9.0, h: 0.3,
    fontSize: 14, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });

  // Event line
  sl.addText("AgentZero · DataGrokr Agentic AI Hackathon 2026", {
    x: 0.5, y: 4.2, w: 9.0, h: 0.25,
    fontSize: 11, fontFace: "Calibri",
    color: C.SLATE, align: "center",
  });

  // Bottom-left logo area
  sl.addText("DataPilot", {
    x: 0.2, y: 5.3, w: 1.5, h: 0.2,
    fontSize: 11, fontFace: "Calibri",
    color: C.ACCENT_BLUE, align: "left",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 2 — The Problem & Why It Matters
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.NAVY };

  // Left dark panel background
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.3, y: 0.3, w: 4.6, h: 5.1,
    fill: { color: C.DARK_BG },
    line: { color: C.DARK_BG },
    shadow: makeShadow(),
  });

  // Section tag
  sl.addText("THE PROBLEM", {
    x: 0.5, y: 0.55, w: 4.0, h: 0.25,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_BLUE, charSpacing: 2,
  });

  // Slide title
  sl.addText("Data is everywhere.\nAnswers aren't.", {
    x: 0.5, y: 0.9, w: 4.0, h: 1.1,
    fontSize: 32, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "left",
  });

  // Problem bullets (icon circles + text)
  const bullets = [
    { color: C.AMBER,        text: "Analysts wait days for SQL from engineers" },
    { color: C.RED,          text: "Business users can't self-serve on warehouses" },
    { color: C.ACCENT_PURPLE,text: "BI tools need deep schema expertise" },
    { color: C.ACCENT_BLUE,  text: "Questions get lost in Slack threads" },
  ];
  bullets.forEach((b, i) => {
    const rowY = 2.15 + i * 0.52;
    // Colored circle bullet
    sl.addShape(pres.shapes.OVAL, {
      x: 0.5, y: rowY + 0.06, w: 0.28, h: 0.28,
      fill: { color: b.color },
      line: { color: b.color },
    });
    // Text
    sl.addText(b.text, {
      x: 0.9, y: rowY, w: 3.8, h: 0.4,
      fontSize: 13, fontFace: "Calibri",
      color: "CBD5E1", align: "left", valign: "middle",
    });
  });

  // ── Right column ──
  // Section tag
  sl.addText("HOW BIG COMPANIES SOLVED IT", {
    x: 5.2, y: 0.55, w: 4.1, h: 0.25,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, charSpacing: 2,
  });

  // Company cards
  const cards = [
    { name: "Uber",    body: "Built QueryGPT — internal NL-to-SQL over Presto/Hive; reduced analyst query time by ~40%" },
    { name: "Airbnb",  body: "Built Minerva — semantic layer + NL query interface; democratized data access for non-engineers" },
    { name: "LinkedIn",body: "Built ThirdEye + DARWIN — self-serve analytics with NL queries over their warehouse" },
  ];
  cards.forEach((card, i) => {
    const cardY = 0.95 + i * 1.3;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 5.2, y: cardY, w: 4.1, h: 1.2,
      fill: { color: C.CARD_BG },
      line: { color: C.CARD_BG },
      shadow: makeShadow(),
    });
    sl.addText(card.name, {
      x: 5.4, y: cardY + 0.1, w: 3.7, h: 0.3,
      fontSize: 13, bold: true, fontFace: "Calibri",
      color: C.WHITE,
    });
    sl.addText(card.body, {
      x: 5.4, y: cardY + 0.42, w: 3.7, h: 0.65,
      fontSize: 11, fontFace: "Calibri",
      color: C.MUTED, wrap: true,
    });
  });

  // Bottom callout
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 5.2, y: 4.55, w: 4.1, h: 0.6,
    fill: { color: C.DEEP_NAVY },
    line: { color: C.ACCENT_BLUE, pt: 1 },
    shadow: makeShadow(),
  });
  sl.addText("\"DataPilot brings this to any warehouse — out of the box.\"", {
    x: 5.3, y: 4.6, w: 3.9, h: 0.5,
    fontSize: 12, italic: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, align: "center", valign: "middle",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 3 — Architecture
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  // Title
  sl.addText("How DataPilot Thinks", {
    x: 0.4, y: 0.2, w: 7.0, h: 0.45,
    fontSize: 28, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE,
  });
  sl.addText("A 6-node LangGraph pipeline with memory, guardrails & human-in-the-loop", {
    x: 0.4, y: 0.68, w: 8.0, h: 0.28,
    fontSize: 12, fontFace: "Calibri",
    color: C.SLATE,
  });

  // ── KB side-branch (above, between nodes 1-2) ──
  // KB Box
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 0.82, w: 2.0, h: 0.55,
    fill: { color: C.DEEP_PURPLE },
    line: { color: C.ACCENT_PURPLE, pt: 1 },
    shadow: makeShadow(),
  });
  sl.addText("pgvector Query KB", {
    x: 0.55, y: 0.87, w: 1.9, h: 0.22,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_PURPLE,
  });
  sl.addText("Match → Interrupt → Re-use", {
    x: 0.55, y: 1.09, w: 1.9, h: 0.22,
    fontSize: 9, fontFace: "Calibri",
    color: C.MUTED,
  });
  // Vertical line up from Planner
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.97, y: 1.37, w: 0.03, h: 0.58,
    fill: { color: C.ACCENT_PURPLE },
    line: { color: C.ACCENT_PURPLE },
  });
  // Arrow right toward Discovery
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.97, y: 1.37, w: 1.33, h: 0.03,
    fill: { color: C.ACCENT_PURPLE },
    line: { color: C.ACCENT_PURPLE },
  });
  // Cache hit label
  sl.addText("Cache hit?", {
    x: 1.05, y: 1.18, w: 1.2, h: 0.2,
    fontSize: 9, italic: true, fontFace: "Calibri",
    color: C.ACCENT_PURPLE,
  });

  // ── 6 Agent Nodes ──
  const nodes = [
    { label: "Planner",       sub: "Scope & intent",      accent: C.ACCENT_BLUE,   x: 0.4  },
    { label: "Discovery",     sub: "Schema + data_range",  accent: C.ACCENT_CYAN,   x: 1.75 },
    { label: "Optimizer",     sub: "SQL + cost est.",       accent: C.ACCENT_PURPLE, x: 3.1  },
    { label: "Executor",      sub: "Runs on BQ/PG",         accent: C.AMBER,         x: 4.45 },
    { label: "Validator",     sub: "Result quality",        accent: C.SUCCESS,       x: 5.8  },
    { label: "Visualization", sub: "Chart + explain",       accent: C.ACCENT_BLUE,   x: 7.15 },
  ];
  const nodeY = 1.95;
  const nodeW = 1.1;
  const nodeH = 0.7;

  nodes.forEach((n, i) => {
    // Node background
    sl.addShape(pres.shapes.RECTANGLE, {
      x: n.x, y: nodeY, w: nodeW, h: nodeH,
      fill: { color: C.CARD_BG },
      line: { color: n.accent, pt: 1 },
      shadow: makeShadow(),
    });
    // Left accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x: n.x, y: nodeY, w: 0.06, h: nodeH,
      fill: { color: n.accent },
      line: { color: n.accent },
    });
    // Label
    sl.addText(n.label, {
      x: n.x + 0.1, y: nodeY + 0.08, w: nodeW - 0.12, h: 0.3,
      fontSize: 11, bold: true, fontFace: "Calibri",
      color: C.WHITE,
    });
    // Sub-label
    sl.addText(n.sub, {
      x: n.x + 0.1, y: nodeY + 0.38, w: nodeW - 0.12, h: 0.25,
      fontSize: 9, fontFace: "Calibri",
      color: C.MUTED, wrap: true,
    });

    // Arrow to next node
    if (i < nodes.length - 1) {
      sl.addShape(pres.shapes.RECTANGLE, {
        x: n.x + nodeW, y: nodeY + nodeH / 2 - 0.015, w: 0.65, h: 0.03,
        fill: { color: C.ACCENT_BLUE },
        line: { color: C.ACCENT_BLUE },
      });
    }
  });

  // ── Human-in-the-Loop (below Executor = node 4, index 3) ──
  const executorX = nodes[3].x + nodeW / 2; // center of Executor
  // Vertical line down
  sl.addShape(pres.shapes.RECTANGLE, {
    x: executorX - 0.015, y: nodeY + nodeH, w: 0.03, h: 0.6,
    fill: { color: C.AMBER },
    line: { color: C.AMBER },
  });
  // Approval box
  sl.addShape(pres.shapes.RECTANGLE, {
    x: executorX - 0.9, y: 3.6, w: 1.8, h: 0.55,
    fill: { color: C.DARK_AMBER },
    line: { color: C.AMBER, pt: 1 },
    shadow: makeShadow(),
  });
  sl.addText("⏸ Human Approval", {
    x: executorX - 0.9, y: 3.62, w: 1.8, h: 0.24,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.AMBER, align: "center", valign: "middle",
  });
  sl.addText("Approve  ·  Decline & Re-run", {
    x: executorX - 0.9, y: 3.87, w: 1.8, h: 0.22,
    fontSize: 9, fontFace: "Calibri",
    color: "CBD5E1", align: "center", valign: "middle",
  });

  // ── Right-side info cards ──
  const infoCards = [
    { label: "LLM",           value: "Google Gemini", accent: C.ACCENT_CYAN   },
    { label: "Auth + Persist", value: "Supabase",      accent: C.ACCENT_PURPLE },
  ];
  infoCards.forEach((ic, i) => {
    const cardY = 1.3 + i * 0.85;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 8.4, y: cardY, w: 1.4, h: 0.65,
      fill: { color: C.NAVY },
      line: { color: C.DEEP_BLUE, pt: 1 },
      shadow: makeShadow(),
    });
    sl.addText(ic.label, {
      x: 8.5, y: cardY + 0.06, w: 1.2, h: 0.22,
      fontSize: 10, bold: true, fontFace: "Calibri",
      color: ic.accent,
    });
    sl.addText(ic.value, {
      x: 8.5, y: cardY + 0.3, w: 1.2, h: 0.25,
      fontSize: 11, fontFace: "Calibri",
      color: C.WHITE,
    });
  });

  // ── Legend row ──
  const legends = [
    { color: C.AMBER,         label: "Human-in-the-loop interrupt" },
    { color: C.ACCENT_PURPLE, label: "Query Knowledge Base (pgvector)" },
    { color: C.ACCENT_CYAN,   label: "Warehouse: BigQuery / PostgreSQL" },
  ];
  legends.forEach((lg, i) => {
    const lx = 0.5 + i * 2.9;
    sl.addShape(pres.shapes.OVAL, {
      x: lx, y: 4.5, w: 0.14, h: 0.14,
      fill: { color: lg.color },
      line: { color: lg.color },
    });
    sl.addText(lg.label, {
      x: lx + 0.2, y: 4.47, w: 2.5, h: 0.22,
      fontSize: 10, fontFace: "Calibri",
      color: C.MUTED,
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 4 — Live Demo
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  // Tag
  sl.addText("LIVE DEMO", {
    x: 1.5, y: 1.3, w: 7.0, h: 0.3,
    fontSize: 11, bold: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, charSpacing: 3, align: "center",
  });

  // Title
  sl.addText("Let's Ask DataPilot", {
    x: 1.5, y: 1.7, w: 7.0, h: 0.8,
    fontSize: 44, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });

  // Sub
  sl.addText("A real question. A real query. A real answer.", {
    x: 1.5, y: 2.6, w: 7.0, h: 0.4,
    fontSize: 16, italic: true, fontFace: "Calibri",
    color: C.MUTED, align: "center",
  });

  // Demo question pills
  const questions = [
    { x: 0.7,  q: "Top sales rep last quarter?" },
    { x: 3.7,  q: "Which campaign drove most orders?" },
    { x: 6.6,  q: "Revenue by brand — last 6 months?" },
  ];
  questions.forEach(({ x, q }) => {
    sl.addShape(pres.shapes.RECTANGLE, {
      x, y: 3.6, w: 2.6, h: 0.45,
      fill: { color: C.CARD_BG },
      line: { color: C.ACCENT_BLUE, pt: 1 },
      shadow: makeShadow(),
    });
    sl.addText(q, {
      x, y: 3.6, w: 2.6, h: 0.45,
      fontSize: 10, fontFace: "Calibri",
      color: C.MUTED, align: "center", valign: "middle",
    });
  });

  // Bottom caption
  sl.addText("Narrate: plan → approval interrupt → SQL → result table → chart", {
    x: 0.5, y: 4.55, w: 9.0, h: 0.3,
    fontSize: 10, italic: true, fontFace: "Calibri",
    color: C.SLATE2, align: "center",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 5 — What Makes It Agentic?
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.NAVY };

  // Vertical accent bar
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.4, y: 0.8, w: 0.06, h: 4.0,
    fill: { color: C.ACCENT_BLUE },
    line: { color: C.ACCENT_BLUE },
  });

  // Section tag
  sl.addText("NOT JUST A CHAIN OF API CALLS", {
    x: 0.65, y: 0.85, w: 3.0, h: 0.25,
    fontSize: 10, bold: true, fontFace: "Calibri",
    color: C.ACCENT_BLUE, charSpacing: 2,
  });

  // Slide title
  sl.addText("What Makes\nDataPilot Agentic?", {
    x: 0.65, y: 1.15, w: 3.1, h: 1.2,
    fontSize: 34, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE,
  });

  // Sub
  sl.addText("Four properties that define genuine agentic behavior", {
    x: 0.65, y: 2.55, w: 3.0, h: 0.5,
    fontSize: 12, fontFace: "Calibri",
    color: C.SLATE,
  });

  // Decorative large muted "AI" text
  sl.addText("AI", {
    x: 0.4, y: 3.5, w: 3.2, h: 1.8,
    fontSize: 120, bold: true, fontFace: "Trebuchet MS",
    color: C.CARD_BG, align: "left",
  });

  // ── 2x2 card grid ──
  const agentCards = [
    {
      x: 4.0, y: 0.65, accent: C.ACCENT_BLUE,
      title: "Autonomous Planning",
      body:  "Planner classifies scope — in-scope, vague, or out-of-range — without any human input",
    },
    {
      x: 6.8, y: 0.65, accent: C.ACCENT_PURPLE,
      title: "Multi-Step Reasoning",
      body:  "6-node LangGraph graph; each node decides independently; branches on KB hit, scope fail, or interrupt",
    },
    {
      x: 4.0, y: 2.75, accent: C.AMBER,
      title: "Human-in-the-Loop",
      body:  "Pauses for table + execution approval — a deliberate choice, not a limitation. Real control.",
    },
    {
      x: 6.8, y: 2.75, accent: C.SUCCESS,
      title: "Memory & Learning",
      body:  "pgvector Query KB stores past queries; embeddings match and surface similar patterns on next run",
    },
  ];
  agentCards.forEach((card) => {
    // Card bg
    sl.addShape(pres.shapes.RECTANGLE, {
      x: card.x, y: card.y, w: 2.5, h: 1.85,
      fill: { color: C.DARK_BG },
      line: { color: card.accent, pt: 1 },
      shadow: makeShadow(),
    });
    // Left accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x: card.x, y: card.y, w: 0.06, h: 1.85,
      fill: { color: card.accent },
      line: { color: card.accent },
    });
    // Title
    sl.addText(card.title, {
      x: card.x + 0.15, y: card.y + 0.1, w: 2.2, h: 0.35,
      fontSize: 13, bold: true, fontFace: "Calibri",
      color: C.WHITE,
    });
    // Body
    sl.addText(card.body, {
      x: card.x + 0.15, y: card.y + 0.5, w: 2.2, h: 1.2,
      fontSize: 11, fontFace: "Calibri",
      color: C.MUTED, wrap: true,
    });
  });

  // ── Orchestrator card — full-width bottom ──
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 4.0, y: 4.72, w: 5.6, h: 0.65,
    fill: { color: C.DARK_BG },
    line: { color: C.ACCENT_CYAN, pt: 1 },
    shadow: makeShadow(),
  });
  // Left accent bar
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 4.0, y: 4.72, w: 0.06, h: 0.65,
    fill: { color: C.ACCENT_CYAN },
    line: { color: C.ACCENT_CYAN },
  });
  sl.addText("Orchestrator  —  LLM-Powered Dynamic Router", {
    x: 4.15, y: 4.75, w: 5.3, h: 0.28,
    fontSize: 13, bold: true, fontFace: "Calibri",
    color: C.WHITE,
  });
  sl.addText("Gemini decides which node runs next — no hardcoded Python routing. Routes on KB hit, scope fail, cost block, retry, or END.", {
    x: 4.15, y: 5.04, w: 5.3, h: 0.28,
    fontSize: 10, fontFace: "Calibri",
    color: C.MUTED,
  });

  // Bottom strip quote
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.0, y: 4.72, w: 3.85, h: 0.65,
    fill: { color: C.DARK_BG },
    line: { color: C.DARK_BG },
  });
  sl.addText("\"Each node decides.\nThe graph remembers.\nYou stay in control.\"", {
    x: 0.05, y: 4.72, w: 3.8, h: 0.65,
    fontSize: 10, italic: true, fontFace: "Calibri",
    color: C.ACCENT_BLUE, align: "center", valign: "middle",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 6 — Production Readiness
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.DARK_BG };

  // Title
  sl.addText("Built for the Real World", {
    x: 0.4, y: 0.2, w: 9.0, h: 0.45,
    fontSize: 30, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE,
  });
  sl.addText("Production-grade features across guardrails, observability, and deployment", {
    x: 0.4, y: 0.7, w: 9.0, h: 0.28,
    fontSize: 12, fontFace: "Calibri",
    color: C.SLATE,
  });
  // Divider
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.1, w: 9.0, h: 0.025,
    fill: { color: C.DEEP_BLUE },
    line: { color: C.DEEP_BLUE },
  });

  // 5 feature blocks
  const row1 = [
    {
      x: 0.4, y: 1.3, accent: C.SUCCESS,
      title: "Guardrails",
      bullets: [
        "Time-window validation",
        "Scope detection",
        "Out-of-range fast-fail before SQL",
      ],
    },
    {
      x: 3.15, y: 1.3, accent: C.ACCENT_BLUE,
      title: "Observability",
      bullets: [
        "Structured logging (LOG_LEVEL)",
        "Exponential backoff retries",
        "Supabase transient-I/O retry",
      ],
    },
    {
      x: 5.9, y: 1.3, accent: C.ACCENT_PURPLE,
      title: "Evals & Testing",
      bullets: [
        "DATAPILOT_SKIP_INTERRUPTS flag",
        "MemorySaver fallback",
        "Env-flag behavior toggles",
      ],
    },
  ];
  const row2 = [
    {
      x: 1.75, y: 2.95, accent: C.AMBER,
      title: "Cloud Deployment",
      bullets: [
        "BigQuery + GCP service account",
        "Supabase Postgres checkpointer",
        "Vercel-ready env vars (incl. B64 SA key)",
      ],
    },
    {
      x: 5.25, y: 2.95, accent: C.ACCENT_CYAN,
      title: "Scalability",
      bullets: [
        "Stateless FastAPI backend",
        "Async LangGraph execution",
        "SSE streaming — no blocking waits",
      ],
    },
  ];

  [...row1, ...row2].forEach((card) => {
    // Card bg
    sl.addShape(pres.shapes.RECTANGLE, {
      x: card.x, y: card.y, w: 2.6, h: 1.55,
      fill: { color: C.NAVY },
      line: { color: C.DEEP_BLUE, pt: 1 },
      shadow: makeShadow(),
    });
    // Top accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x: card.x, y: card.y, w: 2.6, h: 0.06,
      fill: { color: card.accent },
      line: { color: card.accent },
    });
    // Title
    sl.addText(card.title, {
      x: card.x + 0.1, y: card.y + 0.12, w: 2.4, h: 0.3,
      fontSize: 14, bold: true, fontFace: "Trebuchet MS",
      color: C.WHITE,
    });
    // Bullets
    card.bullets.forEach((b, bi) => {
      sl.addText(b, {
        x: card.x + 0.1, y: card.y + 0.48 + bi * 0.33, w: 2.4, h: 0.3,
        fontSize: 11, fontFace: "Calibri",
        color: C.MUTED, bullet: true,
      });
    });
  });

  // Bottom callout bar — rich text highlighting keywords
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.7, w: 9.0, h: 0.6,
    fill: { color: C.CARD_BG },
    line: { color: C.ACCENT_BLUE, pt: 1 },
    shadow: makeShadow(),
  });
  sl.addText(
    [
      { text: "Query KB: ", options: { color: C.MUTED, fontSize: 11, fontFace: "Calibri" } },
      { text: "pgvector", options: { color: C.ACCENT_CYAN, bold: true, fontSize: 11, fontFace: "Calibri" } },
      { text: " + ", options: { color: C.MUTED, fontSize: 11, fontFace: "Calibri" } },
      { text: "gemini-embedding-001", options: { color: C.ACCENT_CYAN, bold: true, fontSize: 11, fontFace: "Calibri" } },
      { text: " · dialect-aware · schema fingerprint matching · configurable similarity threshold",
        options: { color: C.MUTED, fontSize: 11, fontFace: "Calibri" } },
    ],
    {
      x: 0.5, y: 4.7, w: 9.0, h: 0.6,
      align: "center", valign: "middle",
    }
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SLIDE 7 — Learnings & What's Next
// ──────────────────────────────────────────────────────────────────────────────
{
  const sl = pres.addSlide();
  sl.background = { color: C.NAVY };

  // Title
  sl.addText("Learnings & What's Next", {
    x: 0.5, y: 0.2, w: 9.0, h: 0.5,
    fontSize: 32, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });
  // Divider
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 0.82, w: 3.0, h: 0.025,
    fill: { color: C.DEEP_BLUE },
    line: { color: C.DEEP_BLUE },
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
      text: "LangGraph thread_id / conversation_id SSE handshake was the trickiest part — async state sync across interrupts",
    },
    {
      num: "2",
      text: "metadata.json data_range must stay in sync with actual warehouse data or guardrails mislead the model",
    },
    {
      num: "3",
      text: "pgvector KB cache: dialect + schema fingerprint matching is subtle but critical for hit rate — wrong fingerprint = always a miss",
    },
  ];
  learnings.forEach((l, i) => {
    const cardY = 1.35 + i * 1.1;
    // Card bg
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y: cardY, w: 4.2, h: 0.9,
      fill: { color: C.DARK_BG },
      line: { color: C.DEEP_BLUE, pt: 1 },
      shadow: makeShadow(),
    });
    // Left accent bar
    sl.addShape(pres.shapes.RECTANGLE, {
      x: 0.4, y: cardY, w: 0.05, h: 0.9,
      fill: { color: C.AMBER },
      line: { color: C.AMBER },
    });
    // Number badge circle
    sl.addShape(pres.shapes.OVAL, {
      x: 0.55, y: cardY + 0.25, w: 0.3, h: 0.3,
      fill: { color: C.AMBER },
      line: { color: C.AMBER },
    });
    sl.addText(l.num, {
      x: 0.55, y: cardY + 0.25, w: 0.3, h: 0.3,
      fontSize: 10, bold: true, fontFace: "Calibri",
      color: C.BADGE_NUM, align: "center", valign: "middle",
    });
    // Text
    sl.addText(l.text, {
      x: 0.95, y: cardY + 0.08, w: 3.5, h: 0.75,
      fontSize: 12, fontFace: "Calibri",
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
    x: 5.22, y: 1.35, w: 0.03, h: 3.1,
    fill: { color: C.DEEP_BLUE },
    line: { color: C.DEEP_BLUE },
  });

  const roadmap = [
    { color: C.ACCENT_BLUE,   text: "Arbitrary data source connectors — connect any warehouse URL" },
    { color: C.SUCCESS,       text: "Evals & testing suite for agent decision quality" },
    { color: C.ACCENT_CYAN,   text: "Multi-tenant support with per-org schema isolation" },
  ];
  roadmap.forEach((r, i) => {
    const ry = 1.38 + i * 0.75;
    // Circle node
    sl.addShape(pres.shapes.OVAL, {
      x: 5.13, y: ry + 0.02, w: 0.2, h: 0.2,
      fill: { color: r.color },
      line: { color: r.color },
    });
    // Text
    sl.addText(r.text, {
      x: 5.45, y: ry, w: 4.0, h: 0.38,
      fontSize: 12, fontFace: "Calibri",
      color: "CBD5E1", valign: "middle", wrap: true,
    });
  });

  // ── Bottom stats strip ──
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 0.0, y: 4.7, w: 10.0, h: 0.55,
    fill: { color: C.DARK_BG },
    line: { color: C.DARK_BG },
  });

  const stats = [
    { stat: "6",  label: "Agent Nodes",           x: 2.0 },
    { stat: "2",  label: "Warehouses Supported",   x: 5.0 },
    { stat: "0",  label: "Hardcoded SQL",           x: 8.0 },
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

  // Thank you text
  sl.addText("Thank You", {
    x: 0.5, y: 1.5, w: 9.0, h: 0.95,
    fontSize: 64, bold: true, fontFace: "Trebuchet MS",
    color: C.WHITE, align: "center",
  });

  // Divider
  sl.addShape(pres.shapes.RECTANGLE, {
    x: 3.5, y: 2.6, w: 3.0, h: 0.04,
    fill: { color: C.ACCENT_BLUE },
    line: { color: C.ACCENT_BLUE },
  });

  // Tagline
  sl.addText("DataPilot — Ask anything. Get answers. No SQL required.", {
    x: 0.5, y: 2.78, w: 9.0, h: 0.4,
    fontSize: 16, italic: true, fontFace: "Calibri",
    color: C.ACCENT_CYAN, align: "center",
  });

  // Three bottom stat chips
  const chips = [
    { label: "Built by",     value: "Pankhuri Trikha", accent: C.ACCENT_BLUE },
    { label: "Event",        value: "DataGrokr Agentic AI Hackathon 2026", accent: C.ACCENT_PURPLE },
    { label: "Date",         value: "April 3, 2026 · Session 1 · 11:45 AM", accent: C.ACCENT_CYAN },
  ];
  chips.forEach((chip, i) => {
    const cx = 0.3 + i * 3.25;
    sl.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: 3.55, w: 3.1, h: 0.7,
      fill: { color: C.CARD_BG },
      line: { color: chip.accent, pt: 1 },
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

  // Questions welcome
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
