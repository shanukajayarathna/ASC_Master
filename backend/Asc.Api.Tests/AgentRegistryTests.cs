using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class AgentRegistryTests
{
    private class FakeAgent(string key) : IAgent
    {
        public string Key => key;
        public string Name => key;
        public string Description => $"fake agent {key}";
        public IReadOnlyList<string> Capabilities { get; } = [key];
        public Task<AgentResponse> HandleAsync(AgentRequest request, CancellationToken ct = default) =>
            Task.FromResult(new AgentResponse($"reply from {key}", "test-provider"));
    }

    [Fact]
    public void TryGetByKey_KnownKey_ReturnsAgent()
    {
        var registry = new AgentRegistry([new FakeAgent("general")]);

        Assert.Equal("general", registry.TryGetByKey("general")?.Key);
    }

    [Fact]
    public void TryGetByKey_UnknownKey_ReturnsNull()
    {
        var registry = new AgentRegistry([new FakeAgent("general")]);

        Assert.Null(registry.TryGetByKey("nonexistent"));
    }

    [Fact]
    public void GetAll_ContainsEveryRegisteredAgent()
    {
        var registry = new AgentRegistry([new FakeAgent("general"), new FakeAgent("auction")]);

        var all = registry.GetAll();

        Assert.Equal(2, all.Count);
        Assert.Contains(all, a => a.Key == "general");
        Assert.Contains(all, a => a.Key == "auction");
    }

    [Fact]
    public void GetDefault_SingleRegisteredAgent_ReturnsIt()
    {
        var registry = new AgentRegistry([new FakeAgent("general")]);

        Assert.Equal("general", registry.GetDefault().Key);
    }

    // ---- Real agents, real registration order (matches Program.cs) — the actual production
    // shape, not just the FakeAgent stand-in used above. ----

    [Fact]
    public void RealAgents_AuctionKeyResolvesToAuctionAgent()
    {
        var registry = new AgentRegistry([new GeneralAgent(null!, null!), new AuctionAgent(null!, null!)]);

        Assert.IsType<AuctionAgent>(registry.TryGetByKey("auction"));
    }

    [Fact]
    public void RealAgents_GetDefault_IsGeneralAgent()
    {
        var registry = new AgentRegistry([new GeneralAgent(null!, null!), new AuctionAgent(null!, null!)]);

        Assert.IsType<GeneralAgent>(registry.GetDefault());
    }

    [Fact]
    public void RealAgents_GetAll_ContainsBothGeneralAndAuction()
    {
        var registry = new AgentRegistry([new GeneralAgent(null!, null!), new AuctionAgent(null!, null!)]);

        var keys = registry.GetAll().Select(a => a.Key).ToList();

        Assert.Contains("general", keys);
        Assert.Contains("auction", keys);
        Assert.Equal(2, keys.Count);
    }
}
