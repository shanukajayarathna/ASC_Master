namespace Asc.Api.Modules.Agents;

/// <summary>Picks one of N registered agents by key, falling back to the first registered
/// agent when no key is given or it doesn't match anything — with exactly one agent
/// registered today, this always resolves to it, which is a fully valid, permanent state,
/// not a placeholder waiting for a "real" implementation.</summary>
public class AgentRouter(IEnumerable<IAgent> agents)
{
    public IAgent Resolve(string? agentKey)
    {
        if (!string.IsNullOrWhiteSpace(agentKey))
        {
            var match = agents.FirstOrDefault(a => a.Key == agentKey);
            if (match is not null) return match;
        }
        return agents.First();
    }
}
