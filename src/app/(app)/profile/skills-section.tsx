"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RemovableChip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LanguageLevel } from "@/generated/prisma/enums";
import { LANGUAGE_LEVELS, languageLevelLabel, sameName, type ProfileData, type SkillItem } from "@/lib/profile";
import { inEditorOrder, skillGroups } from "@/lib/skill-groups";

import { addLanguage, addSkill, removeLanguage, removeSkill, renameSkillGroup, setLanguageLevel, setSkillGroup } from "./actions";
import { useTrackSave } from "@/components/save-tracker";

export type UpdateProfile = (change: (profile: ProfileData) => ProfileData) => void;

/** A card in the Skills & languages section: title, "{n} added", content. */
export function ChipCard({
  title,
  count,
  optional = false,
  children,
}: {
  title: string;
  count: number;
  /** Doesn't count towards Profile strength (#216). */
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 px-7 py-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lead font-medium">
          {title}
          {optional && <span className="font-normal text-muted"> (optional)</span>}
        </h3>
        <span className="text-meta text-muted">{count} added</span>
      </div>
      {children}
    </Card>
  );
}

/**
 * Skills (PRO-3), in groups if you like (#280): those without a group
 * first, then each group under its name with a field of its own. Enter adds
 * a skill where you typed it, × removes it everywhere, and a skill's menu
 * moves it to another group. Resumes print a line per group.
 */
