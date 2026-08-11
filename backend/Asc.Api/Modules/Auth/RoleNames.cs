namespace Asc.Api.Modules.Auth;

/// <summary>
/// Every valid role name — the single source of truth `AuthController.SetRole` and
/// `ApiKeysController.Create` validate against, instead of two independent hardcoded
/// "Admin"/"User" allow-lists. Admin/User are system-permission roles; the rest are
/// job-function roles for future role-aware dashboards/personalization — both live in the
/// same flat list since `AppUser.Roles`/`ApiKey.Roles` are a single `List&lt;string&gt;`
/// (a user can hold both, e.g. ["Admin", "Valuer"]).
/// </summary>
public static class RoleNames
{
    public const string Admin = "Admin";
    public const string User = "User";
    public const string Director = "Director";
    public const string Valuer = "Valuer";
    public const string Broker = "Broker";
    public const string Sales = "Sales";
    public const string Warehouse = "Warehouse";
    public const string Buyer = "Buyer";
    public const string Client = "Client";
    public const string Factory = "Factory";

    public static readonly string[] All =
        [Admin, User, Director, Valuer, Broker, Sales, Warehouse, Buyer, Client, Factory];
}
