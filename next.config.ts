import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The production image runs .next/standalone: the server and only the files
  // it needs (E12-1).
  output: "standalone",
  // playwright-core reads some of its own files by computed paths, which the
  // tracing can't follow (browsers.json for one), so all of it goes along.
  outputFileTracingIncludes: { "/**": ["./node_modules/playwright-core/**/*"] },
  logging: {
    // In development, Next.js logs every Server Action call with its
    // arguments, which would print the sign-in password (AUTH-1), API keys
    // and profile data in the terminal.
    serverFunctions: false,
  },
  poweredByHeader: false,
  // The calendar moved onto the dashboard (E15-6). The query goes along, so
  // an old link's ?date= opens that day there.
  async redirects() {
    return [{ source: "/calendar", destination: "/", permanent: false }];
  },
  // On every response (E11-5); the Content-Security-Policy comes from the
  // proxy, since it needs a nonce per request. HSTS is left to the reverse
  // proxy that serves HTTPS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Links to postings don't tell job sites which application you opened.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
        ],
      },
      // Browsers ignore COOP over plain HTTP (except on localhost) and say so
      // in the console, so it's only sent behind HTTPS.
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }],
      },
    ];
  },
};

export default nextConfig;
