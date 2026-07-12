import ComingSoon from "@/components/shared/ComingSoon";

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Settings"
      description="User accounts, roles/permissions and audit logging aren't built yet on either the API or the frontend — the current stack has no authentication layer. This is a deliberate next phase, not an oversight: it needs a real design decision on identity provider before implementation starts."
      features={["User accounts & roles", "Permission management", "Audit log", "Theme & display preferences"]}
    />
  );
}
