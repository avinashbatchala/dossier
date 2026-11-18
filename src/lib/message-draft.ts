import { z } from "zod";

// A message drafted on a click (E30-7, E30-8): an answer to the offer, or a
// follow-up, kept on the application until it's sent or let go.

export const MESSAGE_KINDS = ["accept", "more", "decline", "follow-up"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Application.messageDraft */
export const messageDraftSchema = z.object({
  kind: z.enum(MESSAGE_KINDS),
  /** Who it's for: the posting's address, or empty when it doesn't give one. */
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  writtenWith: z.string(),
  /** ISO. */
  at: z.string(),
});
export type MessageDraft = z.infer<typeof messageDraftSchema>;

/** What each kind is, for its card and its toasts. */
export const MESSAGE_TITLES: Record<MessageKind, string> = {
  accept: "Your acceptance",
  more: "Asking for more",
  decline: "Declining politely",
  "follow-up": "A follow-up",
};
