/**
 * Pick the user text to show on PDF exports: the substantive question, not short
 * confirmations (e.g. "Yes, get that period instead") after a clarify / HITL step.
 */

export interface PdfMessageLike {
  role: string;
  content?: string;
}

/** Starts like a yes/no or proceed reply (case-insensitive). */
const CONFIRM_PREFIX =
  /^(yes|yep|yeah|y\b|no|nope|ok|okay|sure|please|go ahead|do it|confirm|continue|proceed|sounds good|that works|that'?s fine|use that|get that|do that|apply that|use those|go with)\b/i;

function isLikelyConfirmation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 240) return false;
  if (CONFIRM_PREFIX.test(t)) return true;
  if (t.length < 120 && /\b(instead|that period|that range|those dates|as above)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Walk backward from the assistant message: take the nearest preceding user bubble;
 * if it looks like a confirmation, use the previous user bubble, repeating until stable.
 */
export function getPdfAnalyticalQuestion(
  messages: readonly PdfMessageLike[],
  assistantMsgIndex: number
): string {
  let idx = assistantMsgIndex - 1;
  while (idx >= 0 && messages[idx].role !== "user") idx--;
  if (idx < 0) return "";

  const visited = new Set<number>();
  while (idx >= 0 && !visited.has(idx)) {
    visited.add(idx);
    const c = (messages[idx].content ?? "").trim();
    if (!c) {
      let p = idx - 1;
      while (p >= 0 && messages[p].role !== "user") p--;
      idx = p;
      continue;
    }
    if (!isLikelyConfirmation(c)) return c;
    let p = idx - 1;
    while (p >= 0 && messages[p].role !== "user") p--;
    if (p < 0) return c;
    idx = p;
  }
  return (messages[idx]?.content ?? "").trim();
}
