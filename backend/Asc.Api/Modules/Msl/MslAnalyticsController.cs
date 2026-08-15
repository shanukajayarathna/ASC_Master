using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

public record SaleStatRowDto(
    string Key, string? Label, long Lots, long SoldLots, decimal TotalQtyKg, decimal SoldQtyKg,
    decimal ProceedsRs, decimal? AvgPriceRs, decimal? MinPriceRs, decimal? MaxPriceRs);

public record SaleSummaryDto(
    int Year, int SaleNo, DateTime SaleDate, long Lots, long SoldLots,
    decimal TotalQtyKg, decimal SoldQtyKg, decimal ProceedsRs, decimal? AvgPriceRs);

public record SaleAnalyticsDto(
    int Year, int SaleNo, DateTime SaleDate, bool IsPrivateBucket,
    SaleStatRowDto Total,
    List<SaleStatRowDto> Brokers,
    List<SaleStatRowDto> Elevations,
    List<SaleStatRowDto> Grades,
    List<SaleStatRowDto> Buyers,
    List<SaleStatRowDto> Marks,
    List<SaleStatRowDto> PriceRanges,
    List<SaleSummaryDto> RecentSales);

/// <summary>
/// The Analysis screen's data source — everything reads the materialized mslSaleStats
/// rollups, so responses are a few hundred small documents regardless of archive size.
/// One payload per sale carries every dimension: pre-auction (catalogue composition) and
/// post-auction (sold/proceeds/averages) views are the same rows read differently.
/// </summary>
[ApiController]
[Route("api/v1/msl/analytics")]
[Authorize]
public class MslAnalyticsController(MongoContext db) : ControllerBase
{
    /// <summary>All sales for the pickers + weekly trend charts, newest first. SaleNo 0
    /// rows are a year's private-sales bucket.</summary>
    [HttpGet("sales")]
    public async Task<ActionResult<List<SaleSummaryDto>>> Sales([FromQuery] int? year, CancellationToken ct)
    {
        var fb = Builders<MslSaleStat>.Filter;
        var filter = fb.Eq(s => s.Dimension, "total");
        if (year is not null) filter &= fb.Eq(s => s.Year, year.Value);
        var rows = await db.MslSaleStats.Find(filter)
            .SortByDescending(s => s.Year).ThenByDescending(s => s.SaleNo)
            .ToListAsync(ct);
        return rows.Select(ToSummary).ToList();
    }

    [HttpGet("{year:int}/{saleNo:int}")]
    public async Task<ActionResult<SaleAnalyticsDto>> Sale(int year, int saleNo, CancellationToken ct)
    {
        var rows = await db.MslSaleStats
            .Find(s => s.Year == year && s.SaleNo == saleNo)
            .ToListAsync(ct);
        if (rows.Count == 0) return NotFound($"No data for sale {saleNo} of {year}.");

        var total = rows.First(r => r.Dimension == "total");

        // Context strip: this sale among its neighbours (previous ~12 by date).
        var recent = await db.MslSaleStats
            .Find(s => s.Dimension == "total" && s.SaleNo > 0 && s.SaleDate <= total.SaleDate)
            .SortByDescending(s => s.SaleDate)
            .Limit(13)
            .ToListAsync(ct);
        recent.Reverse();

        List<SaleStatRowDto> Dim(string d, int limit, bool byQty = true) =>
            rows.Where(r => r.Dimension == d)
                .OrderByDescending(r => byQty ? r.TotalQtyKg : r.ProceedsRs)
                .Take(limit)
                .Select(ToRow)
                .ToList();

        return new SaleAnalyticsDto(
            year, saleNo, total.SaleDate, saleNo == 0,
            ToRow(total),
            Dim("broker", 12),
            Dim("elevation", 8),
            Dim("grade", 60),
            Dim("buyer", 60),
            Dim("mark", 100),
            [.. rows.Where(r => r.Dimension == "priceRange").Select(ToRow)],
            recent.Select(ToSummary).ToList());
    }

    private static SaleStatRowDto ToRow(MslSaleStat s) => new(
        s.Key, s.Label, s.Lots, s.SoldLots, Math.Round(s.TotalQtyKg, 2), Math.Round(s.SoldQtyKg, 2),
        Math.Round(s.ProceedsRs, 2),
        s.SoldQtyKg > 0 ? Math.Round(s.ProceedsRs / s.SoldQtyKg, 2) : null,
        s.MinPriceRs, s.MaxPriceRs);

    private static SaleSummaryDto ToSummary(MslSaleStat s) => new(
        s.Year, s.SaleNo, s.SaleDate, s.Lots, s.SoldLots,
        Math.Round(s.TotalQtyKg, 2), Math.Round(s.SoldQtyKg, 2), Math.Round(s.ProceedsRs, 2),
        s.SoldQtyKg > 0 ? Math.Round(s.ProceedsRs / s.SoldQtyKg, 2) : null);
}
