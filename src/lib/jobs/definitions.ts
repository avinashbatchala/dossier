import "server-only";

// Every job type, so the runner knows them all whatever started a job, even
// after a restart. Import each module that calls defineJob() here.
import "./read-posting";
import "./write-documents";
import "./regenerate-unit";
import "./refine";
import "./write-email";
import "./zip-pdfs";
import "./import-profile";
import "./draft-reply";
import "@/lib/agent/jobs";
import "@/lib/agent/draft";
import "./score-posting";
