namespace Asc.Api.Modules.Agents;

/// <summary>
/// Read-only lookup over every <see cref="IAgent"/> registered in DI — AgentRouter's only
/// dependency for resolving a key to an agent. Never instantiates an agent itself (DI already
/// did that); never contains routing policy (AgentRouter owns "what happens when the key is
/// missing/unknown"), so this stays a pure directory, not a decision-maker.
/// </summary>
public interface IAgentRegistry
{
    /// <summary>Null if no registered agent has this key — callers decide what that means
    /// (AgentRouter treats it as a failure, never a silent fallback).</summary>
    IAgent? TryGetByKey(string key);

    IReadOnlyList<IAgent> GetAll();

    /// <summary>The agent used when a caller supplies no key at all — today, and for the
    /// foreseeable future, the first (and only) registered agent, GeneralAgent. Once a second
    /// agent exists this stays a deliberate choice, not "whichever happened to register first."</summary>
    IAgent GetDefault();
}
