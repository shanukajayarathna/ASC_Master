using Asc.Api.Modules.Observability;
using Microsoft.Extensions.Configuration;

namespace Asc.Api.Tests;

public class AiCostEstimatorTests
{
    private static AiCostEstimator BuildEstimator(Dictionary<string, string?> settings)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return new AiCostEstimator(config);
    }

    [Fact]
    public void EstimateCostUsd_ModelWithNoConfiguredPricing_ReturnsNull()
    {
        var estimator = BuildEstimator([]);

        var cost = estimator.EstimateCostUsd("gpt-5.1", 1000, 500);

        Assert.Null(cost);
    }

    [Fact]
    public void EstimateCostUsd_ConfiguredModel_ComputesFromPer1MRates()
    {
        var estimator = BuildEstimator(new Dictionary<string, string?>
        {
            ["AiPricing:gpt-5.1:PromptPer1M"] = "2.00",
            ["AiPricing:gpt-5.1:CompletionPer1M"] = "8.00",
        });

        // 1,000,000 prompt tokens * $2/1M + 500,000 completion tokens * $8/1M = $2 + $4 = $6
        var cost = estimator.EstimateCostUsd("gpt-5.1", 1_000_000, 500_000);

        Assert.Equal(6.00m, cost);
    }

    [Fact]
    public void EstimateCostUsd_ZeroTokens_ReturnsZeroNotNull()
    {
        var estimator = BuildEstimator(new Dictionary<string, string?>
        {
            ["AiPricing:gpt-5.1:PromptPer1M"] = "2.00",
            ["AiPricing:gpt-5.1:CompletionPer1M"] = "8.00",
        });

        var cost = estimator.EstimateCostUsd("gpt-5.1", 0, 0);

        Assert.Equal(0m, cost);
    }

    [Fact]
    public void EstimateCostUsd_UnparsableRate_ReturnsNull()
    {
        var estimator = BuildEstimator(new Dictionary<string, string?>
        {
            ["AiPricing:gpt-5.1:PromptPer1M"] = "not-a-number",
            ["AiPricing:gpt-5.1:CompletionPer1M"] = "8.00",
        });

        var cost = estimator.EstimateCostUsd("gpt-5.1", 1000, 500);

        Assert.Null(cost);
    }
}
