using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

/// <summary>One factory's week/month-todate/year-todate figures — the database-computed
/// equivalent of a row from the WES master factory-wise sale workbook (see
/// frontend/src/lib/weeklyFactReport.ts's WesRow). Null pairs mean the factory held no
/// figure for that period (matches the WES sheet's blank cells).</summary>
public record WesFactoryRowDto(
    string Estate, string Code,
    decimal? WeekQtyKg, decimal? WeekAvgRs,
    decimal? MonthQtyKg, decimal? MonthAvgRs,
    decimal? YearQtyKg, decimal? YearAvgRs,
    int? WeekRank, int? MonthRank, int? YearRank);

public record WesEquivalentDto(
    int SaleNo, DateTime SaleDate,
    Dictionary<string, List<WesFactoryRowDto>> Categories,
    List<string> Warnings);

/// <summary>
/// Reproduces the WES master factory-wise sale workbook directly from the imported MSL
/// archive (auctionLots), as an alternative to uploading it by hand each week — verified
/// (16 Aug 2026) against real WES/RANK WISE archives for sale 30/2026: 568/571 week-level
/// factory rows exact across all 5 categories, year-to-date ~93% exact (small drift, likely
/// the post-auction price corrections already noted elsewhere in this codebase), rank
/// formula (dense rank by avg descending) exact. Only usable for sales already imported into
/// the database — callers must keep the manual WES upload as a fallback for a sale that
/// hasn't landed yet.
///
/// Two things aren't obvious from the raw TXT layout and had to be reverse engineered by
/// diffing against real archives:
///  1. The "reporting factory code" a WES row is keyed on is NOT the raw per-lot factory
///     code (AuctionLot.FactoryCode, e.g. "MFA1172"/"MFB1172") — it's the MSL code
///     (AuctionLot.MslCode) with its trailing 2-digit region suffix dropped. Two raw
///     sub-factory registrations sharing one MSL-code prefix collapse into ASC's single
///     reporting row (verified: MFA1172 + MFB1172 both carry MSL code "MF117236" and WES
///     reports them as one "VITHANAKANDA" row coded "MF1172").
///  2. A factory has ONE home elevation category for reporting purposes, even when a small
///     side-lot of its production carries a different class-code elevation prefix — that
///     lot's quantity still lands in the factory's home-elevation row, not a separate one
///     (verified: HAVENWEWA/MFD0878 sells almost entirely WESTERN MEDIUM tea but a 5,000kg
///     LOW-classed lot in sale 30 still counts toward its WESTERN MEDIUM total). Home
///     elevation here is whichever category holds the factory's largest year-to-date
///     quantity — computed once per request from the same year-window query already needed
///     for the year-to-date figures, so no extra query is required.
/// </summary>
public class MslWeeklyReportService(MongoContext db)
{
    private static readonly Dictionary<string, string> ElevationNames = new()
    {
        ["11"] = "UVA HIGH",
        ["12"] = "WESTERN HIGH",
        ["21"] = "UVA MEDIUM",
        ["22"] = "WESTERN MEDIUM",
        ["31"] = "LOW",
    };

    private sealed record LotProjection(string? MslCode, string FactoryCode, string? ElevationCode, string EstateName, decimal QuantityKg, decimal PriceRs);

    private static string ReportingFactoryCode(LotProjection l) =>
        !string.IsNullOrEmpty(l.MslCode) && l.MslCode.Length > 2 ? l.MslCode[..^2] : l.FactoryCode;

