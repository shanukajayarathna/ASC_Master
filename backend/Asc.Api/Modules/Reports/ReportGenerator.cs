using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.Reports;

/// <summary>
/// Ports the original vanilla-JS Report Builder (js/reports.js) onto this stack — same 7
/// report types (market/custom deferred, see Phase 5 plan), same underlying arithmetic,
/// but reusing DashboardController.Compute and one generic group-by-average helper instead
/// of the original's four near-duplicate per-column methods.
/// </summary>
public class ReportGenerator(ICatalogueSource source, MongoContext db)
{
    public static readonly string[] Types = ["executive", "broker", "grade", "category", "garden", "classification", "valuation"];

    public async Task<ReportDto?> Generate(string type, Guid catalogueId)
    {
        var catalogue = source.GetCatalogue(catalogueId);
        var lots = source.GetLots(catalogueId);
        if (catalogue is null || lots is null) return null;

        var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync())
            .ToDictionary(v => v.LotId, v => v.Valuation);
        var merged = lots.Select(l => (Lot: l, Val: LotsController.Merged(l, overrides))).ToList();

        var (title, subtitle, sections) = type switch
        {
            "executive" => ("Executive Summary", "Full catalogue overview", Executive(merged)),
            "broker" => ("Broker Summary", "Average valuation and lot count per broker", [GroupSection("Brokers", "Broker", merged, l => l.Broker)]),
            "grade" => ("Grade Summary", "Average valuation per grade", [GroupSection("Grades", "Grade", merged, l => l.Grade)]),
            "category" => ("Category Summary", "Average valuation per category", [GroupSection("Categories", "Category", merged, l => l.Category)]),
            "garden" => ("Garden Summary", "Average valuation per garden", [GroupSection("Gardens", "Garden", merged, l => l.Garden)]),
            "classification" => ("Classification Report", "Lot count by classification", [ClassificationSection(merged)]),
            "valuation" => ("Valuation Analysis", "Distribution of valued lots", [ValuationAnalysis(merged)]),
            _ => (null, null, null),
        };
        if (title is null) return null;

        return new ReportDto(type, title, subtitle!, catalogue.SourceName, DateTime.UtcNow, sections!);
    }

    private static List<ReportSectionDto> Executive(List<(Lot Lot, Valuation? Val)> merged)
    {
        var stats = DashboardController.Compute(merged);
        var kpis = new ReportSectionDto("Overview", [
            new("Total Lots", stats.Total, "count"),
            new("Completed", stats.Completed, "count"),
            new("Pending", stats.Pending, "count"),
            new("Average Valuation", stats.AvgValuation, "currency"),
            new("Highest Valuation", stats.MaxValuation, "currency"),
            new("Lowest Valuation", stats.MinValuation, "currency"),
        ], null, null);

        return [kpis, GroupSection("By Broker", "Broker", merged, l => l.Broker), GroupSection("By Grade", "Grade", merged, l => l.Grade)];
    }

    /// <summary>The generic group-by-average this app's version doesn't duplicate per column
    /// (the original JS had a separate near-identical method per report type).</summary>
    private static ReportSectionDto GroupSection(string title, string unitLabel, List<(Lot Lot, Valuation? Val)> merged, Func<Lot, string?> selector)
    {
        var rows = merged
            .Where(x => x.Val?.EffectiveValue != null)
            .Select(x => (Label: string.IsNullOrWhiteSpace(selector(x.Lot)) ? "(blank)" : selector(x.Lot)!, Value: x.Val!.EffectiveValue!.Value))
            .GroupBy(x => x.Label)
            .Select(g => new GroupRowDto(g.Key, g.Count(), g.Average(x => x.Value), null))
            .OrderByDescending(g => g.AverageValue)
            .ToList();

        return new ReportSectionDto(title, null, unitLabel, rows);
    }

    private static ReportSectionDto ClassificationSection(List<(Lot Lot, Valuation? Val)> merged)
    {
        var total = merged.Count;
        var rows = merged
            .GroupBy(x => x.Val?.Classification ?? Classification.Unclassified)
            .Select(g => new GroupRowDto(ClassificationLabel(g.Key), g.Count(), null, total > 0 ? (double)g.Count() / total * 100 : 0))
            .OrderByDescending(g => g.Count)
            .ToList();

        return new ReportSectionDto("By Classification", null, "Classification", rows);
    }

    private static string ClassificationLabel(Classification c) => c switch
    {
        Classification.SelectBest => "Select Best",
        Classification.Best => "Best",
        Classification.BelowBest => "Below Best",
        Classification.Poor => "Poor",
        _ => "Unclassified",
    };

    private static ReportSectionDto ValuationAnalysis(List<(Lot Lot, Valuation? Val)> merged)
    {
        var values = merged.Where(x => x.Val?.EffectiveValue != null).Select(x => x.Val!.EffectiveValue!.Value).OrderBy(v => v).ToList();
        decimal? median = values.Count == 0 ? null
            : values.Count % 2 == 1 ? values[values.Count / 2]
            : (values[values.Count / 2 - 1] + values[values.Count / 2]) / 2;

        return new ReportSectionDto("Distribution", [
            new("Mean", values.Count > 0 ? values.Average() : null, "currency"),
            new("Median", median, "currency"),
            new("Highest", values.Count > 0 ? values.Max() : null, "currency"),
            new("Lowest", values.Count > 0 ? values.Min() : null, "currency"),
        ], null, null);
    }
}
