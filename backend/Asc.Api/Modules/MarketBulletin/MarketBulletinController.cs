using System.Text.RegularExpressions;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Weekly Market Bulletin — Valuation Centre price-tier ranges (Select Best/Best/Below
/// Best/Poor, or the section's own merged rows) per grade, this sale vs the immediately
/// preceding one. See MarketBulletinEngine for the tiering/grouping rules.
/// </summary>
[ApiController]
[Route("api/v1/market-bulletin")]
[Authorize]
public class MarketBulletinController(ICatalogueSource source) : ControllerBase
{
    private static readonly Regex SaleNoInSourceName = new(@"^Sale (\d+) - \d+$", RegexOptions.Compiled);

    [HttpGet("{catalogueId:guid}")]
    public ActionResult<MarketBulletinDto> Get(Guid catalogueId)
    {
        var catalogue = source.GetCatalogue(catalogueId);
        var lots = source.GetLots(catalogueId);
        if (catalogue is null || lots is null) return NotFound();

        var previous = PreviousCatalogue(source, catalogue);
        var previousLots = previous is not null ? source.GetLots(previous.Id) : null;

        var dto = MarketBulletinEngine.Build(
            [.. lots],
            previousLots is null ? null : [.. previousLots],
            catalogue.SourceName,
            previous?.SourceName);
        return Ok(dto);
    }

    /// <summary>
    /// Month-over-month quantity/average-price comparison for the bulletin's 4th page — see
    /// MarketBulletinMonthlyEngine for the full slot-matching/tiering rules. Null (204, not an
    /// error) only when the catalogue's own SourceName doesn't match the expected "Sale N -
    /// YYYY" shape, since there's no sale number to anchor a month calendar to.
    /// </summary>
    [HttpGet("{catalogueId:guid}/monthly")]
    public ActionResult<MonthlyComparisonDto> Monthly(Guid catalogueId)
    {
        var catalogue = source.GetCatalogue(catalogueId);
        if (catalogue is null) return NotFound();

        var dto = MarketBulletinMonthlyEngine.Build(source, catalogue);
        return dto is null ? NoContent() : Ok(dto);
    }

    /// <summary>
    /// The previous sale is (same year, sale number - 1) — computed directly via
    /// SaleFileStore's own deterministic id scheme, NOT inferred from list position/
    /// ImportedAt ordering. ImportedAt is a real file-import timestamp for bulk-loaded
    /// historical years but a computed weekly-date estimate for the current year, so the
    /// two aren't comparable across (or sometimes even within) years — a bulk import that
    /// processed files in lexical rather than numeric order (e.g. "10" before "9") would
    /// silently pair a sale with the wrong "previous" one. Sale-number arithmetic has no
    /// such dependency on import order or date estimation.
    /// </summary>
    internal static Models.Catalogue? PreviousCatalogue(ICatalogueSource source, Models.Catalogue catalogue)
    {
        var match = SaleNoInSourceName.Match(catalogue.SourceName);
        if (!match.Success) return null;
        var saleNo = int.Parse(match.Groups[1].Value);
        if (saleNo <= 1) return null;

        var previousId = SaleFileStore.CatalogueIdFor(catalogue.Year, saleNo - 1);
        return source.GetCatalogue(previousId);
    }
}
