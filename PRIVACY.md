# Privacy

Dossier is a single-user app you run on your own server. This page is for whoever runs it: what Dossier keeps and for how long, what leaves your server and who receives it, and what deleting something removes. For how the data is protected, see [SECURITY.md](SECURITY.md).

In short: everything you enter is kept in your own PostgreSQL database and data directory. What leaves your server goes to the AI provider and job source you choose, to Google if you connect Gmail and Calendar, to Hacker News and startups' own sites once you use Startups, to Anthropic through Claude if you turn on the Claude connector, plus an update check you can turn off and a daily usage ping, only if you agree to it. With a local model, your profile, postings and documents never leave your server. With a hosted one, keeping the database on your server covers only part of where your data goes.

## What Dossier keeps

| What | Where | Kept until |
|---|---|---|
| Your profile: basics with contact details and your photo, skills, languages, roles, projects, education, publications, references with their email and phone, and your facts about you | Database | You change or delete it |
| Each application: the posting, what was read from it, the match, the facts you gave for it, its status history | Database | You delete the application |
| Each application's resume, cover letter and email, every earlier version of them, the refine chat and your private notes | Database | You delete the application |
| Your signature, if you upload one: the PNG or JPG, and which cover letters draw it | Database | You replace or remove it in Settings → Documents, or Delete everything |
| Postings you saved or dismissed in Find jobs, and your past searches with what they found | Database | You remove them. A posting stays, unlinked, when you delete the application made from it |
| The job agent's finds: each posting it scored, with its score, reasons and red flags, and the drafts it prepared. Of a posting you dismissed, only its source's ID, its title and company, and a fingerprint of its link, so it never comes back | Database | Dismissing a posting trims it at once and deletes its draft. Delete everything removes them all |
| The scores of postings you scored with **Score** in Find jobs, or the job agent scored: each score with its reasons and red flags | Database | Scoring again replaces one. Importing a file or Delete everything removes them; exports leave them out, since they can be made again |
| Startups: each startup a refresh found (the hiring post or job post as published, its links, place and roles), its match with the reasons, the email addresses it publishes for applications with where each was found, and your status and notes. People's own addresses only after you press **Look for people's addresses**. Of a startup you removed for good, only SHA-256 hashes of its post, its site's domain and its name, so it doesn't come back | Database | Ones you didn't save, contact or write to go once no refresh has found them for 45 days. People's own addresses go after 14 days, unless you started an application to that startup. **Remove for good** deletes a startup at once. Delete everything removes them all |
| Postings you hand to Claude chat from New application, with **Write it with Claude**, for the Claude connector to read | Database | 14 days, or Delete everything |
| Task data: what each AI task was given and wrote, such as a posting being read, a resume's text and what was read from it, drafts you didn't turn into an application, and a rewrite kept for Undo | Database | The task's application is deleted, or it's older than **Keep task data for** (Settings → Your data: 1 hour, 24 hours, 7 days or 30 days; 24 hours by default), whichever comes first. A resume reading goes as soon as you merge, replace or choose another file |
| Mail from Gmail about your applications, once you connect Google: who it's from and to, the subject, the date and the text (without quoted earlier mail, up to 20,000 characters, never attachments), what the AI read in it, and the answer it drafted. Also what you sent through Dossier, and your own mail in those threads | Database | You delete its application. Mail Dossier couldn't link (**Needs a look**) stays until you link it or mark it **Not job-related**, which keeps only its Gmail IDs and date, so it isn't fetched again |
| The connected Google account: its address, the permissions you gave, and Google's refresh token, encrypted with `DOSSIER_SECRET`. Where the inbox check carries on from, and when it last ran. For each interview Dossier added to your calendar, the event's ID | Database | **Disconnect** in Settings → Google, or Delete everything. An interview's event ID goes when its date does |
| Settings, and your API keys and the Google OAuth client's secret, encrypted with `DOSSIER_SECRET`. While the Claude connector is on, when it was turned on or Claude last disconnected; Claude's sign-in itself keeps nothing: its tokens are signed with `DOSSIER_SECRET` | Database | You change them |
| Nightly backups and the backup taken before each import: full exports, in plain JSON | Data directory, `backups` | `DOSSIER_BACKUP_RETENTION_DAYS`, 14 days by default |
| Zips from **Download all PDFs** | Data directory, `downloads` | Downloaded, or an hour |
| Failed sign-ins: the client IP and how many failed | Database | A successful sign-in from that IP. Otherwise, once they're a day old, the next failed sign-in clears them |
| Your answer to whether to send the usage ping, when you gave it and to which version of the question, the usage ping's random install ID and the day of the last ping, the latest release the update check found, your browser's time zone, so the inbox check reads times in it, and when you last opened Startups and what its last refresh found | Database | Delete everything |

