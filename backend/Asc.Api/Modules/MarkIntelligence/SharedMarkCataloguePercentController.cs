using System.Text.RegularExpressions;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Shared Mark Catalogues % Broker-wise report — for every factory catalogued by two or more
/// brokers in a chosen scope (one sale, a calendar month, a calendar year, or a sale-to-sale
/// range), what share of its catalogued quantity each broker carried. Computed live from the
/// sale files on every request (ICatalogueSource — the same abstraction OKLO-sourced sales feed
/// through), never stored, same pattern as CategoryAverageTrendController. Open to any signed-in
/// user, like the rest of the Reports area.
/// </summary>
[ApiController]
[Route("api/v1/reports/shared-mark-catalogue-percent")]
[Authorize]
public class SharedMarkCataloguePercentController(ICatalogueSource source) : ControllerBase
{
    private static readonly Regex SaleNoInSourceName = new(@"^Sale (\d+) - \d+$", RegexOptions.Compiled);

    /// <summary>Every sale in true chronological order (year, then sale number) — mirrors
    /// CategoryAverageTrendController.SalesOldestFirst: sale number comes from the source name
    /// because import timestamps can land out of order after a bulk import.</summary>
    private List<(Catalogue Catalogue, int SaleNo)> SalesOldestFirst() =>
        [.. source.ListCatalogues()
            .Select(c => (Catalogue: c, Match: SaleNoInSourceName.Match(c.SourceName)))
            .Where(x => x.Match.Success)
            .Select(x => (x.Catalogue, SaleNo: int.Parse(x.Match.Groups[1].Value)))
            .OrderBy(x => x.Catalogue.Year).ThenBy(x => x.SaleNo)];

    [HttpGet]
    public ActionResult<SharedMarkCataloguePercentDto> Get(
        [FromQuery] string mode,
        [FromQuery] Guid? catalogueId,
        [FromQuery] int? year,
        [FromQuery] int? month,
        [FromQuery] Guid? fromCatalogueId,
        [FromQuery] Guid? toCatalogueId,
        [FromQuery] bool includeReprints = false)
    {
        var catalogueIds = ResolveCatalogueIds(mode, catalogueId, year, month, fromCatalogueId, toCatalogueId);
        if (catalogueIds is null)
            return BadRequest("Provide a valid combination of mode + catalogueId/year/month/fromCatalogueId/toCatalogueId.");
        if (catalogueIds.Count == 0)
            return Ok(new SharedMarkCataloguePercentDto([], []));

        var lots = catalogueIds.SelectMany(id => source.GetReportLots(id) ?? []);
        return Ok(SharedMarkCataloguePercentEngine.Build(lots, includeReprints));
    }

    private List<Guid>? ResolveCatalogueIds(
        string mode, Guid? catalogueId, int? year, int? month, Guid? fromCatalogueId, Guid? toCatalogueId)
    {
        switch (mode?.Trim().ToLowerInvariant())
        {
            case "sale":
                return catalogueId is { } id ? [id] : null;

            case "month":
                if (year is null || month is null || month is < 1 or > 12) return null;
                return source.ListCatalogues()
                    .Where(c => c.Year == year && c.ImportedAt.Month == month)
                    .Select(c => c.Id)
                    .ToList();

            case "year":
                if (year is null) return null;
                return source.ListCatalogues().Where(c => c.Year == year).Select(c => c.Id).ToList();

            case "range":
                if (fromCatalogueId is null || toCatalogueId is null) return null;
                var ordered = SalesOldestFirst();
                var fromIndex = ordered.FindIndex(x => x.Catalogue.Id == fromCatalogueId);
                var toIndex = ordered.FindIndex(x => x.Catalogue.Id == toCatalogueId);
                if (fromIndex < 0 || toIndex < 0) return null;
                var lo = Math.Min(fromIndex, toIndex);
                var hi = Math.Max(fromIndex, toIndex);
                return ordered.Skip(lo).Take(hi - lo + 1).Select(x => x.Catalogue.Id).ToList();

            default:
                return null;
        }
    }
}
