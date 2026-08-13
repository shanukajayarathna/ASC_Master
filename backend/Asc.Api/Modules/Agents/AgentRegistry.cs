namespace Asc.Api.Modules.Agents;

/// <summary>
/// Wraps whatever IAgent implementations DI resolved (see Program.cs — one today, GeneralAgent)
/// as a simple key-addressable directory. Materializes the sequence once since DI enumerates
/// IEnumerable&lt;IAgent&gt; lazily on every access otherwise, which would mean re-resolving
/// every agent's own dependency graph per lookup.
/// </summary>
public class AgentRegistry(IEnumerable<IAgent> agents) : IAgentRegistry
{
    private readonly IReadOnlyList<IAgent> _agents = agents.ToList();

    public IAgent? TryGetByKey(string key) => _agents.FirstOrDefault(a => a.Key == key);

    public IReadOnlyList<IAgent> GetAll() => _agents;

    public IAgent GetDefault() => _agents.First();
}
