# Privacy

Dossier is a single-user app you run on your own server. This page is for whoever runs it: what Dossier keeps and for how long, what leaves your server and who receives it, and what deleting something removes. For how the data is protected, see [SECURITY.md](SECURITY.md).

In short: everything you enter is kept in your own PostgreSQL database and data directory. What leaves your server goes to the AI provider and job source you choose, to Google if you connect Gmail and Calendar, plus an update check you can turn off and a daily usage ping, only if you agree to it. With a local model, your profile, postings and documents never leave your server. With a hosted one, keeping the database on your server covers only part of where your data goes.

## What Dossier keeps

| What | Where | Kept until |
|---|---|---|
| Your profile: basics with contact details, skills, languages, roles, projects, education, and references with their email and phone | Database | You change or delete it |
| Each application: the posting, what was read from it, the match, what you told the AI, its status history | Database | You delete the application |
| Each application's resume, cover letter and email, every earlier version of them, the refine chat and your private notes | Database | You delete the application |
| Postings you saved or dismissed in Find jobs, and your past searches with what they found | Database | You remove them. A posting stays, unlinked, when you delete the application made from it |
| The job agent's finds: each posting it scored, with its score, reasons and red flags, and the drafts it prepared. Of a posting you dismissed, only its source's ID, its title and company, and a fingerprint of its link, so it never comes back | Database | Dismissing a posting trims it at once and deletes its draft. Delete everything removes them all |
| The scores of postings you scored with **Score** in Find jobs, or the job agent scored: each score with its reasons and red flags | Database | Scoring again replaces one. Importing a file or Delete everything removes them; exports leave them out, since they can be made again |
| Task data: what each AI task was given and wrote, such as a posting being read, a resume's text and what was read from it, drafts you didn't turn into an application, and a rewrite kept for Undo | Database | The task's application is deleted, or it's older than **Keep task data for** (Settings → Your data: 1 hour, 24 hours, 7 days or 30 days; 24 hours by default), whichever comes first. A resume reading goes as soon as you merge, replace or choose another file |
| Mail from Gmail about your applications, once you connect Google: who it's from and to, the subject, the date and the text (without quoted earlier mail, up to 20,000 characters, never attachments), what the AI read in it, and the answer it drafted. Also what you sent through Dossier, and your own mail in those threads | Database | You delete its application. Mail Dossier couldn't link (**Needs a look**) stays until you link it or mark it **Not job-related**, which keeps only its Gmail IDs and date, so it isn't fetched again |
| The connected Google account: its address, the permissions you gave, and Google's refresh token, encrypted with `DOSSIER_SECRET`. Where the inbox check carries on from, and when it last ran. For each interview Dossier added to your calendar, the event's ID | Database | **Disconnect** in Settings → Google, or Delete everything. An interview's event ID goes when its date does |
| Settings, and your API keys and the Google OAuth client's secret, encrypted with `DOSSIER_SECRET` | Database | You change them |
| Nightly backups and the backup taken before each import: full exports, in plain JSON | Data directory, `backups` | `DOSSIER_BACKUP_RETENTION_DAYS`, 14 days by default |
| Zips from **Download all PDFs** | Data directory, `downloads` | Downloaded, or an hour |
| Failed sign-ins: the client IP and how many failed | Database | A successful sign-in from that IP. Otherwise, once they're a day old, the next failed sign-in clears them |
| Your answer to whether to send the usage ping, when you gave it and to which version of the question, the usage ping's random install ID and the day of the last ping, the latest release the update check found, and your browser's time zone, so the inbox check reads times in it | Database | Delete everything |

Exports you download and database dumps you take are copies outside Dossier's reach: keep them safe, and delete them yourself. Dossier logs errors without the data involved; what your server, Docker or reverse proxy log otherwise is up to your setup.

## What deleting removes

- **Deleting an application** removes it at once with its documents and their versions, the chat, notes, status history, task data and its mail from Gmail (which stays in Gmail). Nightly backups taken before still hold it until they expire, and so do exports you downloaded.
- **Delete everything** (Settings → Your data) removes the profile, every application, postings and searches, the job agent's finds, custom themes, settings, task data, backups and zips, the mail from Gmail and the Google account, after revoking Dossier's access at Google. It can't reach your own exports and dumps, what's in your Gmail and calendar, or what a hosted AI provider kept.
- **Disconnect** (Settings → Google) revokes Dossier's access at Google and forgets the account. Mail already in Dossier stays, with its applications.

## What leaves your server

