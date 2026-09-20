namespace Asc.Api.Modules.Observability;

/// <summary>
/// Ambient "which agent is this call for" so AiGateway can log usage per agent without every agent passing its key
/// down. Set by the chat controller around an agent's HandleAsync; flows with the async call chain and is restored
/// when disposed. Calls made outside an agent (compare, background jobs) simply log no agent.
/// </summary>
public static class AiUsageScope
{
    private static readonly AsyncLocal<string?> Current_ = new();

    public static string? Current => Current_.Value;

    public static IDisposable Begin(string? agentKey)
    {
        var previous = Current_.Value;
        Current_.Value = agentKey;
        return new Restore(previous);
    }

    private sealed class Restore(string? previous) : IDisposable
    {
        public void Dispose() => Current_.Value = previous;
    }
}