function SkillsCard({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  const track = useTrackSave();
  // Made with "New group" and still empty: a group is only saved with its first skill.
  const [emptyGroups, setEmptyGroups] = useState<string[]>([]);

  const groups = skillGroups(inEditorOrder(profile.skills));
  const ungrouped = groups.find(({ group }) => !group)?.skills ?? [];
  const named = [
    ...groups.filter(({ group }) => group),
    ...emptyGroups.filter((name) => !groups.some(({ group }) => sameName(group, name))).map((group) => ({ group, skills: [] as SkillItem[] })),
  ];
  const groupNames = named.map(({ group }) => group);

  const roleCount = (skillId: string) =>
    profile.experience.filter((entry) => entry.skillIds.includes(skillId)).length;

  /** Puts `id` in `group` ("" for none), on screen first. */
  async function move(id: string, group: string) {
    const before = profile;
    update((current) => ({ ...current, skills: current.skills.map((skill) => (skill.id === id ? { ...skill, group } : skill)) }));
    const result = await track(setSkillGroup({ id, group }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  /** Adds `name` to `group`; says whether the field can be cleared. */
  async function add(name: string, group: string): Promise<boolean> {
    const existing = profile.skills.find((skill) => sameName(skill.name, name));
    if (existing && existing.group === group) {
      toast(`“${existing.name}” is already ${group ? `in ${group}` : "in your skills"}.`);
      return true;
    }
    if (existing) {
      await move(existing.id, group);
      toast(group ? `Moved “${existing.name}” to ${group}.` : `Moved “${existing.name}” out of ${existing.group}.`);
      return true;
    }
    const result = await track(addSkill({ name, group }));
    if (!result.ok) {
      toast(result.error);
      return false;
    }
    const { skill } = result.data;
    update((current) => (current.skills.some((entry) => entry.id === skill.id) ? current : { ...current, skills: [...current.skills, skill] }));
    setEmptyGroups((current) => current.filter((entry) => entry !== group));
    return true;
  }

  async function rename(from: string, to: string) {
    if (!profile.skills.some((skill) => skill.group === from)) {
      setEmptyGroups((current) => current.map((entry) => (entry === from ? to : entry)));
      return;
    }
    const before = profile;
    update((current) => ({ ...current, skills: current.skills.map((skill) => (skill.group === from ? { ...skill, group: to } : skill)) }));
    const result = await track(renameSkillGroup({ from, to }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  async function remove(id: string) {
    const before = profile;
    // Removing a skill detaches it from every role too (PRO-3).
    update((current) => ({
      ...current,
      skills: current.skills.filter((skill) => skill.id !== id),
      experience: current.experience.map((entry) => ({
        ...entry,
        skillIds: entry.skillIds.filter((skillId) => skillId !== id),
      })),
    }));
    const result = await track(removeSkill({ id }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  const chips = (skills: SkillItem[], label: string) =>
    skills.length > 0 && (
      <ul className="flex flex-wrap gap-2" aria-label={label}>
        {skills.map((skill) => {
          const roles = roleCount(skill.id);
          return (
            <li key={skill.id}>
              <RemovableChip
                meta={roles > 0 ? `${roles} ${roles === 1 ? "role" : "roles"}` : undefined}
                removeLabel={`Remove ${skill.name}`}
                onRemove={() => void remove(skill.id)}
              >
                {groupNames.length > 0 ? <GroupMenu skill={skill} groups={groupNames} onMove={(group) => void move(skill.id, group)} /> : skill.name}
              </RemovableChip>
            </li>
          );
        })}
      </ul>
    );

  return (
    <ChipCard title="Skills" count={profile.skills.length}>
      {chips(ungrouped, "Your skills")}
      <AddSkillField label="Add a skill" placeholder="e.g. Accessibility" onAdd={(name) => add(name, "")} />
      {named.map(({ group, skills }) => (
        <div key={group} className="flex flex-col gap-3 border-t border-line pt-4">
          <GroupHeading name={group} others={groupNames.filter((name) => name !== group)} onRename={(to) => void rename(group, to)} />
          {chips(skills, `Skills in ${group}`)}
          <AddSkillField label={`Add to ${group}`} placeholder={`A skill for ${group}`} onAdd={(name) => add(name, group)} />
        </div>
      ))}
      <NewGroup existing={groupNames} onCreate={(name) => setEmptyGroups((current) => [...current, name])} />
    </ChipCard>
  );
}

/** Why `name` can't name a group, or null: it leads a line on resumes, so no ":" or "·" (#280). */
function groupNameProblem(name: string, others: readonly string[]): string | null {
  if (!name) return "Give the group a name.";
  if (/[:·]/.test(name)) return "A group's name can't have “:” or “·” in it.";
  if (name.length > 60) return "Keep a group's name under 60 characters.";
  if (others.some((other) => sameName(other, name))) return `There's a group called ${name} already.`;
  return null;
}

/** The field under a list of skills: Enter adds what's typed. */
function AddSkillField({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (name: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    if (!(await onAdd(name))) setDraft(name);
  };
  return (
    <Input
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => void onKeyDown(event)}
      enterKeyHint="done"
    />
  );
}

/** A skill's name, opening a menu that moves it to another group or out of any. */
function GroupMenu({ skill, groups, onMove }: { skill: SkillItem; groups: readonly string[]; onMove: (group: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full text-left hover:text-primary-text">
        {skill.name} <span className="sr-only">(change its group)</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Group for {skill.name}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={skill.group} onValueChange={onMove}>
          <DropdownMenuRadioItem value="">No group</DropdownMenuRadioItem>
          {groups.map((group) => (
            <DropdownMenuRadioItem key={group} value={group}>
              {group}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A group's name, with Rename: Enter or leaving the field saves, Escape doesn't. */
function GroupHeading({ name, others, onRename }: { name: string; others: readonly string[]; onRename: (to: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const finish = () => {
    const to = draft.trim();
    setEditing(false);
    if (to === name) return;
    const problem = groupNameProblem(to, others);
    if (problem) {
      setDraft(name);
      toast(problem);
      return;
    }
    onRename(to);
  };
  if (editing) {
    return (
      <Input
        aria-label={`New name for ${name}`}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish();
          } else if (event.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h4 className="text-control font-medium">{name}</h4>
      <Button
        variant="text"
        size="sm"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        Rename <span className="sr-only">{name}</span>
      </Button>
    </div>
  );
}

/** "New group": a name, then the group waits for its first skill. */
function NewGroup({ existing, onCreate }: { existing: readonly string[]; onCreate: (name: string) => void }) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const create = () => {
    const name = draft.trim();
    if (!name) {
      setNaming(false);
      return;
    }
    const problem = groupNameProblem(name, existing);
    if (problem) {
      toast(problem);
      return;
    }
    onCreate(name);
    setDraft("");
    setNaming(false);
  };
  if (!naming) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setNaming(true)}>
        + New group
      </Button>
    );
  }
  return (
    <Input
      aria-label="Name of the new group"
      placeholder="e.g. Tools"
      value={draft}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={create}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          create();
        } else if (event.key === "Escape") {
          setDraft("");
          setNaming(false);
        }
      }}
      hint="Resumes print each group as a line of its own, led by its name."
    />
  );
}

function LevelOptions() {
  return LANGUAGE_LEVELS.map(({ value, label }) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

/** Languages with a CEFR-style level (PRO-4). */
function LanguagesCard({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  const track = useTrackSave();
  const [name, setName] = useState("");
  const [level, setLevel] = useState<LanguageLevel>(LanguageLevel.B1);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = profile.languages.find((language) => sameName(language.name, trimmed));
    setName("");
    if (existing) {
      // Adding a language that's already there updates its level (PRO-4).
      update((current) => ({
        ...current,
        languages: current.languages.map((language) =>
          language.id === existing.id ? { ...language, level } : language,
        ),
      }));
      toast(`Updated ${existing.name} to ${languageLevelLabel(level)}.`);
    }
    const result = await track(addLanguage({ name: trimmed, level }));
    if (!result.ok) {
      setName(trimmed);
      toast(result.error);
      return;
    }
    const { language } = result.data;
    update((current) =>
      current.languages.some((entry) => entry.id === language.id)
        ? current
        : { ...current, languages: [...current.languages, language] },
    );
  }

  async function changeLevel(id: string, next: LanguageLevel) {
    const before = profile;
    update((current) => ({
      ...current,
      languages: current.languages.map((language) => (language.id === id ? { ...language, level: next } : language)),
    }));
    const result = await track(setLanguageLevel({ id, level: next }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  async function remove(id: string) {
    const before = profile;
    update((current) => ({ ...current, languages: current.languages.filter((language) => language.id !== id) }));
    const result = await track(removeLanguage({ id }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  return (
    <ChipCard title="Languages" count={profile.languages.length} optional>
      {profile.languages.length > 0 && (
        <ul className="flex flex-col border-t border-line" aria-label="Your languages">
          {profile.languages.map((language) => (
            <li key={language.id} className="flex items-center gap-3 border-b border-line py-2.5">
              <span className="min-w-0 flex-1 text-field">{language.name}</span>
              <Select
                aria-label={`${language.name} level`}
                selectClassName="w-auto text-sm"
                value={language.level}
                onChange={(event) => void changeLevel(language.id, event.target.value as LanguageLevel)}
              >
                <LevelOptions />
              </Select>
              <button
                type="button"
                aria-label={`Remove ${language.name}`}
                onClick={() => void remove(language.id)}
                className="rounded-control px-1.5 py-1 text-base leading-none text-muted hover:text-ink"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-[1_1_180px]"
          aria-label="Language"
          placeholder="Language, e.g. French"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void add();
          }}
        />
        <Select
          className="flex-[0_1_220px]"
          aria-label="Level"
          selectClassName="text-sm"
          value={level}
          onChange={(event) => setLevel(event.target.value as LanguageLevel)}
        >
          <LevelOptions />
        </Select>
        <Button variant="secondary" className="bg-input" onClick={() => void add()}>
          Add
        </Button>
      </div>
    </ChipCard>
  );
}

/** The Skills & languages section. */
export function SkillsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return (
    <div className="flex flex-col gap-4">
      <SkillsCard profile={profile} update={update} />
      <LanguagesCard profile={profile} update={update} />
    </div>
  );
}
