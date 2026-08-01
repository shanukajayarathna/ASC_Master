using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;

namespace Asc.Api.Modules.Auth;

[ApiController]
[Route("api/v1/auth")]
public class AuthController(MongoContext db, IConfiguration config, IPasswordHasher<AppUser> hasher) : ControllerBase
{
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
            if (!User.IsInRole("Admin")) return Forbid();
        }

        var email = dto.Email.Trim().ToLowerInvariant();
        if (await db.Users.Find(u => u.Email == email).AnyAsync())
            return Conflict("An account with that email already exists.");

        var user = new AppUser
        {
            Email = email,
            DisplayName = dto.DisplayName.Trim(),
            Roles = isFirstUser ? ["Admin"] : ["User"],
        };
        user.PasswordHash = hasher.HashPassword(user, dto.Password);
        await db.Users.InsertOneAsync(user);

        return Ok(new AuthResponseDto(IssueToken(user), ToDto(user)));
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponseDto>> Login(LoginDto dto)
    {
        var email = dto.Email.Trim().ToLowerInvariant();
        var user = await db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();
        if (user is null)
            return Unauthorized("Invalid email or password.");

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

    private static UserDto ToDto(AppUser user) => new(user.Id, user.Email, user.DisplayName, user.Roles);
}
