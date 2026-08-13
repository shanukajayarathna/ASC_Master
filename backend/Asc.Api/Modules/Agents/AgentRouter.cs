namespace Asc.Api.Modules.Agents;

/// <summary>Resolves a request to one IAgent via IAgentRegistry. No key (or blank) means "use
/// the default agent" — with exactly one agent registered today (GeneralAgent), this always
/// resolves to it, which is a fully valid, permanent state, not a placeholder waiting for a
/// "real" implementation. An explicit but unregistered key is a caller error, not silently
/// coerced to the default — see UnknownAgentException below.</summary>
public class AgentRouter(IAgentRegistry registry, ILogger<AgentRouter> logger)
{
    public IAgent Resolve(string? agentKey)
    {
        if (string.IsNullOrWhiteSpace(agentKey))
        {
            var fallback = registry.GetDefault();
            logger.LogInformation("Agent routing requested: no agent key supplied, resolved={ResolvedAgent}", fallback.Key);
            return fallback;
        }

        var match = registry.TryGetByKey(agentKey);
        if (match is null)
        {
            logger.LogWarning("Unknown agent requested: requested={RequestedAgent}", agentKey);
            throw new UnknownAgentException(agentKey);
        }

        logger.LogInformation("Agent routing requested: requested={RequestedAgent}, resolved={ResolvedAgent}", agentKey, match.Key);
        return match;
    }
}

/// <summary>Thrown by AgentRouter.Resolve when an explicitly requested agent key doesn't match
/// any registered agent — mirrors ProviderUnavailableException's role in AiGateway (a clean,
/// caller-facing error rather than a silent fallback or a leaked exception).</summary>
public class UnknownAgentException(string agentKey) : Exception($"Unknown agent '{agentKey}'.");
