using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class AgentRouterTests
{
    private class FakeAgent(string key) : IAgent
    {
        public string Key => key;
        public string Name => key;
        public Task<AgentResponse> HandleAsync(AgentRequest request, CancellationToken ct = default) =>
            Task.FromResult(new AgentResponse($"reply from {key}", "test-provider"));
    }

    [Fact]
    public void Resolve_KnownKey_ReturnsThatAgent()
    {
        var router = new AgentRouter([new FakeAgent("general"), new FakeAgent("auction")]);

        var resolved = router.Resolve("auction");

        Assert.Equal("auction", resolved.Key);
    }

    [Fact]
    public void Resolve_UnknownKey_FallsBackToFirstRegisteredAgent()
    {
        var router = new AgentRouter([new FakeAgent("general"), new FakeAgent("auction")]);

        var resolved = router.Resolve("nonexistent");

        Assert.Equal("general", resolved.Key);
    }

    [Fact]
    public void Resolve_NullOrBlankKey_FallsBackToFirstRegisteredAgent()
    {
        var router = new AgentRouter([new FakeAgent("general"), new FakeAgent("auction")]);

        Assert.Equal("general", router.Resolve(null).Key);
        Assert.Equal("general", router.Resolve("").Key);
        Assert.Equal("general", router.Resolve("   ").Key);
    }

    [Fact]
    public void Resolve_SingleRegisteredAgent_AlwaysResolvesToIt()
    {
        // The real-world state today: exactly one agent registered — this must be a fully
        // valid, permanent case, not a degenerate one.
        var router = new AgentRouter([new FakeAgent("general")]);

        Assert.Equal("general", router.Resolve(null).Key);
        Assert.Equal("general", router.Resolve("anything").Key);
    }
}
