namespace Asc.Api.Modules.Auth;

public record RegisterDto(string Email, string Password, string DisplayName);

public record LoginDto(string Email, string Password);

public record UserDto(Guid Id, string Email, string DisplayName, List<string> Roles, DateTime CreatedAt);

public record AuthResponseDto(string Token, UserDto User);

public record SetRoleDto(string Role);

public record ChangePasswordDto(string CurrentPassword, string NewPassword);
