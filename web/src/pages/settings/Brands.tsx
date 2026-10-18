import { appText } from "@/i18n/text";
// Settings > Brands (contracts/teams.md): what customers see. Each brand has
// its addresses, chat widgets and help center. Every workspace has one
// default brand; brand pickers elsewhere appear once there is a second.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Inbox, MessageCircle, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, Section, SettingsPage } from "@/components/layout";
import { ListSkeleton } from "@/components/settings2/bits";
import { MotionList, MotionRow } from "@/components/settings2/motion";
import { BrandMark, Note } from "@/components/settings2/teams";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ColorField } from "@/components/widget/fields";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Brand } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { bareUrl, defaultHelpUrl, withSlug } from "@/lib/helpCenter";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole, useWorkspace } from "@/lib/session";
import { tone } from "@/lib/tones";

export const SLUG = /^[a-z0-9-]{3,40}$/;
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export default function Brands() {
  const { t } = useTranslation("settingsTeams");
  const admin = atLeast(useRole(), "admin");
  const { data: brands, isLoading } = useQuery({ ...q.brands(), enabled: admin });
  const [creating, setCreating] = useState(false);

  if (!admin)
    return (
      <SettingsPage title={t("brands.title")}>
        <NoAccess what={appText("brands")} />
      </SettingsPage>
    );

  const sorted = [...(brands ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.position - b.position);

  return (
    <SettingsPage
      title={t("brands.title")}
      description={t("brands.description")}
      actions={
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          {t("brands.new")}
        </Button>
      }
    >
      {sorted.length === 1 && <Note tone="blue">{t("brands.singleNote")}</Note>}
      <Section flush title={brands ? t("brands.count", { count: brands.length }) : undefined}>
        {isLoading ? (
          <ListSkeleton rows={2} />
        ) : (
          <MotionList>
            {sorted.map((b) => (
              <MotionRow key={b.id}>
                <BrandRow brand={b} />
              </MotionRow>
            ))}
          </MotionList>
        )}
      </Section>
      {creating && <NewBrandDialog onClose={() => setCreating(false)} />}
    </SettingsPage>
  );
}

function BrandRow({ brand }: { brand: Brand }) {
  const { t } = useTranslation("settingsTeams");
  return (
    <Link
      to="/settings/brands/$brandId"
      params={{ brandId: brand.id }}
      search={{}}
      className="group flex min-h-14 items-center gap-3 border-b border-line-soft px-4 py-2.5 outline-none transition-colors last:border-0 hover:bg-sunken focus-visible:bg-sunken"
    >
      <BrandMark brand={brand} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{brand.name}</span>
          {brand.is_default && <span className={cn("inline-flex h-[19px] items-center rounded-sm px-1.5 text-[10.5px] font-medium", tone.blue.chip)}>{t("brands.default")}</span>}
        </div>
        <div className="mono mt-0.5 truncate text-[11.5px] text-fg-3">{bareUrl(brand.help_center.url)}</div>
      </div>
      <span className="hidden items-center gap-1 text-[12px] text-fg-3 sm:inline-flex">
        <Inbox className="size-3 text-fg-4" aria-hidden />
        {t("brands.addresses", { count: brand.mailbox_count })}
      </span>
      <span className="hidden w-[92px] items-center gap-1 text-[12px] text-fg-3 sm:inline-flex">
        <MessageCircle className="size-3 text-fg-4" aria-hidden />
        {t("brands.widgets", { count: brand.widget_count })}
      </span>
      <span className={cn("hidden w-[110px] items-center gap-1 text-[12px] md:inline-flex", brand.help_center.enabled ? "text-fg-3" : "text-fg-4")}>
        <BookOpen className="size-3 text-fg-4" aria-hidden />
        {brand.help_center.enabled ? t("brands.helpOn") : t("brands.helpOff")}
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
    </Link>
  );
}

function NewBrandDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("settingsTeams");
  const qc = useQueryClient();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [color, setColor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shownSlug = slugTouched ? slug : slugify(name);
  // Another brand's default address shows how this one's will look.
  const { data: brands } = useQuery(q.brands());
  const sample = brands?.[0];
  const slugBad = shownSlug !== "" && !SLUG.test(shownSlug);

  const create = useMutation({
    mutationFn: () => api.brands.create({ name: name.trim(), slug: shownSlug, color }),
    onSuccess: (b) => {
      upsertInList(qc, qk.brands, b);
      toast.success(t("brands.created", { name: b.name }));
      onClose();
      void navigate({ to: "/settings/brands/$brandId", params: { brandId: b.id }, search: {} });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("brands.new")}
      description={t("brands.newHint")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="new-brand" loading={create.isPending} disabled={slugBad}>
            {t("brands.create")}
          </Button>
        </>
      }
    >
      <form
        id="new-brand"
        className="flex flex-col gap-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError(t("brands.nameRequired"));
          if (!SLUG.test(shownSlug)) return setError(t("brands.slugInvalid"));
          create.mutate();
        }}
      >
        <Field label={t("brands.name")} error={error}>
          {({ id, invalid }) => <TextInput id={id} autoFocus invalid={invalid} value={name} maxLength={60} placeholder={t("brands.namePlaceholder")} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t("brands.slug")} hint={slugBad ? undefined : t("brands.slugHint", { url: bareUrl(sample ? withSlug(sample, shownSlug || "your-brand") : defaultHelpUrl(shownSlug || "your-brand")) })} error={slugBad ? t("brands.slugInvalid") : undefined}>
          {({ id, invalid }) => (
            <TextInput
              id={id}
              className="mono"
              invalid={invalid}
              value={shownSlug}
              maxLength={40}
              placeholder="pressroom"
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium">{t("brands.color")}</span>
          <ColorField value={color} onChange={setColor} brand={ws?.settings.brand_color} />
        </div>
      </form>
    </Dialog>
  );
}
