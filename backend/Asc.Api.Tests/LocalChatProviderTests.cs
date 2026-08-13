using Asc.Api.Modules.Assistant;
using Microsoft.Extensions.Configuration;

namespace Asc.Api.Tests;

public class LocalChatProviderTests
{
    private static LocalChatProvider Provider(params (string Key, string Value)[] settings) =>
        new(new HttpClient(), new ConfigurationBuilder()
            .AddInMemoryCollection(settings.ToDictionary(s => s.Key, s => (string?)s.Value))
            .Build());

    [Fact]
    public void NotConfigured_ByDefault()
    {
        // Opt-in only: with no Local:Model set, the provider must never list as available —
        // an environment that hasn't chosen a local model shouldn't show a dead option.
        Assert.False(Provider().IsConfigured);
    }

    [Fact]
    public void Configured_WhenModelIsSet_WithoutAnyApiKey()
    {
        // The whole point of the local provider: no API key involved.
        Assert.True(Provider(("Local:Model", "llama3.1")).IsConfigured);
    }

    [Fact]
    public void Model_ComesFromConfiguration()
    {
        Assert.Equal("qwen2.5:7b", Provider(("Local:Model", "qwen2.5:7b")).Model);
    }

    [Fact]
    public void Key_IsStable()
    {
        // "local" is the wire value clients send in ChatRequestDto.Provider and the key
        // stored on conversation messages — renaming it would break both.
        Assert.Equal("local", Provider().Key);
    }

    [Fact]
    public void HostedProviders_StillRequireTheirApiKeys()
    {
        // The RequiresApiKey seam added for the local provider must not have loosened the
        // hosted vendors: no key, not configured.
        var emptyConfig = new ConfigurationBuilder().Build();
        Assert.False(new OpenAiChatProvider(new HttpClient(), emptyConfig).IsConfigured);
        Assert.False(new GroqChatProvider(new HttpClient(), emptyConfig).IsConfigured);
    }
}
