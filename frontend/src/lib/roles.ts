/** Every valid role name — manually kept in sync with the backend's
 *  `Modules/Auth/RoleNames.cs` (same convention as `MASTER_DATA_TYPES` in settings/page.tsx
 *  mirroring the backend's `MasterDataEntityType` enum; there's no shared codegen in this repo). */
export const ROLES = ["Admin", "User", "Director", "Valuer", "Broker", "Sales", "Warehouse", "Buyer", "Client", "Factory"] as const;

export type RoleName = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  Admin: "Admin",
  User: "User",
  Director: "Director",
  Valuer: "Valuer",
  Broker: "Broker",
  Sales: "Sales",
  Warehouse: "Warehouse",
  Buyer: "Buyer",
  Client: "Client",
  Factory: "Factory",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as RoleName] ?? role;
}
