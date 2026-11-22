import { WIKI, type Instruction } from "./instructions";

// The setup guide's Gmail and Calendar step (E21-5): Google Cloud's steps,
// as Google's docs gave them on 5 November 2026 (Google Auth Platform's
// Branding, Audience and Clients pages).

export const GOOGLE_STEPS: readonly Instruction[] = [
  {
    text: "Sign in to Google Cloud with your Google account and create a project. Name it **Dossier** and press **Create**.",
    link: { href: "https://console.cloud.google.com/projectcreate", label: "Google Cloud" },
  },
  {
    text: "Turn on the Gmail API: check that your new project is chosen at the top of the page, then press **Enable**.",
    link: { href: "https://console.cloud.google.com/apis/enableflow;apiid=gmail.googleapis.com", label: "the Gmail API" },
  },
  {
    text: "Turn on the Google Calendar API the same way.",
    link: { href: "https://console.cloud.google.com/apis/enableflow;apiid=calendar-json.googleapis.com", label: "the Google Calendar API" },
  },
  {
    text: "Set up the sign-in screen: press **Get started**, enter **Dossier** as the app name and your email, choose **External**, enter your email again, agree to the policy and press **Create**.",
    link: { href: "https://console.developers.google.com/auth/branding", label: "Branding" },
  },
  {
    text: "Open **Audience**, press **Publish app** and confirm. Until you do, Google ends the connection every 7 days.",
    link: { href: "https://console.developers.google.com/auth/audience", label: "Audience" },
  },
  {
    text: "Open **Clients** and press **Create client**. Choose **Web application** and name it Dossier. Under **Authorized redirect URIs**, press **Add URI** and paste the address below. Leave **Use this client for an AI-powered agent** unticked, and press **Create**.",
    link: { href: "https://console.developers.google.com/auth/clients", label: "Clients" },
  },
  { text: "Copy the **Client ID** and the **Client secret** into the fields below. Google shows the secret only once, so copy it before you close that window." },
  {
    text: "Press **Connect Google**. Google warns that the app isn't verified: it's your own, so press **Advanced**, then **Go to Dossier (unsafe)**, and allow what it asks for.",
  },
];

export const GOOGLE_HELP = `${WIKI}/Connecting-Gmail-and-Calendar`;

/**
 * Why Google won't take this redirect address, if it won't: it wants https,
 * except on localhost, and a name rather than an IP address.
 */
export function googleAddressProblem(redirectUri: string): "http" | "ip" | null {
  const { protocol, hostname } = new URL(redirectUri);
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) return "ip";
  return protocol === "https:" ? null : "http";
}
