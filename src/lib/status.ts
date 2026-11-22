import { ApplicationStatus, FunnelStage } from "@/generated/prisma/enums";

// The status model (PRD §8). Every status change goes through `advance`, so
// the funnel figures stay consistent however the change was made.

type StatusGroup = "in-progress" | "closed";

export type StatusInfo = {
  value: ApplicationStatus;
  label: string;
  /** CSS colour for dots and bars. */
  color: string;
  group: StatusGroup;
  /** The encouraging toast shown after moving an application here (APP-2). */
  toast: string;
};

/** All statuses, in board and menu order. */
export const STATUSES: readonly StatusInfo[] = [
  { value: ApplicationStatus.DRAFT, label: "Draft", color: "var(--color-status-draft)", group: "in-progress", toast: "Moved back to draft." },
  { value: ApplicationStatus.SENT, label: "Sent", color: "var(--color-status-sent)", group: "in-progress", toast: "Marked as sent. Fingers crossed!" },
  { value: ApplicationStatus.SCREENING, label: "Screening", color: "var(--color-status-screening)", group: "in-progress", toast: "In screening. They're taking a look." },
  { value: ApplicationStatus.INTERVIEW, label: "Interview", color: "var(--color-status-interview)", group: "in-progress", toast: "An interview! You've got this." },
  { value: ApplicationStatus.OFFER, label: "Offer", color: "var(--color-status-offer)", group: "in-progress", toast: "An offer. Congratulations!" },
  { value: ApplicationStatus.ACCEPTED, label: "Accepted", color: "var(--color-status-accepted)", group: "closed", toast: "Accepted. Huge congratulations!" },
  { value: ApplicationStatus.REJECTED, label: "Rejected", color: "var(--color-status-rejected)", group: "closed", toast: "Sorry, that's a tough one. On to the next." },
  { value: ApplicationStatus.DECLINED, label: "Declined", color: "var(--color-status-declined)", group: "closed", toast: "Declined. Good on you for choosing well." },
];

export function statusInfo(status: ApplicationStatus): StatusInfo {
  const info = STATUSES.find((entry) => entry.value === status);
  if (!info) throw new Error(`Unknown status: ${status}`);
  return info;
}

export function isInProgress(status: ApplicationStatus): boolean {
  return statusInfo(status).group === "in-progress";
}

/** The funnel's stages, in order (DSH-2). */
export const FUNNEL_STAGES: readonly FunnelStage[] = [
  FunnelStage.SENT,
  FunnelStage.SCREENING,
  FunnelStage.INTERVIEW,
  FunnelStage.OFFER,
  FunnelStage.ACCEPTED,
];

function stageRank(stage: FunnelStage | null): number {
  return stage === null ? -1 : FUNNEL_STAGES.indexOf(stage);
}

function higherStage(a: FunnelStage | null, b: FunnelStage): FunnelStage {
  return stageRank(a) >= stageRank(b) ? a! : b;
}

/** "Heard back": the employer responded, so the furthest stage is Screening or later. */
export function heardBack(application: { furthestStage: FunnelStage | null }): boolean {
  return stageRank(application.furthestStage) >= stageRank(FunnelStage.SCREENING);
}

/** The status fields of an application. */
export type StatusFields = {
  status: ApplicationStatus;
  furthestStage: FunnelStage | null;
  sentAt: Date | null;
};

export type StatusChange = {
  /** The application's new status fields. */
  update: StatusFields;
  /** The StatusEvent to record, including what's needed to undo it. */
  event: {
    from: ApplicationStatus;
    to: ApplicationStatus;
    at: Date;
    previousFurthestStage: FunnelStage | null;
    previousSentAt: Date | null;
  };
};

/**
 * Moves an application to `to`. Any status can move to any other, but the
 * furthest stage never goes down, so an application rejected after screening
 * still counts toward Screening (DSH-3).
 *
 * Moving to anything but Draft or Declined means the application was sent:
 * it sets `sentAt` if it's empty and raises the furthest stage to at least
 * Sent. Draft → Declined leaves both alone, so a draft the user chose not to
 * send stays out of the funnel (decision in #26).
 *
 * Returns null when `to` is the current status: nothing to record.
 */
export function advance(application: StatusFields, to: ApplicationStatus, now: Date): StatusChange | null {
  if (application.status === to) return null;

  let { furthestStage, sentAt } = application;
  if (to !== ApplicationStatus.DRAFT && to !== ApplicationStatus.DECLINED) {
    sentAt ??= now;
    furthestStage = higherStage(furthestStage, FunnelStage.SENT);
  }
  if ((FUNNEL_STAGES as readonly string[]).includes(to)) {
    furthestStage = higherStage(furthestStage, to as FunnelStage);
  }

  return {
    update: { status: to, furthestStage, sentAt },
    event: {
      from: application.status,
      to,
      at: now,
      previousFurthestStage: application.furthestStage,
      previousSentAt: application.sentAt,
    },
  };
}

/** The status fields to restore when a status change is undone. */
export function undoChange(event: {
  from: ApplicationStatus;
  previousFurthestStage: FunnelStage | null;
  previousSentAt: Date | null;
}): StatusFields {
  return {
    status: event.from,
    furthestStage: event.previousFurthestStage,
    sentAt: event.previousSentAt,
  };
}
