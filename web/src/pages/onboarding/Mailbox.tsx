import { useTranslation } from "react-i18next";
import { appText } from "@/i18n/text";
import { Link, useNavigate } from "@tanstack/react-router";
import { AuthHeading } from "@/app/AuthLayout";
import { OnboardingSteps } from "@/components/auth/OnboardingSteps";
import { AddMailboxWizard } from "@/components/mailboxes/AddMailboxWizard";

export default function Mailbox() {
  useTranslation("app");
  const navigate = useNavigate();
  const toInbox = () => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
  return (
    <div>
      <OnboardingSteps current={2} />
      <AuthHeading title={appText("Connect your first mailbox")} subtitle={appText("Mail sent to this address becomes tickets your team can answer together.")} />
      <AddMailboxWizard
        compact
        onDone={toInbox}
        extraFooter={
          <Link
            to="/inbox/$folder/{-$ticketId}"
            params={{ folder: "unassigned", ticketId: undefined }}
            className="rounded-md px-2 py-1 text-[12.5px] text-fg-3 hover:bg-hover hover:text-fg"
          >

            {appText("Skip for now")}
          </Link>
        }
      />
    </div>
  );
}
