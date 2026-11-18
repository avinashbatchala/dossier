/** Browser-safe product limits shared by the engine and management UI. */
export const MAX_AGENT_SEARCHES = 3;
/** Requests to each portal in a rolling 24 hours (E22-8: per portal, not in total). */
export const AGENT_MAX_SOURCE_REQUESTS_PER_DAY = 3;
/** Slots one run can reserve: three searches on every portal it may ask. */
export const AGENT_MAX_SLOTS_PER_RUN = 60;
