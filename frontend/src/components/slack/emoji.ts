import type { ConfidenceState } from "@/lib/confidence";

/**
 * The **only** place in the product where an emoji is permitted
 * (design-system.md §10.4). Slack has no glyph system of our own to lean on,
 * so the state gets one emoji — and the state word is always spelled out
 * beside it, because an emoji alone survives neither a screenshot nor a
 * screen reader (screens.md §12.1).
 */
export const SLACK_EMOJI: Record<ConfidenceState, string> = {
  checking: "⏳",
  verified: "✅",
  qualified: "⚠️",
  unverified: "⚪",
  refused: "🔀",
  contested: "❗",
  superseded: "🕘",
};

/** Slack's own name for the same emoji, used in the copyable payload. */
export const SLACK_EMOJI_NAME: Record<ConfidenceState, string> = {
  checking: ":hourglass_flowing_sand:",
  verified: ":white_check_mark:",
  qualified: ":warning:",
  unverified: ":white_circle:",
  refused: ":twisted_rightwards_arrows:",
  contested: ":exclamation:",
  superseded: ":clock3:",
};
