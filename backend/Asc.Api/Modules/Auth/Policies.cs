namespace Asc.Api.Modules.Auth;

/// <summary>
/// Named permission seams, registered in Program.cs. Every one maps to
/// RequireRole(RoleNames.Admin) today — zero behavior change from the old
/// [Authorize(Roles="Admin")] literals/inline IsInRole checks they replace — but a future
/// change (e.g. "Directors can also manage webhooks") becomes a one-line policy edit here
/// instead of hunting down scattered attributes across controllers.
/// </summary>
public static class Policies
{
    public const string ManageUsers = "ManageUsers";
    public const string ManageApiKeys = "ManageApiKeys";
    public const string ManageWebhooks = "ManageWebhooks";
    public const string ManageMasterData = "ManageMasterData";
    public const string ManageKnowledgeBase = "ManageKnowledgeBase";
    public const string UseAdminAiTools = "UseAdminAiTools";
    public const string ViewAuditLog = "ViewAuditLog";
    public const string ViewObservability = "ViewObservability";

    /// <summary>Adding/replacing the system's source data files: weekly-sale catalogue
    /// imports (which overwrite files in data/sales) and manual MSL archive rescans.
    /// Day-to-day valuation work never needs this — it's the administrator's job.</summary>
    public const string ManageDataFiles = "ManageDataFiles";
}
