using System.Security.Cryptography;
using System.Text;

namespace Asc.Api.Modules.ApiKeys;

/// <summary>Shared by ApiKeysController (hashing a freshly generated key before storing it)
/// and ApiKeyAuthenticationHandler (hashing an incoming X-Api-Key to look it up) — a single
/// place so the two can never drift.</summary>
internal static class ApiKeyHasher
{
    public static string Hash(string rawKey) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawKey)));
}
