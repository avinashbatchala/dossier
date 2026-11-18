"use client";

import { useTrackSave } from "@/components/save-tracker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAutosave } from "@/hooks/use-autosave";
import { formatMonthYear, type CertificationItem, type ProfileData } from "@/lib/profile";

import { createCertification, removeCertification, reorderCertifications, restoreCertification, saveCertification } from "./actions";
import { EntryList } from "./entry-list";
import { MonthYearField } from "./month-year-field";
import type { UpdateProfile } from "./skills-section";
import { useProfileId } from "./profile-id";

const optional = (label: string) => (
  <>
    {label} <span className="font-normal text-muted">(optional)</span>
  </>
);

/** The fields of an open certification, autosaved as you type. */
function CertificationForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: CertificationItem;
  onChange: (entry: CertificationItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(saveCertification(value)));
  const set = (change: Partial<CertificationItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        className="col-span-2"
        label="Certification"
        placeholder="Certified Accessibility Specialist"
        value={entry.name}
        onChange={(event) => set({ name: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        className="col-span-2"
        label="Issued by"
        placeholder="Inclusive Design Institute"
        value={entry.issuer}
        onChange={(event) => set({ issuer: event.target.value })}
      />
      <MonthYearField label="Obtained" value={{ month: entry.month, year: entry.year }} onChange={({ month, year }) => set({ month, year })} />
      <MonthYearField
        label="Expires"
        value={{ month: entry.expiryMonth, year: entry.expiryYear }}
        onChange={({ month, year }) => set({ expiryMonth: month, expiryYear: year })}
      />
      <p className="col-span-2 -mt-2.5 text-label text-muted">Leave Expires empty when it doesn&apos;t run out. Resumes say how long it&apos;s valid.</p>
      <Input
        label={optional("Credential ID")}
        placeholder="IDI-20481"
        value={entry.credentialId}
        onChange={(event) => set({ credentialId: event.target.value })}
      />
      <Input
        label={optional("Link")}
        placeholder="verify.example.org/IDI-20481"
        hint="Where an employer can check it. On a PDF, the link can be clicked."
        value={entry.link}
        onChange={(event) => set({ link: event.target.value })}
      />
      <Checkbox
        className="col-span-2"
        label="Show on resumes"
        hint="Off keeps it in your profile, but leaves it off every resume and out of what the AI reads."
        checked={entry.onResumes}
        onChange={(event) => set({ onResumes: event.target.checked })}
      />
    </div>
  );
}

/**
 * Certifications (#293): their own section next to Education, in the user's
 * order. Resumes show them as written; the AI never rewrites them.
 */
export function CertificationsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  const profileId = useProfileId();
  return (
    <EntryList
      items={profile.certifications}
      setItems={(change) => update((current) => ({ ...current, certifications: change(current.certifications) }))}
      addLabel="Add a certification"
      ordering={{ mode: "manual", save: (ids) => reorderCertifications({ profileId, ids }) }}
      summary={(entry) => ({
        title: entry.name.trim() || "New certification",
        subtitle: entry.issuer.trim(),
        meta: entry.onResumes ? formatMonthYear(entry.year, entry.month) || undefined : "Not on resumes",
      })}
      create={() => createCertification({ profileId })}
      remove={(entry) => removeCertification({ id: entry.id })}
      restore={(entry) => restoreCertification({ ...entry, profileId })}
      renderForm={(entry, { onChange, autoFocus }) => (
        <CertificationForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
      )}
    />
  );
}
