using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;

namespace Asc.Api.Modules.Auth;

[ApiController]
[Route("api/v1/auth")]
public class AuthController(MongoContext db, IConfiguration config, IPasswordHasher<AppUser> hasher, IAuditLogger audit) : ControllerBase
{
    // A fixed hash of a value nobody could ever type in as a real password — verified
    // against on the "unknown email" path in Login so that path pays the same PBKDF2 cost
    // a real verification would, rather than returning early and responding measurably
    // faster (a timing side-channel that would otherwise let an attacker enumerate which
    // emails have accounts even though both paths return an identical error message).
    private static readonly string DummyPasswordHash =
        new PasswordHasher<AppUser>().HashPassword(new AppUser(), "not-a-real-account-timing-guard-9f3a1c");

    /// <summary>
    /// Open only while no account exists yet (creates that first account as Admin) —
    /// after that, only an authenticated Admin can create further accounts. There's no
    /// self-service signup on an internal tool; this is the one bootstrap path.
    /// </summary>
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponseDto>> Register(RegisterDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Password) || string.IsNullOrWhiteSpace(dto.DisplayName))
            return BadRequest("Email, password, and display name are all required.");
        if (dto.Password.Length < 8)
            return BadRequest("Password must be at least 8 characters.");

        var isFirstUser = await db.Users.CountDocumentsAsync(FilterDefinition<AppUser>.Empty) == 0;
        if (!isFirstUser)
        {
            if (!(User.Identity?.IsAuthenticated ?? false)) return Unauthorized();
            if (!User.IsInRole(RoleNames.Admin)) return Forbid();
        }

        var email = dto.Email.Trim().ToLowerInvariant();
        if (await db.Users.Find(u => u.Email == email).AnyAsync())
            return Conflict("An account with that email already exists.");

        var user = new AppUser
        {
            Email = email,
            DisplayName = dto.DisplayName.Trim(),
            Roles = isFirstUser ? [RoleNames.Admin] : [RoleNames.User],
        };
        user.PasswordHash = hasher.HashPassword(user, dto.Password);
        await db.Users.InsertOneAsync(user);

        return Ok(new AuthResponseDto(IssueToken(user), ToDto(user)));
    }

    [HttpPost("login")]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<AuthResponseDto>> Login(LoginDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Password))
            return BadRequest("Email and password are required.");

        var email = dto.Email.Trim().ToLowerInvariant();
        var user = await db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();
        if (user is null)
        {
            hasher.VerifyHashedPassword(new AppUser(), DummyPasswordHash, dto.Password);
            return Unauthorized("Invalid email or password.");
        }

        var result = hasher.VerifyHashedPassword(user, user.PasswordHash, dto.Password);
        if (result == PasswordVerificationResult.Failed)
            return Unauthorized("Invalid email or password.");

        return Ok(new AuthResponseDto(IssueToken(user), ToDto(user)));
    }

    /// <summary>Round-trip check the frontend calls on load to rehydrate the logged-in user
    /// from a stored token, and to confirm that token is still valid.</summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> Me()
    {
        var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null || !Guid.TryParse(idClaim, out var id))
            return Unauthorized();

        var user = await db.Users.Find(u => u.Id == id).FirstOrDefaultAsync();
        return user is null ? Unauthorized() : Ok(ToDto(user));
    }

    private string IssueToken(AppUser user)
    {
        var keyString = config["Jwt:Key"]
            ?? throw new InvalidOperationException(
                "Jwt:Key is not configured. Set it for local dev with: dotnet user-secrets set Jwt:Key \"<random-string>\"");
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(keyString)), SecurityAlgorithms.HmacSha256);

        List<Claim> claims =
        [
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, user.DisplayName),
            .. user.Roles.Select(r => new Claim(ClaimTypes.Role, r)),
        ];

        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"],
            audience: config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(12),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    [HttpGet("users")]
    [Authorize(Policy = Policies.ManageUsers)]
    public async Task<ActionResult<List<UserDto>>> ListUsers(CancellationToken ct)
    {
        var users = await db.Users.Find(FilterDefinition<AppUser>.Empty).SortBy(u => u.CreatedAt).ToListAsync(ct);
        return Ok(users.Select(ToDto).ToList());
    }

    [HttpPatch("users/{id:guid}/role")]
    [Authorize(Policy = Policies.ManageUsers)]
    public async Task<ActionResult<UserDto>> SetRole(Guid id, SetRoleDto dto, CancellationToken ct)
    {
        if (dto.Roles.Count == 0 || dto.Roles.Any(r => !RoleNames.All.Contains(r)))
            return BadRequest($"Roles must be a non-empty list from: {string.Join(", ", RoleNames.All)}.");

        var user = await db.Users.Find(u => u.Id == id).FirstOrDefaultAsync(ct);
        if (user is null) return NotFound();

        if (user.Roles.Contains(RoleNames.Admin) && !dto.Roles.Contains(RoleNames.Admin) && await IsSoleAdmin(id, ct))
            return BadRequest("Can't demote the only remaining Admin.");

        var previousRoles = string.Join(", ", user.Roles);
        user.Roles = dto.Roles;
        await db.Users.ReplaceOneAsync(u => u.Id == id, user, cancellationToken: ct);
        await audit.LogAsync(User, "user.role_changed", "User", user.Id.ToString(), $"{previousRoles} -> {string.Join(", ", dto.Roles)}", ct);
        return Ok(ToDto(user));
    }

    /// <summary>Admin edit of another user's email, display name and/or password — the
    /// counterpart to self-service ChangePassword below, for when an Admin needs to fix a
    /// typo'd email/name or reset a password on someone else's behalf (no email/reset-token
    /// infra exists in this app, so this is the only path besides delete-and-recreate).
    /// DisplayName is what the dashboard greeting and Topbar show, so this also covers
    /// "the wrong name shows up when they log in," not just credentials.</summary>
    [HttpPatch("users/{id:guid}/credentials")]
    [Authorize(Policy = Policies.ManageUsers)]
    public async Task<ActionResult<UserDto>> UpdateCredentials(Guid id, AdminUpdateUserDto dto, CancellationToken ct)
    {
        var hasEmail = !string.IsNullOrWhiteSpace(dto.Email);
        var hasPassword = !string.IsNullOrWhiteSpace(dto.NewPassword);
        var hasDisplayName = !string.IsNullOrWhiteSpace(dto.DisplayName);
        if (!hasEmail && !hasPassword && !hasDisplayName) return BadRequest("Provide a new email, display name and/or password.");
        if (hasPassword && dto.NewPassword!.Length < 8) return BadRequest("New password must be at least 8 characters.");

        var user = await db.Users.Find(u => u.Id == id).FirstOrDefaultAsync(ct);
        if (user is null) return NotFound();

        var changes = new List<string>();

        if (hasEmail)
        {
            var email = dto.Email!.Trim().ToLowerInvariant();
            if (email != user.Email)
            {
                if (await db.Users.Find(u => u.Id != id && u.Email == email).AnyAsync(ct))
                    return Conflict("An account with that email already exists.");
                changes.Add($"email {user.Email} -> {email}");
                user.Email = email;
            }
        }

        if (hasDisplayName)
        {
            var displayName = dto.DisplayName!.Trim();
            if (displayName != user.DisplayName)
            {
                changes.Add($"name {user.DisplayName} -> {displayName}");
                user.DisplayName = displayName;
            }
        }

        if (hasPassword)
        {
            user.PasswordHash = hasher.HashPassword(user, dto.NewPassword!);
            changes.Add("password reset");
        }

        if (changes.Count == 0) return Ok(ToDto(user));

        await db.Users.ReplaceOneAsync(u => u.Id == id, user, cancellationToken: ct);
        await audit.LogAsync(User, "user.credentials_updated", "User", user.Id.ToString(), string.Join(", ", changes), ct);
        return Ok(ToDto(user));
    }

    [HttpDelete("users/{id:guid}")]
    [Authorize(Policy = Policies.ManageUsers)]
    public async Task<IActionResult> DeleteUser(Guid id, CancellationToken ct)
    {
        var user = await db.Users.Find(u => u.Id == id).FirstOrDefaultAsync(ct);
        if (user is null) return NotFound();

        if (user.Roles.Contains(RoleNames.Admin) && await IsSoleAdmin(id, ct))
            return BadRequest("Can't delete the only remaining Admin.");

        await db.Users.DeleteOneAsync(u => u.Id == id, ct);
        await audit.LogAsync(User, "user.deleted", "User", user.Id.ToString(), user.Email, ct);
        return NoContent();
    }

    /// <summary>True when `id` is the only user with the Admin role — the guard both
    /// SetRole and DeleteUser use to make sure the app can never end up with zero Admins
    /// (and, with no self-service reset flow, no way back in).</summary>
    private async Task<bool> IsSoleAdmin(Guid id, CancellationToken ct)
    {
        var otherAdmins = await db.Users.CountDocumentsAsync(u => u.Id != id && u.Roles.Contains(RoleNames.Admin), cancellationToken: ct);
        return otherAdmins == 0;
    }

    /// <summary>Self-service only — an Admin can remove and re-add a user who's lost their
    /// password (no email/reset-token infra exists in this app), but can't set anyone else's
    /// password directly.</summary>
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 8)
            return BadRequest("New password must be at least 8 characters.");

        var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null || !Guid.TryParse(idClaim, out var id)) return Unauthorized();

        var user = await db.Users.Find(u => u.Id == id).FirstOrDefaultAsync(ct);
        if (user is null) return Unauthorized();

        if (hasher.VerifyHashedPassword(user, user.PasswordHash, dto.CurrentPassword) == PasswordVerificationResult.Failed)
            return BadRequest("Current password is incorrect.");

        user.PasswordHash = hasher.HashPassword(user, dto.NewPassword);
        await db.Users.ReplaceOneAsync(u => u.Id == id, user, cancellationToken: ct);
        return NoContent();
    }

    private static UserDto ToDto(AppUser user) => new(user.Id, user.Email, user.DisplayName, user.Roles, user.CreatedAt);
}
