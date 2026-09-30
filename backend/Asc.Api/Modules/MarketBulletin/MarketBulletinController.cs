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
        var lots = source.GetReportLots(catalogueId);
        if (catalogue is null || lots is null) return NotFound();

        var previous = PreviousCatalogue(source, catalogue);
        var previousLots = previous is not null ? source.GetReportLots(previous.Id) : null;

        // Always the plain automatic computation — nothing here is ever saved (per explicit
        // instruction), so every fetch of this sale, including a page reload, sees the exact
        // same figures TierSplitter would produce on its own. See PreviewRangeOverride for the
        // one-off, un-persisted "what would this row look like" computation the editable UI
        // actually uses.
        var dto = MarketBulletinEngine.Build(
            [.. lots],
            previousLots is null ? null : [.. previousLots],
            catalogue.SourceName,
            previous?.SourceName);
        return Ok(dto);
    }

    public record RangeOverrideDto(string Section, string? GroupLabel, string TableTitle, string RowLabel, decimal Min, decimal Max);

    /// <summary>
    /// Recomputes ONE row's LotCount/QuantityPct for a hypothetical [Min, Max] "This Week"
    /// range, from this sale's real lots — but never writes anything anywhere. Per explicit
    /// instruction (reversing an earlier version of this feature that did persist to a
    /// database): a page reload must always show the plain automatic figures, with no saved
    /// state to revert. The frontend applies this response to its own local, in-memory view
    /// only — it's gone the moment the page is left or reloaded. Reuses MarketBulletinEngine's
    /// existing override machinery (same RowKey shape, same real-lots recompute) purely as a
    /// calculator: this one row's override map is thrown away as soon as Build returns.
    /// </summary>
    [HttpPost("{catalogueId:guid}/range-overrides/preview")]
    public ActionResult<PriceRangeDto> PreviewRangeOverride(Guid catalogueId, RangeOverrideDto dto)
    {
        var catalogue = source.GetCatalogue(catalogueId);
        var lots = source.GetReportLots(catalogueId);
        if (catalogue is null || lots is null) return NotFound();
        if (dto.Min > dto.Max) return BadRequest("Min cannot be greater than Max.");

        var key = new MarketBulletinEngine.RowKey(dto.Section, dto.GroupLabel, dto.TableTitle, dto.RowLabel);
        var overrides = new Dictionary<MarketBulletinEngine.RowKey, (decimal Min, decimal Max)> { [key] = (dto.Min, dto.Max) };

        var previous = PreviousCatalogue(source, catalogue);
        var previousLots = previous is not null ? source.GetReportLots(previous.Id) : null;
        var built = MarketBulletinEngine.Build(
            [.. lots],
            previousLots is null ? null : [.. previousLots],
            catalogue.SourceName,
            previous?.SourceName,
            overrides);

        var row = built.Sections
            .Where(s => s.Title == dto.Section)
            .SelectMany(s => s.Tables)
            .Where(t => t.GradeLabel == dto.TableTitle && t.GroupLabel == dto.GroupLabel)
            .SelectMany(t => t.Rows)
            .FirstOrDefault(r => r.Label == dto.RowLabel);
        return row is null ? NotFound("No such row.") : Ok(row.ThisWeek);
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
