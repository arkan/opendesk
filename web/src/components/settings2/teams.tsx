import { appText } from "@/i18n/text";
// Teams and brands in settings (contracts/teams.md): the chips, dots, marks and
// pickers every settings page uses. Brand UI shows once a workspace has a
// second brand; team UI once it has a team.

import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Brand, Mailbox, PrivateTeamGrant, Team, TeamRole } from "@/lib/api/types";
import type { PickerItem } from "@/components/ui/picker";
import { cn } from "@/lib/cn";
import { q } from "@/lib/queries";
import { useUser } from "@/lib/session";
import { isTone, tone, toneFor } from "@/lib/tones";
import { Switch } from "@/components/ui/switch";
import { SinglePick, type PickSize } from "./pickers";

const none: never[] = [];

export function useTeams() {
  const { data, isLoading } = useQuery(q.teams());
  return { teams: data ?? none, isLoading };
}

/** The workspace's brands; `multi` once there is a second one. */
export function useBrands() {
  const { data, isLoading } = useQuery({ ...q.brands(), retry: false });
  const brands = data ?? none;
  return { brands, multi: brands.length > 1, isLoading, defaultBrand: brands.find((b) => b.is_default) ?? brands[0] };
}

/** The signed-in person's role on a team, if any. */
export function useMyTeamRole(team: Team | undefined): TeamRole | null {
  const me = useUser();
  return team?.members.find((m) => m.user_id === me.id)?.role ?? null;
}

const teamTone = (t: Pick<Team, "color" | "name">) => (isTone(t.color) ? t.color : toneFor(t.name));

