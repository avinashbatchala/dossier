"use client";

import { closestCenter, DndContext, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { toast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RemovableChip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LanguageLevel } from "@/generated/prisma/enums";
import { LANGUAGE_LEVELS, languageLevelLabel, sameName, type ProfileData, type SkillItem } from "@/lib/profile";
import { inEditorOrder, skillGroups } from "@/lib/skill-groups";

import { addLanguage, addSkill, removeLanguage, removeSkill, renameSkillGroup, reorderSkills, setLanguageLevel, setSkillGroup, setSkillOrder } from "./actions";
import { useTrackSave } from "@/components/save-tracker";
import { useProfileId } from "./profile-id";

export type UpdateProfile = (change: (profile: ProfileData) => ProfileData) => void;

/** How tailored resumes order the skills (public issue 62): the most relevant first, or the profile's order once it's set by hand. */
export type SkillOrder = "relevance" | "manual";

/** A card on the Skills or Languages page: title, "{n} added", content. */
function ChipCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 px-7 py-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lead font-medium">{title}</h3>
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
 * moves it within its list or to another group. A skill can be dragged
 * within its list too (public issue 62); the order is the resume's, and
 * once set by hand, tailored resumes keep it. Resumes print a line per group.
 */
function SkillsCard({ profile, update, order }: { profile: ProfileData; update: UpdateProfile; order: SkillOrder }) {
  const profileId = useProfileId();
  const track = useTrackSave();
  // Made with "New group" and still empty: a group is only saved with its first skill.
  const [emptyGroups, setEmptyGroups] = useState<string[]>([]);
  const [mode, setMode] = useState<SkillOrder>(order);
  const [announcement, setAnnouncement] = useState("");
  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

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

  /** Every skill's id in the editor's order, with `group`'s skills as `members` has them. */
  const orderWith = (group: string, members: SkillItem[]) =>
    [{ group: "", skills: ungrouped }, ...named].flatMap((list) => (list.group === group ? members : list.skills)).map((skill) => skill.id);

  /** Moves a skill within its list, on screen first; from then on the order is the user's own. */
  async function reorder(group: string, members: SkillItem[], from: number, to: number) {
    if (from === to || to < 0 || to >= members.length) return;
    const before = { profile, mode };
    const ids = orderWith(group, arrayMove(members, from, to));
    const position = new Map(ids.map((id, index) => [id, index]));
    update((current) => ({ ...current, skills: current.skills.toSorted((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity)) }));
    setMode("manual");
    setAnnouncement(`“${members[from].name}” moved to position ${to + 1} of ${members.length}.`);
    const result = await track(reorderSkills({ profileId, ids }));
    if (!result.ok) {
      update(() => before.profile);
      setMode(before.mode);
      toast(result.error);
    }
  }

  async function relevanceFirst() {
    setMode("relevance");
    const result = await track(setSkillOrder({ profileId, order: "relevance" }));
    if (!result.ok) {
      setMode("manual");
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
    const result = await track(addSkill({ profileId, name, group }));
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
    const result = await track(renameSkillGroup({ profileId, from, to }));
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

  const indexIn = (skills: SkillItem[], id: unknown) => skills.findIndex((skill) => skill.id === id);
  const chips = (group: string, skills: SkillItem[], label: string) =>
    skills.length > 0 && (
      <DndContext
        id={`${dndId}-${group}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }: DragEndEvent) => {
          if (over) void reorder(group, skills, indexIn(skills, active.id), indexIn(skills, over.id));
        }}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up “${skills[indexIn(skills, active.id)]?.name}”.`,
            onDragOver: ({ over }) => (over ? `Over position ${indexIn(skills, over.id) + 1} of ${skills.length}.` : "Not over the list."),
            onDragEnd: ({ over }) => (over ? `Dropped at position ${indexIn(skills, over.id) + 1} of ${skills.length}.` : "Dropped back where it was."),
            onDragCancel: () => "Moving cancelled.",
          },
        }}
      >
        <SortableContext items={skills.map((skill) => skill.id)} strategy={rectSortingStrategy}>
          <ul className="flex flex-wrap gap-2" aria-label={label}>
            {skills.map((skill, index) => {
              const roles = roleCount(skill.id);
              return (
                <SortableChip key={skill.id} id={skill.id}>
                  <RemovableChip
                    meta={roles > 0 ? `${roles} ${roles === 1 ? "role" : "roles"}` : undefined}
                    removeLabel={`Remove ${skill.name}`}
                    onRemove={() => void remove(skill.id)}
                  >
                    <SkillMenu
                      skill={skill}
                      groups={groupNames}
                      first={index === 0}
                      last={index === skills.length - 1}
                      onMove={(step) => void reorder(group, skills, index, index + step)}
                      onGroup={(to) => void move(skill.id, to)}
                    />
                  </RemovableChip>
                </SortableChip>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    );

  return (
    <ChipCard title="Skills" count={profile.skills.length}>
      {profile.skills.length > 1 && (
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-meta text-muted">
          {mode === "manual" ? (
            <>
              <span>In your own order, which tailored resumes keep.</span>
              <Button variant="text" size="sm" onClick={() => void relevanceFirst()}>
                Most relevant first
              </Button>
            </>
          ) : (
            <span>Drag a skill, or move it from its menu, to set your own order. Tailored resumes put the most relevant first until you do.</span>
          )}
        </div>
      )}
      {chips("", ungrouped, "Your skills")}
      <AddSkillField label="Add a skill" placeholder="e.g. Accessibility" onAdd={(name) => add(name, "")} />
      {named.map(({ group, skills }) => (
        <div key={group} className="flex flex-col gap-3 border-t border-line pt-4">
          <GroupHeading name={group} others={groupNames.filter((name) => name !== group)} onRename={(to) => void rename(group, to)} />
          {chips(group, skills, `Skills in ${group}`)}
          <AddSkillField label={`Add to ${group}`} placeholder={`A skill for ${group}`} onAdd={(name) => add(name, group)} />
        </div>
      ))}
      <NewGroup existing={groupNames} onCreate={(name) => setEmptyGroups((current) => [...current, name])} />
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </ChipCard>
  );
}

/** A chip that follows the pointer while it's dragged; the menu is the keyboard's way to move it. */
function SortableChip({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("touch-none", isDragging && "relative z-10 opacity-90")} {...listeners}>
      {children}
    </li>
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

/** A skill's name, opening a menu that moves it within its list (public issue 62), or to another group or out of any. */
function SkillMenu({
  skill,
  groups,
  first,
  last,
  onMove,
  onGroup,
}: {
  skill: SkillItem;
  groups: readonly string[];
  first: boolean;
  last: boolean;
  /** -1 for left, 1 for right. */
  onMove: (step: -1 | 1) => void;
  onGroup: (group: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`${skill.name}: move it${groups.length > 0 ? ", or change its group" : ""}`} className="rounded-full text-left hover:text-primary-text">
        {skill.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{skill.name}</DropdownMenuLabel>
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
          Move right
        </DropdownMenuItem>
        {groups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Group</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={skill.group} onValueChange={onGroup}>
              <DropdownMenuRadioItem value="">No group</DropdownMenuRadioItem>
              {groups.map((group) => (
                <DropdownMenuRadioItem key={group} value={group}>
                  {group}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
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
    <ChipCard title="Languages" count={profile.languages.length}>
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

/** The Skills section. */
export function SkillsSection({ profile, update, order = "relevance" }: { profile: ProfileData; update: UpdateProfile; order?: SkillOrder }) {
  return <SkillsCard profile={profile} update={update} order={order} />;
}

/** The Languages section. */
export function LanguagesSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return <LanguagesCard profile={profile} update={update} />;
}