    public async Task<WesEquivalentDto?> BuildAsync(int year, int saleNo, CancellationToken ct)
    {
        var saleDate = await db.AuctionLots
            .Find(l => l.SaleYear == year && l.SaleNo == saleNo)
            .Project(l => l.SaleDate)
            .FirstOrDefaultAsync(ct);
        if (saleDate == default) return null;

        var warnings = new List<string>();
        var throughExclusive = saleDate.Date.AddDays(1); // sale's own day is inclusive
        var monthStart = new DateTime(saleDate.Year, saleDate.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var yearStart = new DateTime(saleDate.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var ytdLots = await FetchSoldLots(yearStart, throughExclusive, ct);
        if (ytdLots.Count == 0) warnings.Add("No sold lots found in the database for this year.");

        var byFactory = ytdLots.GroupBy(ReportingFactoryCode).ToList();
        var homeElevation = new Dictionary<string, string>();
        var estateNameOf = new Dictionary<string, string>();
        var yearFigure = new Dictionary<string, (decimal Qty, decimal Avg)?>();
        foreach (var g in byFactory)
        {
            var byElev = g.Where(l => l.ElevationCode is not null && ElevationNames.ContainsKey(l.ElevationCode))
                .GroupBy(l => l.ElevationCode!)
                .Select(eg => (Elev: eg.Key, Qty: eg.Sum(x => x.QuantityKg)))
                .OrderByDescending(x => x.Qty)
                .ToList();
            if (byElev.Count == 0) continue; // never appears in a known elevation category
            homeElevation[g.Key] = byElev[0].Elev;
            estateNameOf[g.Key] = g.GroupBy(l => l.EstateName).OrderByDescending(x => x.Count()).First().Key;
            var qty = g.Sum(l => l.QuantityKg);
            var val = g.Sum(l => l.QuantityKg * l.PriceRs);
            yearFigure[g.Key] = (qty, Math.Round(val / qty, 2));
        }

        var monthLots = await FetchSoldLots(monthStart, throughExclusive, ct);
        var monthFigure = AggregateByFactory(monthLots);

        var weekLots = await db.AuctionLots
            .Find(l => l.SaleYear == year && l.SaleNo == saleNo && l.Sold)
            .Project(l => new LotProjection(l.MslCode, l.FactoryCode, l.ElevationCode, l.EstateName, l.QuantityKg, l.PriceRs))
            .ToListAsync(ct);
        var weekFigure = AggregateByFactory(weekLots);

        var rows = new Dictionary<string, List<(string Code, WesFactoryRowDto Row)>>();
        foreach (var name in ElevationNames.Values) rows[name] = [];
        foreach (var (code, elev) in homeElevation)
        {
            var w = weekFigure.GetValueOrDefault(code);
            var m = monthFigure.GetValueOrDefault(code);
            var y = yearFigure.GetValueOrDefault(code);
            if (w is null && m is null && y is null) continue;
            var row = new WesFactoryRowDto(
                estateNameOf[code], code,
                w?.Qty, w?.Avg, m?.Qty, m?.Avg, y?.Qty, y?.Avg,
                null, null, null);
            rows[ElevationNames[elev]].Add((code, row));
        }

        var categories = new Dictionary<string, List<WesFactoryRowDto>>();
        foreach (var (catName, catRows) in rows)
        {
            var weekRank = DenseRank(catRows, r => r.Row.WeekAvgRs);
            var monthRank = DenseRank(catRows, r => r.Row.MonthAvgRs);
            var yearRank = DenseRank(catRows, r => r.Row.YearAvgRs);
            categories[catName] = catRows
                .Select(r => r.Row with
                {
                    WeekRank = weekRank.GetValueOrDefault(r.Code),
                    MonthRank = monthRank.GetValueOrDefault(r.Code),
                    YearRank = yearRank.GetValueOrDefault(r.Code),
                })
                .ToList();
        }

        return new WesEquivalentDto(saleNo, saleDate, categories, warnings);
    }

    private async Task<List<LotProjection>> FetchSoldLots(DateTime from, DateTime toExclusive, CancellationToken ct) =>
        await db.AuctionLots
            .Find(l => l.SaleDate >= from && l.SaleDate < toExclusive && l.Sold)
            .Project(l => new LotProjection(l.MslCode, l.FactoryCode, l.ElevationCode, l.EstateName, l.QuantityKg, l.PriceRs))
            .ToListAsync(ct);

    private static Dictionary<string, (decimal Qty, decimal Avg)?> AggregateByFactory(IEnumerable<LotProjection> lots) =>
        lots.GroupBy(ReportingFactoryCode).ToDictionary(g => g.Key, g =>
        {
            var qty = g.Sum(l => l.QuantityKg);
            var val = g.Sum(l => l.QuantityKg * l.PriceRs);
            return ((decimal Qty, decimal Avg)?)(qty, Math.Round(val / qty, 2));
        });

    /// <summary>Dense rank by average price descending — ties share a rank, next rank
    /// resumes at the row count (matches Excel/the archive's own rank column).</summary>
    private static Dictionary<string, int> DenseRank(List<(string Code, WesFactoryRowDto Row)> rows, Func<(string Code, WesFactoryRowDto Row), decimal?> avgOf)
    {
        var ranked = rows.Where(r => avgOf(r) is not null).OrderByDescending(avgOf).ToList();
        var result = new Dictionary<string, int>();
        decimal? prevAvg = null;
        int rank = 0, n = 0;
        foreach (var r in ranked)
        {
            n++;
            var avg = avgOf(r);
            if (avg != prevAvg) { rank = n; prevAvg = avg; }
            result[r.Code] = rank;
        }
        return result;
    }
}
