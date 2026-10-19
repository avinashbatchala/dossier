// The AI tasks of PRD §7 (E6-5). Each takes a provider, its input and the
// task options, and returns its data with the prompt version to save.
export { EXTRACT_POSTING_VERSION, extractPosting } from "./extract-posting";
export { EXTRACT_PROFILE_VERSION, extractProfile } from "./extract-profile";
export { MATCH_REQUIREMENTS_VERSION, matchRequirements } from "./match-requirements";
export type { TaskOptions, TaskResult } from "./prompt-parts";
export { REFINE_CHAT_VERSION, refineChat, type ChatTurn, type Refinement } from "./refine-chat";
export { REGENERATE_UNIT_VERSION, regenerateUnit } from "./regenerate-unit";
export { TAILOR_RESUME_VERSION, tailorResume } from "./tailor-resume";
export { WRITE_COVER_LETTER_VERSION, writeCoverLetter } from "./write-cover-letter";
export { WRITE_EMAIL_VERSION, writeEmail } from "./write-email";
export { CLASSIFY_REPLY_VERSION, classifyReply, type Classified } from "./classify-reply";
export { DRAFT_REPLY_VERSION, draftReply, type DraftedReply } from "./draft-reply";
