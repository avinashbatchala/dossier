/**
 * The largest export an import takes: the proxy's body limit
 * (proxyClientMaxBodySize, 10 MB by default), beyond which bodies are cut
 * off rather than refused.
 */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_TOO_BIG = "That file is over 10 MB, more than this server accepts. See “Troubleshooting” in the wiki.";
