"use client";

import { useMemo } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAutosave } from "@/hooks/use-autosave";
import { formatDateRange, type EntryOrder, type ProfileData, type ProjectItem } from "@/lib/profile";

import {
  attachNewProjectSkill,
  createProject,
  removeProject,
  reorderEntries,
  restoreProject,
  saveProject,
  setProjectSkill,
  sortEntriesByDate,
} from "./actions";
import { BulletsField } from "./bullets-field";
import { EntryList } from "./entry-list";
import { MonthYearField } from "./month-year-field";
import type { UpdateProfile } from "./skills-section";
import { SkillsUsed } from "./skills-used";
import { useProfileId } from "./profile-id";

/** The fields of an open project, autosaved as you type. */
function ProjectForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: ProjectItem;
  onChange: (entry: ProjectItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  // Autosave the text and dates only; skill links save on their own when toggled.
  const { id, name, link, bullets, startYear, startMonth, endYear, endMonth, current } = entry;
  const fields = useMemo(
    () => ({ id, name, link, bullets, startYear, startMonth, endYear, endMonth, current }),
    [id, name, link, bullets, startYear, startMonth, endYear, endMonth, current],
  );
  const { flush } = useAutosave(fields, (value) => track(saveProject(value)));
  const set = (change: Partial<ProjectItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        label="Project"
        placeholder="Churn predictor"
        value={entry.name}
        onChange={(event) => set({ name: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        label="Link"
        placeholder="github.com/you/churn-predictor"
        value={entry.link}
        onChange={(event) => set({ link: event.target.value })}
      />
      <MonthYearField
        label="Started"
        value={{ month: entry.startMonth, year: entry.startYear }}
        onChange={({ month, year }) => set({ startMonth: month, startYear: year })}
      />
      <div className="flex flex-col gap-2.5">
        <MonthYearField
          label="Finished"
          value={{ month: entry.endMonth, year: entry.endYear }}
          onChange={({ month, year }) => set({ endMonth: month, endYear: year })}
          disabled={entry.current}
        />
        <Checkbox
          label="Still working on it"
          checked={entry.current}
          onChange={(event) => set({ current: event.target.checked })}
        />
      </div>
      <BulletsField placeholder="One point per line: what you built, how, and what came of it." value={entry.bullets} onChange={(bullets) => set({ bullets })} />
    </div>
  );
}

/** Projects (PRO-13): side, open-source, course or thesis work, with the skills used, like roles. */
export function ProjectsSection({ profile, update, order }: { profile: ProfileData; update: UpdateProfile; order: EntryOrder }) {
  const profileId = useProfileId();
  const skillNames = (entry: ProjectItem) =>
    profile.skills.filter((skill) => entry.skillIds.includes(skill.id)).map((skill) => skill.name);

  return (
    <EntryList
      items={profile.projects}
      setItems={(change) => update((current) => ({ ...current, projects: change(current.projects) }))}
      addLabel="Add a project"
      ordering={{
        mode: order,
        save: (ids) => reorderEntries({ profileId, section: "project", ids }),
        sortByDate: () => sortEntriesByDate({ profileId, section: "project" }),
      }}
      summary={(entry) => ({
        title: entry.name.trim() || "New project",
        subtitle: entry.link.trim(),
        meta: formatDateRange(entry),
        footnote: skillNames(entry).join(" · ") || undefined,
      })}
      create={() => createProject({ profileId })}
      remove={(entry) => removeProject({ id: entry.id })}
      restore={(entry) => restoreProject({ ...entry, profileId })}
      renderForm={(entry, { onChange, autoFocus }) => (
        <>
          <ProjectForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
          <SkillsUsed
            entry={entry}
            noun="project"
            skills={profile.skills}
            update={update}
            setLinks={(change) =>
              update((current) => ({
                ...current,
                projects: current.projects.map((item) => (item.id === entry.id ? { ...item, skillIds: change(item.skillIds) } : item)),
              }))
            }
            attach={(skillId, attached) => setProjectSkill({ projectId: entry.id, skillId, attached })}
            attachNew={(name) => attachNewProjectSkill({ projectId: entry.id, name })}
          />
        </>
      )}
    />
  );
}