/** A team's colour as a small square dot. */
export function TeamDot({ team, className }: { team: Pick<Team, "color" | "name">; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-[3px]", tone[teamTone(team)].solid, className)} />;
}

/** A team as a soft pill: its dot, its name and a lock when private. */
export function TeamChip({ team, className, size = "sm" }: { team: Pick<Team, "color" | "name" | "private">; className?: string; size?: "xs" | "sm" }) {
  const { t: appText } = useTranslation("app");
  return (
    <span
      className={cn(
        "inline-flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-sm font-medium",
        size === "xs" ? "h-[18px] px-1.5 text-[10.5px]" : "h-5 px-1.5 text-[11px]",
        tone[teamTone(team)].chip,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-[2px]", tone[teamTone(team)].solid)} />
      <span className="truncate">{team.name}</span>
      {team.private && <Lock aria-label={appText("Private")} className="size-2.5 shrink-0 opacity-70" />}
    </span>
  );
}

/** "Private" with a lock, in a quiet tone. */
export function PrivatePill({ className }: { className?: string }) {
  const { t } = useTranslation("settingsTeams");
  return (
    <span className={cn("inline-flex h-[19px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10.5px] font-medium", tone.gray.chip, className)}>
      <Lock className="size-2.5" aria-hidden />
      {t("common.private")}
    </span>
  );
}

/** Team picker rows: the dot and a lock for private teams. */
export function teamItems(teams: Team[]): PickerItem[] {
  return teams.map((t) => ({
    value: t.id,
    label: t.name,
    icon: <TeamDot team={t} />,
    hint: t.private ? <Lock className="size-3 text-fg-4" aria-label={appText("Private")} /> : undefined,
  }));
}

const NONE = "__none";

/**
 * One team or none, as a builder-style value button. `noneLabel` names the
 * empty choice ("Everyone", "Any team", "No team").
 */
export function TeamPick({
  value,
  onChange,
  noneLabel,
  placeholder,
  disabled,
  className,
  invalid,
  only,
  size,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  /** Restrict the choice (e.g. teams the caller belongs to). */
  only?: (t: Team) => boolean;
  /** `md` beside 32 px inputs and selects in a form; `sm` (default) in builder rows. */
  size?: PickSize;
}) {
  const { t } = useTranslation("settingsTeams");
  const { teams } = useTeams();
  const items: PickerItem[] = [
    ...(noneLabel ? [{ value: NONE, label: noneLabel, icon: <span aria-hidden className="size-2 shrink-0 rounded-[3px] border border-dashed border-line-strong" /> }] : []),
    ...teamItems(only ? teams.filter(only) : teams),
  ];
  const cur = teams.find((x) => x.id === value);
  return (
    <SinglePick
      items={items}
      value={value ?? (noneLabel ? NONE : null)}
      onChange={(v) => onChange(v === NONE ? null : v)}
      placeholder={placeholder ?? t("common.chooseTeam")}
      searchPlaceholder={t("common.searchTeams")}
      disabled={disabled}
      invalid={invalid}
      className={className}
      size={size}
      renderValue={(v) => (v === NONE ? <span className="text-fg-2">{noneLabel}</span> : cur ? <TeamChip team={cur} size="xs" /> : null)}
    />
  );
}

/** A brand's logo, or its initial on its colour. */
export function BrandMark({ brand, size = "md", className }: { brand: Pick<Brand, "name" | "color" | "images">; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const px = { xs: "size-4 rounded-[4px] text-[8.5px]", sm: "size-5 rounded-[5px] text-[10px]", md: "size-8 rounded-md text-[13px]", lg: "size-12 rounded-lg text-[18px]" }[size];
  if (brand.images.logo)
    return <img src={brand.images.logo} alt="" className={cn("shrink-0 border border-line object-cover", px, className)} />;
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center font-semibold text-white", px, !brand.color && tone[toneFor(brand.name)].solid, className)}
      style={brand.color ? { background: brand.color } : undefined}
    >
      {brand.name.charAt(0).toUpperCase()}
    </span>
  );
}

export function brandItems(brands: Brand[]): PickerItem[] {
  return brands.map((b) => ({ value: b.id, label: b.name, icon: <BrandMark brand={b} size="xs" />, hint: b.is_default ? appText("Default") : undefined }));
}

/** One brand, as a builder-style value button. */
export function BrandPick({ value, onChange, disabled, className }: { value: string | null | undefined; onChange: (id: string) => void; disabled?: boolean; className?: string }) {
  const { t } = useTranslation("settingsTeams");
  const { brands } = useBrands();
  return (
    <SinglePick
      items={brandItems(brands)}
      value={value}
      onChange={onChange}
      placeholder={t("common.chooseBrand")}
      searchPlaceholder={t("common.searchBrands")}
      disabled={disabled}
      className={className}
    />
  );
}

/** Mailbox picker rows: the address, its name, a lock when its team is private. */
export function mailboxItems(mailboxes: Mailbox[], brands: Brand[] = []): PickerItem[] {
  const multi = brands.length > 1;
  return mailboxes.map((m) => ({
    value: m.id,
    label: m.email,
    keywords: [m.name, ...m.aliases],
    group: multi ? brands.find((b) => b.id === m.brand_id)?.name : undefined,
    hint: m.private ? <Lock className="size-3 text-fg-4" aria-label={appText("Private")} /> : m.name !== m.email ? m.name : undefined,
  }));
}

/** A quiet note with a dot, for consequences and explanations. */
export function Note({ children, tone: hue = "gray", className, icon }: { children: ReactNode; tone?: "gray" | "amber" | "violet" | "blue"; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-[12px] leading-[18px]", hue === "gray" ? "bg-sunken text-fg-3" : cn(tone[hue].soft, tone[hue].text), className)}>
      {icon ?? <span aria-hidden className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", hue === "gray" ? "bg-fg-4" : tone[hue].solid)} />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Which private teams an API key or webhook may see (contracts/teams.md
 * "Visibility"). Only a member of a private team can add it or take it away,
 * so the others are shown but locked.
 */
export function PrivateTeamsField({ value, onChange, grants }: { value: string[]; onChange: (ids: string[]) => void; grants?: PrivateTeamGrant[] }) {
  const { t } = useTranslation("settingsTeams");
  const me = useUser();
  const { teams } = useTeams();
  const priv = teams.filter((x) => x.private);
  if (!priv.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium">{t("scoped.privateTeams")}</span>
      <div className="overflow-hidden rounded-md border border-line">
        {priv.map((x) => {
          const mine = x.members.some((m) => m.user_id === me.id);
          const on = value.includes(x.id);
          const by = on ? grants?.find((g) => g.id === x.id)?.granted_by : undefined;
          return (
            <label key={x.id} className={cn("flex items-center gap-2.5 border-b border-line-soft px-3 py-2 last:border-0", !mine && "bg-sunken/50")}>
              <TeamDot team={x} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{x.name}</span>
                {by && <span className="block truncate text-[11.5px] text-fg-3">{t("scoped.grantedBy", { name: by.name })}</span>}
                {!mine && <span className="block text-[11.5px] text-fg-4">{t("scoped.notOnTeam")}</span>}
              </span>
              <Switch
                checked={on}
                disabled={!mine && !on}
                aria-label={t("scoped.includeTeam", { name: x.name })}
                onCheckedChange={(v) => onChange(v ? [...value, x.id] : value.filter((y) => y !== x.id))}
              />
            </label>
          );
        })}
      </div>
      <p className="text-[12px] leading-[17px] text-fg-3">{t("scoped.privateTeamsHint")}</p>
    </div>
  );
}

/** A key's or webhook's private teams, each with who granted it: the grant lasts while they are on the team. */
export function GrantedTeams({ grants, className }: { grants?: PrivateTeamGrant[]; className?: string }) {
  const { t } = useTranslation("settingsTeams");
  const { teams } = useTeams();
  if (!grants?.length) return null;
  return (
    <ul aria-label={t("scoped.grantedTeams")} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]", className)}>
      {grants.map((g) => {
        const team = teams.find((x) => x.id === g.id);
        return (
          <li key={g.id} className="flex min-w-0 items-center gap-1.5">
            {team ? <TeamDot team={team} /> : <Lock className="size-3 shrink-0 text-fg-4" aria-hidden />}
            <span className="truncate font-medium text-fg-2">{g.name}</span>
            {g.granted_by && <span className="truncate text-fg-4">{t("scoped.grantedBy", { name: g.granted_by.name })}</span>}
          </li>
        );
      })}
    </ul>
  );
}