Exports you download and database dumps you take are copies outside Dossier's reach: keep them safe, and delete them yourself. Dossier logs errors without the data involved; what your server, Docker or reverse proxy log otherwise is up to your setup.

## What deleting removes

- **Deleting an application** removes it at once with its documents and their versions, the chat, notes, status history, task data and its mail from Gmail (which stays in Gmail). Nightly backups taken before still hold it until they expire, and so do exports you downloaded.
- **Delete everything** (Settings → Your data) removes the profile, every application, postings and searches, the job agent's finds, Startups, the uploaded signature, custom themes, settings, task data, backups and zips, the mail from Gmail and the Google account, after revoking Dossier's access at Google. It can't reach your own exports and dumps, what's in your Gmail and calendar, or what a hosted AI provider kept.
- **Disconnect** (Settings → Google) revokes Dossier's access at Google and forgets the account. Mail already in Dossier stays, with its applications.
- **Disconnect Claude** (Settings → Claude connector) signs every Claude out, and so do turning the connector off, a new `DOSSIER_PASSWORD` or a new `DOSSIER_SECRET`. What Claude read before stays in your Claude chats, under your Claude account.

## What leaves your server

| Who receives it | When | What |
|---|---|---|
| A hosted AI provider (OpenAI-compatible, Anthropic or Mistral) | Each AI task, while one is chosen in Settings → AI provider | See [below](#what-a-hosted-ai-provider-receives) |
| Google | While a Google account is connected (Settings → Google) | Signing in: your OAuth client's ID and secret, and the tokens. **Gmail:** the application emails and answers you send, with their PDFs, and a request for new mail on each check (every 10 minutes by default). **Calendar:** the next 14 days, to find your free times; each interview you add, change or remove: its time and a title with the role and company; and requests for the events in the months you look at in the dashboard's calendar, which Dossier shows and doesn't keep. Google already holds your mail and calendar; Dossier only asks for the permissions you give |
| The job source you chose (JSearch, Adzuna or the Bundesagentur für Arbeit) | Each search in Find jobs, which is off until you choose a source, and the job agent's search, at most three times in 24 hours while it's on (never on the Bundesagentur für Arbeit) | What you search for: keywords, place, country, radius and filters. Nothing from your profile: it only fills in the form. The Bundesagentur für Arbeit has no official API: Dossier uses the access its own job search uses, without its permission, so it's searched only after you tick "I understand" under that note, and `DOSSIER_JOBS_ARBEITSAGENTUR=off` takes it out |
| Hacker News (its official API, and Algolia's search of it) | When you press **Refresh** in Startups, then once a day while you open Startups at least every 14 days | Requests for YC startups' job posts and this month's “Who is hiring?” thread. Nothing about you: which posts suit your city and country is worked out on your server |
| Startups' own sites | Each Startups refresh, for the 12 best new matches with a site of their own, and when you press **Find addresses on their site** or **Look for people's addresses** | Requests for the site's robots.txt and a few public pages. See [Startups](#startups) |
| Anthropic, through Claude | Only while the Claude connector is on (Settings → Claude connector, off by default), and only for the Claude you signed in and allowed: each time Claude uses one of Dossier's tools | What that tool answers. See [Claude connector](#claude-connector) |
| The site a posting is on | When you press **Fetch** on a new application, and for a Find jobs posting that came with only its start | A request for the posting's page, from your server, never to an address on your own network |
| GitHub | Once on each day Dossier is used, while **Check for updates daily** is on in Settings → About (it is by default), and when you press **Check for updates** | A request for the latest release, from your server. Nothing about you or your install, though GitHub sees your server's address, as with any request |
| `telemetry.dossier.aien.me` | Once on each day Dossier is used, only after you agree (Dossier asks once, after you sign in) or set `DOSSIER_TELEMETRY=on` | A random install ID and the version number. See [Usage ping](#usage-ping) |

Nothing else is sent. Your browser loads nothing from other sites (the Content-Security-Policy forbids it), and Next.js telemetry is off in the image.

### What a hosted AI provider receives

| Task | What's sent |
|---|---|
| Reading a posting | The posting's text, up to 20,000 characters |
| Matching it against your profile | The posting's requirements, and the names of your skills and languages |
| Writing the resume, cover letter and email | Your profile without contact details: your name, headline, city and country, summary, skills, languages, roles with their companies, dates and bullet points, projects with their dates and bullet points (not their links), education, the publications you show on resumes (not their links), and your facts about you. Also the job's details and the match, the letter's tone, and the facts you gave for the application. The email also gets the posting and the letter's paragraphs |
| Rewriting a part, or refining in the chat | The same, with the drafts (never a letter's sender or signature) and, in the chat, your request and the recent messages before it |
| Importing a resume | The whole text of the file, contact details and references included. The import page says so first |
| Scoring a posting, with **Score** in Find jobs or by the job agent | The posting's text, with its title, company, place and salary, and your profile without contact details or references, as for writing. Score in Find jobs fetches the rest of a posting the source sent only the start of. Each time you press Score, and up to the number of postings an agent run scores (Settings → Job agent) |
| The job agent's drafts | The same as reading a posting and writing its resume and cover letter, for each draft you prepare or, with Prepare drafts on its own on, up to the number a run prepares |
| Reading a reply from Gmail | The mail's sender, subject, date and text (up to 8,000 characters), the application's role and company, and your time zone. With **Every new email** in Settings → Google, that's each new mail outside Promotions and Social |
| Drafting an answer to it | Your profile without contact details, as for the documents, the job's details and the facts you gave for it, the mail and up to four earlier ones in its thread (up to 2,000 characters each), the times to offer, and what you tell the AI |

Never sent in a prompt: your email, phone, address, date of birth and links, your references, the notes you keep on an application, and the addresses Startups finds: a startup's text reaches New application without them, and the email's recipient is filled in on your server. A posting may name a contact person, a mail from an employer has its sender's name and address, and what you write in the chat may mention people, so other people's details can still be sent.

What happens to the data then depends on the provider and your account with them: how long they keep it, whether they use it to train models, and where it's processed. Read their terms for API use, and check the settings your account offers, before you send them a resume. LM Studio or an OpenAI-compatible server on your own network keeps everything on it.

### Usage ping

Dossier asks once, after you first sign in, whether to send a usage ping, and sends nothing until you agree. If you do, on each day you use Dossier your server sends `telemetry.dossier.aien.me` a random install ID and the version number, once, so the project knows how many installs are in use and how often. The ID is made at random and kept in your database. It isn't derived from anything about you or your server, and exports leave it out. Nothing else is sent: no profile, documents, applications, settings, server address or time of day. Dossier works the same either way.

The receiver runs on the project's own server. It keeps the ID, the day and the version, and deletes them after a year. It doesn't keep the address the ping came from, and no other service handles the ping on the way.

- **Change your answer:** the switch in Settings → About, at any time. Saying no forgets the install ID, so what was sent before and anything sent after a later yes can't be linked. `DOSSIER_TELEMETRY=on` or `off` answers for the server and hides the question; while it's set, it decides.
- **Delete what was sent:** note the install ID in Settings → About, switch the ping off, then send the ID to `dossier.app@pm.me`. Everything kept under it is deleted, and you get a confirmation.

Unlike everything else on this page, what the usage ping sends is received by the project, not by you, so the project is responsible for it under the GDPR:

- **Controller:** the maintainer of the Dossier project, reachable at `dossier.app@pm.me`.
- **Purpose and lawful basis:** counting the installs in use and how often they're used, with your consent (Art. 6(1)(a) GDPR), given in the question after sign-in, with the switch in Settings → About, or with `DOSSIER_TELEMETRY=on`. Reading the install ID on your server to send it rests on the same consent (§ 25(1) TDDDG). Dossier keeps your answer, when you gave it and which version of the question you answered.
- **Pings from before 1.8.0:** until 1.8.0, the ping was sent unless `DOSSIER_TELEMETRY=off`. What those pings left is kept until its year is up, on the basis of the project's legitimate interest in knowing how many installs are in use (Art. 6(1)(f) GDPR). You can object to that and have it deleted as above.
- **Recipients:** Hetzner Online GmbH hosts the receiver's server in Germany, as a processor. Nobody else receives the data, and it doesn't leave the EEA.
- **How long:** a year from the day of each ping.
- **Your rights:** you can withdraw your consent at any time, which doesn't affect what was sent before (Art. 7(3) GDPR), and ask for access to what's kept under your install ID, for its erasure, or object to its use (Art. 15, 17 and 21). You can also complain to a data protection authority (Art. 77), for example the one where you live.
- No decisions are made automatically from the ping, and it isn't used for profiling.

### Startups

Startups lists startups that are hiring: YC startups' job posts from Hacker News' official API, and the posts in Hacker News' monthly “Who is hiring?” thread. It keeps the ones that hire where your profile says you live, or remotely and open to your country, ranks them against your profile on your server, without AI, and shows the address each one publishes for applications. Dossier sends nothing: you decide whom to write to, from New application or your own mail.

**If you run a website** and see requests from `Dossier/<version>`: they come from one person's own Dossier, looking for the address you publish for job applications. The Dossier project doesn't receive anything it reads. It reads your robots.txt first and follows it, under the product token `Dossier`. Then it reads at most your home, `/careers`, `/jobs` and `/contact` pages, and `/about` and `/team` only when that person asks for people's addresses. It reads one page at a time and stops when your site answers 403 or 429. It keeps only the email addresses on your own domain and the page each was on, never the pages, and doesn't decode addresses written to hide them. When a page says you take no unsolicited applications, Dossier shows that and doesn't start an application. To keep it out:

```
User-agent: Dossier
Disallow: /
```

**If you use it:** Startups is for applying for jobs. Offering your services as a freelancer by email is advertising in many countries: in Germany and the rest of the EU it needs the company's consent first, even when the company published the address, and in the US, Canada and Australia such an email needs a way to opt out. Dossier doesn't support that use. Whether the GDPR's exemption for personal activities covers your own job search hasn't been settled, so Dossier treats the addresses as personal data: it looks up people's own addresses only when you ask, drops them after 14 days unless you write to that startup, keeps every address out of what the AI receives, and **Remove for good** deletes a startup and keeps only hashes so it doesn't come back. If someone asks you to delete their address, that's the button.

### Claude connector

The Claude connector lets you use Dossier from Claude: in chats on claude.ai, in the Desktop and mobile apps, and in Claude's command-line app. It's off until you turn it on in Settings → Claude connector. Then Claude can use it once you've signed in to Dossier and pressed **Allow**; while it's off, its addresses answer as if they didn't exist.

What Claude reads through it goes to Anthropic, under your own Claude account and its terms, as anything you put in a chat does:

- **Your profile,** without contact details, links or references: the same as a hosted AI provider gets for writing.
- **Postings:** what Find jobs searches find for Claude (the searches are kept in Find jobs, like your own), the postings you hand over, and the text of a posting Claude asks for by its link, fetched from your server.
- **Your applications:** their details and status, the posting and the match, and the resume and cover letter as text. Never your private notes, or a letter's sender and signature.

Claude also writes through it: an application it wrote, saved as a Draft and checked like Dossier's own AI's; the fit scores it gives postings; and an application's status. No tool deletes, archives or sends anything. With **Write it with Claude** in New application, the posting you pasted is kept for Claude to read for 14 days; Score and Write it with Claude open a new chat on claude.ai with a short prompt that names the posting by its ID, and nothing else.

Anthropic is the controller of what reaches it through your Claude account; the Dossier project receives nothing from the connector. Dossier keeps no tokens: Claude's sign-in is signed with `DOSSIER_SECRET`, and **Disconnect Claude** ends it.

## GDPR and similar laws

What applies depends on who you run Dossier for, and this isn't legal advice.

- **For your own job search:** the GDPR doesn't apply to processing for purely personal or household activities (Article 2(2)(c)), though no court has said yet whether a job search counts. Other privacy laws often exempt personal use too.
- **For other people**, such as a career coach, an agency or a service: you decide what happens to their data, so you're responsible for it under the GDPR. Among other things, that means a lawful basis for each use, telling them what this page says (who receives their data, for what, and for how long), a data processing agreement with a hosted AI provider, and safeguards when it processes the data outside the EEA. Resumes can reveal special category data, such as health or religion, and hold other people's details, such as references.

Self-hosting alone doesn't make a deployment compliant. Dossier's code shows what it stores and sends. It can't tell you whether your provider, its terms or your account settings meet what you need.

When someone asks for their data, **Export** in Settings → Your data gives everything Dossier keeps except task data and failed sign-ins, which expire on their own, and the mail from Gmail and the Google account, which belong to the mailbox: the mail is still in Gmail. Deleting an application or **Delete everything** removes data as described [above](#what-deleting-removes).