| Who receives it | When | What |
|---|---|---|
| A hosted AI provider (OpenAI-compatible, Anthropic or Mistral) | Each AI task, while one is chosen in Settings → AI provider | See [below](#what-a-hosted-ai-provider-receives) |
| Google | While a Google account is connected (Settings → Google) | Signing in: your OAuth client's ID and secret, and the tokens. **Gmail:** the application emails and answers you send, with their PDFs, and a request for new mail on each check (every 10 minutes by default). **Calendar:** the next 14 days, to find your free times; each interview you add, change or remove: its time and a title with the role and company; and requests for the events in the months you look at in the dashboard's calendar, which Dossier shows and doesn't keep. Google already holds your mail and calendar; Dossier only asks for the permissions you give |
| The job source you chose (JSearch, Adzuna or the Bundesagentur für Arbeit) | Each search in Find jobs, which is off until you choose a source, and the job agent's search, at most three times in 24 hours while it's on | What you search for: keywords, place, country, radius and filters. Nothing from your profile: it only fills in the form |
| The site a posting is on | When you press **Fetch** on a new application, and for a Find jobs posting that came with only its start | A request for the posting's page, from your server, never to an address on your own network |
| GitHub | Once on each day Dossier is used, while **Check for updates daily** is on in Settings → About (it is by default), and when you press **Check for updates** | A request for the latest release, from your server. Nothing about you or your install, though GitHub sees your server's address, as with any request |
| `telemetry.dossier.aien.me` | Once on each day Dossier is used, only after you agree (Dossier asks once, after you sign in) or set `DOSSIER_TELEMETRY=on` | A random install ID and the version number. See [Usage ping](#usage-ping) |

Nothing else is sent. Your browser loads nothing from other sites (the Content-Security-Policy forbids it), and Next.js telemetry is off in the image.

### What a hosted AI provider receives

| Task | What's sent |
|---|---|
| Reading a posting | The posting's text, up to 20,000 characters |
| Matching it against your profile | The posting's requirements, and the names of your skills and languages |
| Writing the resume, cover letter and email | Your profile without contact details: your name, headline, city and country, summary, skills, languages, roles with their companies, dates and bullet points, projects with their dates and bullet points (not their links), and education. Also the job's details and the match, the letter's tone, and what you told the AI about the application. The email also gets the posting and the letter's paragraphs |
| Rewriting a part, or refining in the chat | The same, with the drafts (never a letter's sender or signature) and, in the chat, your request and the recent messages before it |
| Importing a resume | The whole text of the file, contact details and references included. The import page says so first |
| Scoring a posting, with **Score** in Find jobs or by the job agent | The posting's text, with its title, company, place and salary, and your profile without contact details or references, as for writing. Score in Find jobs fetches the rest of a posting the source sent only the start of. Each time you press Score, and up to the number of postings an agent run scores (Settings → Job agent) |
| The job agent's drafts | The same as reading a posting and writing its resume and cover letter, for each draft you prepare or, with Prepare drafts on its own on, up to the number a run prepares |
| Reading a reply from Gmail | The mail's sender, subject, date and text (up to 8,000 characters), the application's role and company, and your time zone. With **Every new email** in Settings → Google, that's each new mail outside Promotions and Social |
| Drafting an answer to it | Your profile without contact details, as for the documents, the job's details, the mail and up to four earlier ones in its thread (up to 2,000 characters each), the times to offer, and what you tell the AI |

Never sent in a prompt: your email, phone, address, date of birth and links, your references, and the notes you keep on an application. A posting may name a contact person, a mail from an employer has its sender's name and address, and what you write in the chat may mention people, so other people's details can still be sent.

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

## GDPR and similar laws

What applies depends on who you run Dossier for, and this isn't legal advice.

- **For your own job search:** the GDPR doesn't apply to processing for purely personal or household activities (Article 2(2)(c)). Other privacy laws often exempt personal use too.
- **For other people**, such as a career coach, an agency or a service: you decide what happens to their data, so you're responsible for it under the GDPR. Among other things, that means a lawful basis for each use, telling them what this page says (who receives their data, for what, and for how long), a data processing agreement with a hosted AI provider, and safeguards when it processes the data outside the EEA. Resumes can reveal special category data, such as health or religion, and hold other people's details, such as references.

Self-hosting alone doesn't make a deployment compliant. Dossier's code shows what it stores and sends. It can't tell you whether your provider, its terms or your account settings meet what you need.

When someone asks for their data, **Export** in Settings → Your data gives everything Dossier keeps except task data and failed sign-ins, which expire on their own, and the mail from Gmail and the Google account, which belong to the mailbox: the mail is still in Gmail. Deleting an application or **Delete everything** removes data as described [above](#what-deleting-removes).
