import { appText } from "@/i18n/text";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BackLink, NoAccess, Section, SettingsPage } from "@/components/layout";
import { AddMailboxWizard } from "@/components/mailboxes/AddMailboxWizard";
import { atLeast, useRole } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { limitDetail, showLimit } from "@/components/billing/PlanLimit";
import { useLimit } from "@/components/billing/hooks";

export default function MailboxNew() {
  const { t } = useTranslation("settingsChannels");
  const navigate = useNavigate();
  const role = useRole();
  const limit = useLimit("mailboxes");
  const { brand } = useSearch({ from: "/app/settings/mailboxes/new" });
  return (
    <SettingsPage
      title={t("new.title")}
      description={t("new.description")}
      back={<BackLink to="/settings/mailboxes">{t("detail.back")}</BackLink>}
    >
      {atLeast(role, "admin") && limit.atLimit ? (
        <Section flush>
          <EmptyState
            lit={2}
            title={t("new.limitTitle")}
            description={limitDetail("mailboxes", limit.max)}
            action={
              <Button variant="primary" onClick={() => showLimit("mailboxes", limit.max)}>
                {t("new.upgrade")}
              </Button>
            }
          />
        </Section>
      ) : atLeast(role, "admin") ? (
        <AddMailboxWizard
          brandId={brand}
          onCancel={() => void navigate({ to: "/settings/mailboxes" })}
          onDone={(m) =>
            m ? void navigate({ to: "/settings/mailboxes/$mailboxId", params: { mailboxId: m.id } }) : void navigate({ to: "/settings/mailboxes" })
          }
        />
      ) : (
        <NoAccess what={appText("mailboxes")} />
      )}
    </SettingsPage>
  );
}
