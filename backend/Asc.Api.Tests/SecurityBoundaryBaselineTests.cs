using System.Reflection;
using Asc.Api.Modules.AccessRequests;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;

namespace Asc.Api.Tests;

/// <summary>
/// Small, deterministic baseline tests for the highest-risk module boundaries. These tests
/// intentionally inspect endpoint metadata rather than requiring a live MongoDB instance;
/// integration coverage can be layered on once a repository test fixture exists.
/// </summary>
public class SecurityBoundaryBaselineTests
{
    [Fact]
    public void RoleVocabulary_IsUniqueAndContainsRequiredSystemRoles()
    {
        Assert.Equal(RoleNames.All.Length, RoleNames.All.Distinct(StringComparer.Ordinal).Count());
        Assert.Contains(RoleNames.Admin, RoleNames.All);
        Assert.Contains(RoleNames.User, RoleNames.All);
    }

    [Fact]
    public void AuthEndpoints_KeepBootstrapPublicAndUserManagementProtected()
    {
        var auth = typeof(AuthController);

        Assert.Null(auth.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Null(Method(auth, "Register").GetCustomAttribute<AuthorizeAttribute>());
        Assert.Null(Method(auth, "Login").GetCustomAttribute<AuthorizeAttribute>());
        Assert.Equal(Policies.ManageUsers, Method(auth, "ListUsers").GetCustomAttribute<AuthorizeAttribute>()?.Policy);
        Assert.Equal(Policies.ManageUsers, Method(auth, "SetRole").GetCustomAttribute<AuthorizeAttribute>()?.Policy);
    }

    [Fact]
    public void AccessRequests_AllowOnlySubmissionAnonymously()
    {
        var controller = typeof(AccessRequestsController);

        Assert.True(Method(controller, "Submit").IsDefined(typeof(AllowAnonymousAttribute)));
        Assert.Equal(Policies.ManageUsers, Method(controller, "List").GetCustomAttribute<AuthorizeAttribute>()?.Policy);
        Assert.Equal(Policies.ManageUsers, Method(controller, "MarkReviewed").GetCustomAttribute<AuthorizeAttribute>()?.Policy);
    }

    [Fact]
    public void AuditLog_IsAdminPolicyProtectedAtControllerBoundary()
    {
        var authorize = typeof(AuditLogController).GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(authorize);
        Assert.Equal(Policies.ViewAuditLog, authorize!.Policy);
    }

    [Fact]
    public void NewAccessRequestAndAuditEntry_HaveSafeDefaults()
    {
        var request = new AccessRequest();
        var audit = new AuditLogEntry();

        Assert.Equal(AccessRequestStatus.Pending, request.Status);
        Assert.NotEqual(Guid.Empty, request.Id);
        Assert.NotEqual(default, request.CreatedAt);
        Assert.NotEqual(Guid.Empty, audit.Id);
        Assert.NotEqual(default, audit.Timestamp);
        Assert.Equal(string.Empty, audit.Action);
    }

    private static MethodInfo Method(Type controller, string name) =>
        controller.GetMethod(name, BindingFlags.Public | BindingFlags.Instance)
        ?? throw new InvalidOperationException($"Expected public action {controller.Name}.{name}.");
}
