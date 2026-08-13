using Asc.Api.Modules.Agents;
using Microsoft.Extensions.Logging.Abstractions;

namespace Asc.Api.Tests;

public class AgentRouterTests
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

    private static AgentRouter RouterFor(params IAgent[] agents) =>
        new(new AgentRegistry(agents), NullLogger<AgentRouter>.Instance);

    [Fact]
    public void Resolve_KnownKey_ReturnsThatAgent()
    {
        var router = RouterFor(new FakeAgent("general"), new FakeAgent("auction"));

        var resolved = router.Resolve("auction");

        Assert.Equal("auction", resolved.Key);
    }

    [Fact]
    public void Resolve_NullOrBlankKey_FallsBackToDefaultAgent()
    {
        var router = RouterFor(new FakeAgent("general"), new FakeAgent("auction"));

        Assert.Equal("general", router.Resolve(null).Key);
        Assert.Equal("general", router.Resolve("").Key);
        Assert.Equal("general", router.Resolve("   ").Key);
    }

    [Fact]
    public void Resolve_UnknownKey_ThrowsUnknownAgentException()
    {
        var router = RouterFor(new FakeAgent("general"), new FakeAgent("auction"));

        var ex = Assert.Throws<UnknownAgentException>(() => router.Resolve("nonexistent"));
        Assert.Contains("nonexistent", ex.Message);
    }

    [Fact]
    public void Resolve_SingleRegisteredAgent_NullKeyResolvesToIt()
    {
        // The real-world state today: exactly one agent registered — this must be a fully
        // valid, permanent case, not a degenerate one.
        var router = RouterFor(new FakeAgent("general"));

        Assert.Equal("general", router.Resolve(null).Key);
    }

    [Fact]
    public void Resolve_SingleRegisteredAgent_UnknownKeyStillThrows()
    {
        // Even with only one agent registered, an explicit-but-wrong key must fail loudly,
        // not silently coerce to the only agent that happens to exist.
        var router = RouterFor(new FakeAgent("general"));

        Assert.Throws<UnknownAgentException>(() => router.Resolve("anything"));
    }

    // ---- Real agents, real registration order (matches Program.cs) ----

    private static AgentRouter RealAgentRouter() =>
        RouterFor(new GeneralAgent(null!, null!), new AuctionAgent(null!, null!));

    [Fact]
    public void RealAgents_ResolveGeneral_ReturnsGeneralAgent()
    {
        Assert.IsType<GeneralAgent>(RealAgentRouter().Resolve("general"));
    }

    [Fact]
    public void RealAgents_ResolveAuction_ReturnsAuctionAgent()
    {
        Assert.IsType<AuctionAgent>(RealAgentRouter().Resolve("auction"));
    }

    [Fact]
    public void RealAgents_ResolveNull_ReturnsGeneralAgent()
    {
        // Backward compatibility: existing clients that never send an agent key must keep
        // reaching GeneralAgent now that a second agent is registered.
        Assert.IsType<GeneralAgent>(RealAgentRouter().Resolve(null));
    }

    [Fact]
    public void RealAgents_ResolveUnknown_ThrowsUnknownAgentException()
    {
        Assert.Throws<UnknownAgentException>(() => RealAgentRouter().Resolve("market"));
    }
}
