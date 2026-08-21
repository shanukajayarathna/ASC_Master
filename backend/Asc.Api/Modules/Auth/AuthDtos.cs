namespace Asc.Api.Modules.Auth;

public record RegisterDto(string Email, string Password, string DisplayName);

public record LoginDto(string Email, string Password);

public record UserDto(Guid Id, string Email, string DisplayName, List<string> Roles, DateTime CreatedAt);

public record AuthResponseDto(string Token, UserDto User);

public record SetRoleDto(List<string> Roles);

public record ChangePasswordDto(string CurrentPassword, string NewPassword);

/// <summary>Admin-only edit of another user's account — any field may be omitted
/// (null/blank), but at least one must be set. No CurrentPassword check: an Admin managing
/// someone else's account is already the elevated action (same trust boundary as role
/// changes and deletion, which also skip it). DisplayName is what the dashboard greeting
/// and Topbar show, so this is also the fix for "wrong name at login" — not just email/password.</summary>
public record AdminUpdateUserDto(string? Email, string? NewPassword, string? DisplayName);
