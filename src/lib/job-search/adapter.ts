import "server-only";

// What the job search hands a source (E14-1). Every built-in source runs on
// the portal engine since E22-2 (src/lib/portals); its credentials are its
// config's field values, by field name.


export type RequestContext = {
  /** Replaces the source's own address; for the end-to-end tests' fake source, or a self-hosted FreeHire. */
  baseUrl?: string;
  signal?: AbortSignal;
};
