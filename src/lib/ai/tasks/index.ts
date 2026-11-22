// The AI tasks of PRD §7 (E6-5). Each takes a provider, its input and the
// task options, and returns its data with the prompt version to save.
export { extractPosting } from "./extract-posting";
export { extractProfile } from "./extract-profile";
export { guessLevels } from "./guess-levels";
export type { TaskOptions } from "./prompt-parts";
export { refineChat, type ChatTurn } from "./refine-chat";
export { regenerateUnit } from "./regenerate-unit";
export { tailorResume } from "./tailor-resume";
export { writeCoverLetter } from "./write-cover-letter";
export { writeEmail } from "./write-email";
export { classifyReply } from "./classify-reply";
export { draftReply } from "./draft-reply";
export { scorePosting } from "./score-posting";
export { answerQuestion } from "./answer-question";
export { prepareInterview } from "./prepare-interview";
export { writeMessage } from "./write-message";
