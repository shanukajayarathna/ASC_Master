using Asc.Api.Models;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.ScheduledReports;

namespace Asc.Api.Tests;

public class ReportsAgentTests
{
    // ---- ReportsAgent metadata (no gateway/tools call — same pattern the project already
    // uses for testing a type's own properties without exercising injected dependencies) ----

    [Fact]
    public void Key_IsReports()
    {
        var agent = new ReportsAgent(null!, null!);
        Assert.Equal("reports", agent.Key);
    }

    [Fact]
    public void Capabilities_DescribeReportsOnly()
    {
        var agent = new ReportsAgent(null!, null!);

        Assert.Contains("report-lookup", agent.Capabilities);
        // Not general-purpose: must not claim GeneralAgent's document/knowledge capability.
        Assert.DoesNotContain("documents", agent.Capabilities);
    }

    [Fact]
    public void Description_MentionsReports()
    {
        var agent = new ReportsAgent(null!, null!);
        Assert.Contains("report", agent.Description, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Tool access boundary — the advertised Definitions list IS the enforcement
    // mechanism (a chat-completions API can only call a tool it was told about) ----

    [Fact]
    public void Definitions_IncludesReusedCatalogueTools()
    {
        var names = ReportsToolExecutor.Definitions.Select(d => d.Name).ToList();

        Assert.Contains("list_catalogues", names);
        Assert.Contains("generate_report", names);
        Assert.Contains("search_lots", names);
        Assert.Contains("get_dashboard_stats", names);
        Assert.Contains("get_breakdown", names);
    }

    [Fact]
    public void Definitions_IncludesNewSavedReportTools()
    {
        var names = ReportsToolExecutor.Definitions.Select(d => d.Name).ToList();

        Assert.Contains("list_saved_reports", names);
        Assert.Contains("get_saved_report", names);
    }

    [Fact]
    public void Definitions_ExcludesNonReportsTools()
    {
        var names = ReportsToolExecutor.Definitions.Select(d => d.Name).ToList();

        // Document search and deadline tracking are not report lookup/generation.
        Assert.DoesNotContain("search_knowledge_base", names);
        Assert.DoesNotContain("get_upcoming_deadlines", names);
        // Auction price-ranking is AuctionAgent's territory, not ReportsAgent's.
        Assert.DoesNotContain("get_top_prices", names);
        Assert.DoesNotContain("compare_sales", names);
    }

    [Fact]
    public void GeneralAgentToolSet_IsUnchangedByReportsAgentExisting()
    {
        // AssistantToolExecutor.Definitions (GeneralAgent's tool set) must still be exactly
        // the original 13 tool names — ReportsAgent must not have expanded or altered it as a
        // side effect of reusing 5 of them.
        string[] expected =
        [
            "list_catalogues", "search_lots", "get_dashboard_stats", "search_knowledge_base",
            "compare_sales", "get_valuation_accuracy", "get_broker_performance", "get_market_insights",
            "get_breakdown", "get_top_prices", "generate_report", "get_performance_insights",
            "get_upcoming_deadlines",
        ];

        Assert.Equal(expected, Asc.Api.Modules.Assistant.AssistantToolExecutor.Definitions.Select(d => d.Name));
    }

    // ---- ReportsToolExecutor's two new tools, against a fake ISavedReportsService ----

    private sealed class FakeSavedReportsService : ISavedReportsService
    {
        public List<SavedReport> Reports { get; } = [];

        public Task<bool> ExistsForSaleAsync(string type, int saleYear, int saleNo, CancellationToken ct = default) =>
            Task.FromResult(Reports.Any(r => r.Type == type && r.SaleYear == saleYear && r.SaleNo == saleNo));

        public Task<SavedReport> SaveAsync(SavedReport report, CancellationToken ct = default)
        {
            Reports.Add(report);
            return Task.FromResult(report);
        }

        public Task<List<SavedReport>> ListByTypeAsync(string type, int limit, CancellationToken ct = default) =>
            Task.FromResult(Reports.Where(r => r.Type == type).OrderByDescending(r => r.CreatedAt).Take(limit).ToList());

        public Task<SavedReport?> GetAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult(Reports.FirstOrDefault(r => r.Id == id));

        public Task<List<SavedReport>> ListAllAsync(int limit, CancellationToken ct = default) =>
            Task.FromResult(Reports.OrderByDescending(r => r.CreatedAt).Take(limit).ToList());
    }

    private static SavedReport Report(string type, string title, Guid? storedFileId = null) =>
        new() { Type = type, Title = title, StoredFileId = storedFileId };

    [Fact]
    public async Task ListSavedReports_ReturnsRowsWithDownloadUrlOnlyWhenStored()
    {
        var svc = new FakeSavedReportsService();
        svc.Reports.Add(Report("weekly-fact", "Weekly FACT 34", Guid.NewGuid()));
        svc.Reports.Add(Report("executive", "Executive Report"));
        var executor = new ReportsToolExecutor(null!, svc, new Microsoft.Extensions.Logging.Abstractions.NullLogger<ReportsToolExecutor>());

        var json = await executor.ExecuteAsync("list_saved_reports", "{}", isAdmin: false);

        Assert.Contains("Weekly FACT 34", json);
        Assert.Contains("Executive Report", json);
        Assert.Contains("/api/v1/reports/saved/", json);
    }

    [Fact]
    public async Task ListSavedReports_FiltersByType()
    {
        var svc = new FakeSavedReportsService();
        svc.Reports.Add(Report("weekly-fact", "Weekly FACT 34"));
        svc.Reports.Add(Report("executive", "Executive Report"));
        var executor = new ReportsToolExecutor(null!, svc, new Microsoft.Extensions.Logging.Abstractions.NullLogger<ReportsToolExecutor>());

        var json = await executor.ExecuteAsync("list_saved_reports", """{"type":"executive"}""", isAdmin: false);

        Assert.Contains("Executive Report", json);
        Assert.DoesNotContain("Weekly FACT 34", json);
    }

    [Fact]
    public async Task GetSavedReport_UnknownId_ReturnsError()
    {
        var svc = new FakeSavedReportsService();
        var executor = new ReportsToolExecutor(null!, svc, new Microsoft.Extensions.Logging.Abstractions.NullLogger<ReportsToolExecutor>());

        var json = await executor.ExecuteAsync("get_saved_report", $$"""{"id":"{{Guid.NewGuid()}}"}""", isAdmin: false);

        Assert.Contains("error", json);
    }

    [Fact]
    public async Task GetSavedReport_KnownId_ReturnsItsTitle()
    {
        var svc = new FakeSavedReportsService();
        var report = Report("executive", "Executive Report");
        svc.Reports.Add(report);
        var executor = new ReportsToolExecutor(null!, svc, new Microsoft.Extensions.Logging.Abstractions.NullLogger<ReportsToolExecutor>());

        var json = await executor.ExecuteAsync("get_saved_report", $$"""{"id":"{{report.Id}}"}""", isAdmin: false);

        Assert.Contains("Executive Report", json);
    }

    [Fact]
    public async Task ExecuteAsync_UnknownTool_ReturnsError()
    {
        var svc = new FakeSavedReportsService();
        var executor = new ReportsToolExecutor(null!, svc, new Microsoft.Extensions.Logging.Abstractions.NullLogger<ReportsToolExecutor>());

        var json = await executor.ExecuteAsync("delete_everything", "{}", isAdmin: false);

        Assert.Contains("not available", json);
    }
}
