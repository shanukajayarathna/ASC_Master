using System.Text.RegularExpressions;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.CategoryAverageTrend;

/// <summary>
/// Category Average Trend report — the last five sales up to and including the selected one, with
/// the average price per grade and the change from the sale before. Computed live from the sale
/// files on every request and never stored, so it always agrees with the sale data as it stands.
/// Open to any signed-in user, like the rest of the Reports area.
/// </summary>
[ApiController]
[Route("api/v1/reports/category-average-trend")]
[Authorize]
public class CategoryAverageTrendController(ICatalogueSource source) : ControllerBase
{
    private static readonly Regex SaleNoInSourceName = new(@"^Sale (\d+) - \d+$", RegexOptions.Compiled);

    /// <summary>Every sale in true chronological order (year, then sale number). Sale number comes from the
    /// source name because import timestamps can be out of order after a bulk import — see
    /// MarketBulletinController.PreviousCatalogue. Ordering by year first is also what makes sale 1 of a
    /// year follow the last sale of the year before, which sale-number arithmetic can't do.</summary>
    private List<(Catalogue Catalogue, int SaleNo)> SalesOldestFirst() =>
        [.. source.ListCatalogues()
            .Select(c => (Catalogue: c, Match: SaleNoInSourceName.Match(c.SourceName)))
            .Where(x => x.Match.Success)
            .Select(x => (x.Catalogue, SaleNo: int.Parse(x.Match.Groups[1].Value)))
            .OrderBy(x => x.Catalogue.Year).ThenBy(x => x.SaleNo)];

    [HttpGet("{catalogueId:guid}")]
    public ActionResult<CategoryAverageTrendDto> Get(Guid catalogueId, [FromQuery] string? broker)
    {
        var all = SalesOldestFirst();
        var index = all.FindIndex(x => x.Catalogue.Id == catalogueId);
        if (index < 0) return NotFound();

        // The selected sale, the four before it, and one more only as the comparison base.
        var first = Math.Max(0, index - CategoryAverageTrendEngine.ShownSales);
        var window = new List<TrendSaleLots>();
        for (var i = first; i <= index; i++)
        {
            var lots = source.GetLots(all[i].Catalogue.Id);
            window.Add(new TrendSaleLots(all[i].SaleNo, all[i].Catalogue.Year, lots ?? []));
        }

        var trimmed = string.IsNullOrWhiteSpace(broker) ? null : broker.Trim();
        return Ok(CategoryAverageTrendEngine.Build(window, trimmed));
    }

    /// <summary>The newest sale that actually has sold results, so the page opens on real figures
    /// instead of an upcoming sale whose catalogue is loaded but hasn't sold yet.</summary>
    [HttpGet("latest")]
    public ActionResult<LatestSaleWithResultsDto> Latest()
    {
        var all = SalesOldestFirst();
        for (var i = all.Count - 1; i >= 0; i--)
        {
            var lots = source.GetLots(all[i].Catalogue.Id);
            if (lots is not null && lots.Any(CategoryAverageTrendEngine.IsSoldOrOutsold))
                return Ok(new LatestSaleWithResultsDto(all[i].Catalogue.Id, all[i].Catalogue.SourceName));
        }
        return NotFound();
    }
}
