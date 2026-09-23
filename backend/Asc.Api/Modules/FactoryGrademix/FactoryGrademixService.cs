using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.FactoryGrademix;

internal sealed class GradeAgg
{
    public decimal OfferedKg, SoldKg, ValueRs;
}

internal sealed class FactoryAgg
{
    public string Code = "";
    public string Name = "";
    public decimal TotalKg, CtcKg;
    public readonly HashSet<string> Marks = new(StringComparer.OrdinalIgnoreCase);
    public readonly Dictionary<string, decimal> KgByElevation = new(StringComparer.OrdinalIgnoreCase);
    public readonly Dictionary<string, GradeAgg> Grades = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>Everything the grademix report needs from one sale file, reduced to a few hundred
/// small rows (per factory x grade, per elevation x grade) so a whole year of sales fits in memory
/// and a factory owner's screen never re-parses a workbook.</summary>
internal sealed class SaleAgg
{
    public int Year, SaleNo;
    public DateTime Date;
    public bool Settled;
    public int Lots;
    public decimal OfferedKg;
    public readonly Dictionary<string, FactoryAgg> Factories = new(StringComparer.OrdinalIgnoreCase);
    public readonly Dictionary<string, Dictionary<string, GradeAgg>> ElevationGrades = new(StringComparer.OrdinalIgnoreCase);
}

internal sealed record SaleRef(Guid Id, int Year, int SaleNo, DateTime Date);

/// <summary>
/// Data behind the Factory Grademix report (Reports > Factory Grademix): one factory's last-sale
/// result in the company's grademix layout, its month-by-month average against the Tea Board's
/// elevation average, and an expected grademix for the next sale — plus a side-by-side comparison
/// of factories the user picks. Reads only the weekly sale files (ICatalogueSource) and the Tea
/// Board monthly averages already imported into Mongo; nothing is stored.
/// </summary>
public class FactoryGrademixService(ICatalogueSource catalogues, MongoContext db, ILogger<FactoryGrademixService> logger)
{
    private const int MaxMonths = 12;
    private const int TrailingSales = 3;
    private const int MaxCompare = 5;
    private static readonly TimeSpan PendingTtl = TimeSpan.FromMinutes(5);

    private static readonly Regex SaleNameRe = new(@"Sale\s+(\d+)\s+-\s+(\d{4})", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex CtcWordRe = new(@"\bCTC\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    // Sale-file elevation code -> the Tea Board's own elevation row name. "M"/blank have no
    // Tea Board equivalent, so those factories fall back to the sale's own lots for a reference.
    private static readonly Dictionary<string, string> ElevationNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["L"] = "LOW", ["WM"] = "WESTERN MEDIUM", ["WH"] = "WESTERN HIGH", ["UH"] = "UVA HIGH", ["UM"] = "UVA MEDIUM",
    };

    private static readonly Dictionary<string, string> ElevationLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["LOW"] = "Low grown", ["WESTERN MEDIUM"] = "Western medium", ["WESTERN HIGH"] = "Western high",
        ["UVA HIGH"] = "Uva high", ["UVA MEDIUM"] = "Uva medium",
    };

    // Settled sales never change (bar rare corrections), so they stay cached for the life of the
    // process; a sale with no results yet is re-read every couple of minutes so it flips to
    // "settled" soon after its results file replaces the catalogue.
    private readonly ConcurrentDictionary<Guid, (DateTime BuiltAt, SaleAgg Agg)> _cache = new();
    private readonly SemaphoreSlim _buildGate = new(1, 1);

    // ---- public API --------------------------------------------------------------------

    public IReadOnlyList<FactoryGrademixSaleDto> ListSales(int take = 20) =>
        ListSaleRefs().Take(take).Select(s => new FactoryGrademixSaleDto(s.Year, s.SaleNo, s.Date)).ToList();

    public async Task<IReadOnlyList<FactoryOptionDto>> SearchFactoriesAsync(string? q, CancellationToken ct)
    {
        var present = await ResolvePresentAsync(null, null, ct);
        if (present is null) return [];
        var term = (q ?? "").Trim();
        return present.Factories.Values
            .Where(f => term.Length == 0
                || f.Code.Contains(term, StringComparison.OrdinalIgnoreCase)
                || f.Name.Contains(term, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(f => f.TotalKg)
            .Take(30)
            .Select(f => new FactoryOptionDto(f.Code, f.Name, ElevationLabelFor(FactoryElevation(f))))
            .ToList();
    }

    public async Task<FactoryGrademixReportDto?> GetReportAsync(string code, int? year, int? saleNo, int months, CancellationToken ct)
    {
        var ctx = await BuildContextAsync(year, saleNo, months, ct);
        if (ctx is null) return null;
        return await BuildReportAsync(ctx, NormalizeFactoryCode(code), ct);
    }

    public async Task<IReadOnlyList<CompareFactoryDto>> CompareAsync(IReadOnlyList<string> codes, int? year, int? saleNo, int months, CancellationToken ct)
    {
        var ctx = await BuildContextAsync(year, saleNo, months, ct);
        if (ctx is null) return [];
        var results = new List<CompareFactoryDto>();
        foreach (var code in codes.Select(NormalizeFactoryCode).Distinct().Take(MaxCompare))
        {
            var report = await BuildReportAsync(ctx, code, ct);
            if (report is null) continue;
            var t = report.Present.Table;
            var groups = t.Leafy.Append(t.SmallLeafy).Append(t.OffGrade)
                .Select(g => new CompareGroupDto(g.Name, g.QtyPct, g.ContriValue)).ToList();
            results.Add(new CompareFactoryDto(
                report.Factory, report.Present.SoldKg, t.FactoryAvgRs, t.NationalAvgRs,
                groups, report.Monthly, report.Upcoming?.Table?.FactoryAvgRs));
        }
        return results;
    }

    // ---- report assembly ---------------------------------------------------------------

    private sealed record Context(
        SaleAgg Present, List<SaleAgg> History, List<SaleAgg> Trailing, SaleAgg? Upcoming,
        Dictionary<(int Y, int M, string Section, string Elev), decimal> TeaBoard, int Months);

    private async Task<Context?> BuildContextAsync(int? year, int? saleNo, int months, CancellationToken ct)
    {
        // 0 means "this sale only" — no monthly trend at all, not even the present sale's own
        // month. BuildMonthly reads ctx.Months (kept at 0) and returns no points for that case;
        // everything below still needs a real window to gather the trailing sales an expected
        // price is built from, so it works off at-least-one-month regardless.
        months = Math.Clamp(months, 0, MaxMonths);
        var present = await ResolvePresentAsync(year, saleNo, ct);
        if (present is null) return null;

        var refs = ListSaleRefs().Where(r => (r.Year, r.SaleNo).CompareTo((present.Year, present.SaleNo)) <= 0).ToList();
        var windowStart = new DateTime(present.Date.Year, present.Date.Month, 1).AddMonths(-(Math.Max(months, 1) - 1));

        var history = new List<SaleAgg>();
        var trailing = new List<SaleAgg>();
        foreach (var r in refs) // newest first
        {
            var inWindow = r.Date >= windowStart;
            if (!inWindow && trailing.Count >= TrailingSales) break;
            var agg = r.SaleNo == present.SaleNo && r.Year == present.Year ? present : await GetAggAsync(r, ct);
            if (!agg.Settled) continue;
            if (inWindow) history.Add(agg);
            if (trailing.Count < TrailingSales) trailing.Add(agg);
        }

        var nextRef = ListSaleRefs()
            .Where(r => (r.Year, r.SaleNo).CompareTo((present.Year, present.SaleNo)) > 0)
            .OrderBy(r => r.Year).ThenBy(r => r.SaleNo)
            .FirstOrDefault();
        var upcoming = nextRef is null ? null : await GetAggAsync(nextRef, ct);
        if (upcoming is { Settled: true }) upcoming = null; // already has results — nothing "upcoming" about it

        var tea = await LoadTeaBoardAsync(windowStart.Year, ct);
        return new Context(present, history, trailing, upcoming, tea, months);
    }

    private Task<FactoryGrademixReportDto?> BuildReportAsync(Context ctx, string code, CancellationToken ct)
    {
        if (!ctx.Present.Factories.TryGetValue(code, out var f)) return Task.FromResult<FactoryGrademixReportDto?>(null);

        var elevCode = FactoryElevation(f);
        var elevName = elevCode is not null && ElevationNames.TryGetValue(elevCode, out var en) ? en : null;
        var section = SectionFor(f);
        var info = new FactoryInfoDto(f.Code, f.Name, elevCode, ElevationLabelFor(elevCode), section, [.. f.Marks.OrderBy(m => m, StringComparer.OrdinalIgnoreCase)]);

        // National average the contribution values are measured against.
        var saleElevAvg = elevCode is not null ? ElevationAvg(ctx.Present, elevCode) : null;
        var national = NationalRef(ctx, section, elevName, saleElevAvg);

        // ---- present sale ----
        var presentInputs = f.Grades
            .Where(g => g.Value.SoldKg > 0)
            .Select(g => new GradeInput(g.Key, g.Value.SoldKg, g.Value.ValueRs / g.Value.SoldKg)).ToList();
        var presentTable = FactoryGrademixEngine.Build(presentInputs, national.AvgRs);
        var offered = f.Grades.Values.Sum(g => g.OfferedKg);
        var sold = f.Grades.Values.Sum(g => g.SoldKg);
        var present = new PresentSaleDto(ToSaleRefDto(ctx.Present), offered, sold, offered - sold, presentTable);

        // ---- monthly ----
        var monthly = BuildMonthly(ctx, code, section, elevName);

        // ---- upcoming ----
        UpcomingSaleDto? upcoming = null;
        if (ctx.Upcoming is { } up)
            upcoming = BuildUpcoming(ctx, up, f, elevCode, elevName, national, presentTable);

        return Task.FromResult<FactoryGrademixReportDto?>(new FactoryGrademixReportDto(info, national, present, monthly, upcoming, DateTime.UtcNow));
    }

    private List<MonthlyPointDto> BuildMonthly(Context ctx, string code, string section, string? elevName)
    {
        if (ctx.Months <= 0) return []; // "this sale only" — caller asked for no monthly trend
        var start = new DateTime(ctx.Present.Date.Year, ctx.Present.Date.Month, 1).AddMonths(-(ctx.Months - 1));
        var points = new List<MonthlyPointDto>();
        for (var i = 0; i < ctx.Months; i++)
        {
            var month = start.AddMonths(i);
            var sales = ctx.History.Where(s => s.Date.Year == month.Year && s.Date.Month == month.Month).ToList();
            decimal kg = 0, value = 0;
            var counted = 0;
            foreach (var s in sales)
            {
                if (!s.Factories.TryGetValue(code, out var fa)) continue;
                var sk = fa.Grades.Values.Sum(g => g.SoldKg);
                if (sk <= 0) continue;
                kg += sk;
                value += fa.Grades.Values.Sum(g => g.ValueRs);
                counted++;
            }
            var tea = elevName is null ? null : TeaAvg(ctx.TeaBoard, section, elevName, month.Year, month.Month);
            points.Add(new MonthlyPointDto(
                month.Year, month.Month, month.ToString("MMM yy", CultureInfo.InvariantCulture), counted, kg,
                kg > 0 ? value / kg : null, tea,
                month.Year == ctx.Present.Date.Year && month.Month == ctx.Present.Date.Month));
        }
        return points;
    }

    private UpcomingSaleDto BuildUpcoming(
        Context ctx, SaleAgg up, FactoryAgg presentFactory, string? elevCode, string? elevName,
        NationalRefDto national, GrademixTableDto presentTable)
    {
        // Expected price per grade = this factory's own sold average for that grade across the
        // trailing settled sales; failing that, the same grade's average across the factory's
        // whole elevation in those sales; failing that, the grade is listed with no price.
        static decimal? Avg(IEnumerable<GradeAgg> aggs)
        {
            decimal k = 0, v = 0;
            foreach (var a in aggs) { k += a.SoldKg; v += a.ValueRs; }
            return k > 0 ? v / k : null;
        }

        GrademixTableDto? table = null;
        decimal catalogueKg = 0;
        if (up.Factories.TryGetValue(presentFactory.Code, out var uf))
        {
            var basis = new Dictionary<string, string>();
            var inputs = new List<GradeInput>();
            foreach (var (grade, agg) in uf.Grades)
            {
                if (agg.OfferedKg <= 0) continue;
                var own = Avg(ctx.Trailing.Select(s => s.Factories.TryGetValue(uf.Code, out var tf) && tf.Grades.TryGetValue(grade, out var g) ? g : null).OfType<GradeAgg>());
                decimal? price = own;
                var key = FactoryGrademixEngine.NormalizeGrade(grade);
                if (own is not null) basis[key] = "factory";
                else if (elevCode is not null)
                {
                    price = Avg(ctx.Trailing.Select(s => s.ElevationGrades.TryGetValue(elevCode, out var eg) && eg.TryGetValue(grade, out var g) ? g : null).OfType<GradeAgg>());
                    basis[key] = price is null ? "none" : "elevation";
                }
                else basis[key] = "none";
                inputs.Add(new GradeInput(grade, agg.OfferedKg, price));
            }

            var offeredTotal = presentFactory.Grades.Values.Sum(g => g.OfferedKg);
            var prev = offeredTotal > 0
                ? presentFactory.Grades
                    .GroupBy(g => FactoryGrademixEngine.NormalizeGrade(g.Key))
                    .ToDictionary(g => g.Key, g => g.Sum(x => x.Value.OfferedKg) / offeredTotal * 100m)
                : new Dictionary<string, decimal>();
            table = FactoryGrademixEngine.Build(inputs, national.AvgRs, prev, basis);
            catalogueKg = inputs.Sum(i => i.Qty);
        }

        // ---- whole-sale outlook: the entire catalogue, by elevation ----
        var elevations = new List<ElevationOutlookDto>();
        var totalKg = up.OfferedKg;
        foreach (var (ec, grades) in up.ElevationGrades.OrderByDescending(e => e.Value.Values.Sum(g => g.OfferedKg)))
        {
            var kg = grades.Values.Sum(g => g.OfferedKg);
            if (kg <= 0) continue;
            var name = ElevationNames.TryGetValue(ec, out var n) ? n : null;
            var expected = Avg(ctx.Trailing.SelectMany(s => s.ElevationGrades.TryGetValue(ec, out var eg) ? (IEnumerable<GradeAgg>)eg.Values : Array.Empty<GradeAgg>()));
            var tea = name is null ? null : TeaAvg(ctx.TeaBoard, "COMBINED", name, ctx.Present.Date.Year, ctx.Present.Date.Month, allowEarlier: true);
            elevations.Add(new ElevationOutlookDto(
                ec, name is not null && ElevationLabels.TryGetValue(name, out var lbl) ? lbl : ec, kg,
                totalKg > 0 ? kg / totalKg * 100m : 0m, expected, tea,
                string.Equals(ec, elevCode, StringComparison.OrdinalIgnoreCase)));
        }
        var whole = new WholeSaleDto(totalKg, up.Lots, up.Factories.Count, elevations, totalKg > 0 ? catalogueKg / totalKg * 100m : 0m);

        var expectedVsPresent = table?.FactoryAvgRs is { } e && presentTable.FactoryAvgRs is { } p ? e - p : (decimal?)null;
        return new UpcomingSaleDto(ToSaleRefDto(up), catalogueKg, table, whole, ctx.Trailing.Select(ToSaleRefDto).ToList(), expectedVsPresent);
    }

    // ---- national reference ------------------------------------------------------------

    private static NationalRefDto NationalRef(Context ctx, string section, string? elevName, decimal? saleElevAvg)
    {
        if (elevName is not null)
        {
            var hit = TeaBoardLatest(ctx.TeaBoard, section, elevName, ctx.Present.Date.Year, ctx.Present.Date.Month);
            if (hit is { } h)
            {
                var stale = h.Year != ctx.Present.Date.Year || h.Month != ctx.Present.Date.Month;
                var month = new DateTime(h.Year, h.Month, 1).ToString("MMM yyyy", CultureInfo.InvariantCulture);
                var sectionLabel = char.ToUpperInvariant(h.Section[0]) + h.Section[1..].ToLowerInvariant();
                return new NationalRefDto(h.Avg, "tea-board", $"Tea Board {month} · {sectionLabel} · {ElevationLabels.GetValueOrDefault(elevName, elevName)}", stale, saleElevAvg);
            }
        }
        if (saleElevAvg is { } sea)
            return new NationalRefDto(sea, "sale-elevation", "This sale's average for the same elevation (no Tea Board figure)", false, saleElevAvg);
        var all = AllLotsAvg(ctx.Present);
        return new NationalRefDto(all, "sale-all", "This sale's average across all lots (no elevation on file)", false, null);
    }

    private static decimal? ElevationAvg(SaleAgg s, string elevCode)
    {
        if (!s.ElevationGrades.TryGetValue(elevCode, out var grades)) return null;
        var kg = grades.Values.Sum(g => g.SoldKg);
        return kg > 0 ? grades.Values.Sum(g => g.ValueRs) / kg : null;
    }

    private static decimal AllLotsAvg(SaleAgg s)
    {
        var kg = s.ElevationGrades.Values.SelectMany(d => d.Values).Sum(g => g.SoldKg);
        return kg > 0 ? s.ElevationGrades.Values.SelectMany(d => d.Values).Sum(g => g.ValueRs) / kg : 0m;
    }

    // ---- Tea Board ---------------------------------------------------------------------

    private async Task<Dictionary<(int, int, string, string), decimal>> LoadTeaBoardAsync(int fromYear, CancellationToken ct)
    {
        var rows = await db.TeaBoardAverages
            .Find(t => t.Year >= fromYear - 1 && t.MonthAvgRs != null)
            .ToListAsync(ct);
        var map = new Dictionary<(int, int, string, string), decimal>();
        foreach (var r in rows)
            map[(r.Year, r.Month, r.Section.ToUpperInvariant(), r.Elevation.ToUpperInvariant())] = r.MonthAvgRs!.Value;
        return map;
    }

    private static decimal? TeaAvg(
        Dictionary<(int Y, int M, string Section, string Elev), decimal> tea, string section, string elev, int y, int m, bool allowEarlier = false)
    {
        if (allowEarlier) return TeaBoardLatest(tea, section, elev, y, m)?.Avg;
        if (tea.TryGetValue((y, m, section, elev), out var v)) return v;
        return tea.TryGetValue((y, m, "COMBINED", elev), out var c) ? c : null;
    }

    /// <summary>The Tea Board figure for this month, else the most recent earlier month
    /// published (looking back up to a year), preferring the factory's own Orthodox/CTC section
    /// and falling back to the combined one.</summary>
    private static (decimal Avg, int Year, int Month, string Section)? TeaBoardLatest(
        Dictionary<(int Y, int M, string Section, string Elev), decimal> tea, string section, string elev, int y, int m)
    {
        var cursor = new DateTime(y, m, 1);
        for (var i = 0; i < 12; i++, cursor = cursor.AddMonths(-1))
        {
            if (tea.TryGetValue((cursor.Year, cursor.Month, section, elev), out var v)) return (v, cursor.Year, cursor.Month, section);
            if (tea.TryGetValue((cursor.Year, cursor.Month, "COMBINED", elev), out var c)) return (c, cursor.Year, cursor.Month, "COMBINED");
        }
        return null;
    }

    // ---- sale files --------------------------------------------------------------------

    private List<SaleRef> ListSaleRefs()
    {
        var list = new List<SaleRef>();
        foreach (var c in catalogues.ListCatalogues())
        {
            var m = SaleNameRe.Match(c.SourceName);
            if (!m.Success) continue;
            list.Add(new SaleRef(c.Id, int.Parse(m.Groups[2].Value), int.Parse(m.Groups[1].Value), c.SaleDateStart ?? c.ImportedAt));
        }
        return [.. list.OrderByDescending(r => r.Year).ThenByDescending(r => r.SaleNo)];
    }

    /// <summary>The sale to report on: the one asked for, else the newest that already has results.</summary>
    private async Task<SaleAgg?> ResolvePresentAsync(int? year, int? saleNo, CancellationToken ct)
    {
        var refs = ListSaleRefs();
        if (year is not null && saleNo is not null)
        {
            var r = refs.FirstOrDefault(x => x.Year == year && x.SaleNo == saleNo);
            if (r is null) return null;
            var agg = await GetAggAsync(r, ct);
            return agg.Settled ? agg : null;
        }
        foreach (var r in refs)
        {
            var agg = await GetAggAsync(r, ct);
            if (agg.Settled) return agg;
        }
        return null;
    }

    private async Task<SaleAgg> GetAggAsync(SaleRef r, CancellationToken ct)
    {
        if (_cache.TryGetValue(r.Id, out var hit) && (hit.Agg.Settled || DateTime.UtcNow - hit.BuiltAt < PendingTtl))
            return hit.Agg;

        await _buildGate.WaitAsync(ct);
        try
        {
            if (_cache.TryGetValue(r.Id, out hit) && (hit.Agg.Settled || DateTime.UtcNow - hit.BuiltAt < PendingTtl))
                return hit.Agg;
            var agg = await Task.Run(() =>
            {
                var lots = catalogues.GetLots(r.Id) ?? [];
                return Aggregate(r.Year, r.SaleNo, r.Date, lots);
            }, ct);
            _cache[r.Id] = (DateTime.UtcNow, agg);
            logger.LogInformation("Factory grademix: aggregated sale {Year}/{SaleNo} ({Lots} lots, settled={Settled}).", r.Year, r.SaleNo, agg.Lots, agg.Settled);
            return agg;
        }
        finally
        {
            _buildGate.Release();
        }
    }

    /// <summary>Reduces one sale's lots to per-factory and per-elevation grade totals. "Sold"
    /// includes Outsold lots (they carry a purchased price and are part of the sale's proceeds);
    /// value is kg x purchased price, which reconciles to the sale file's own Total Value column.
    /// A sale is "settled" once any lot carries a status other than Pending.</summary>
    internal static SaleAgg Aggregate(int year, int saleNo, DateTime date, IEnumerable<Lot> lots)
    {
        var agg = new SaleAgg { Year = year, SaleNo = saleNo, Date = date };
        foreach (var lot in lots)
        {
            var kg = lot.NetWeight ?? 0m;
            if (kg <= 0) continue;
            var raw = !string.IsNullOrWhiteSpace(lot.Factory) ? lot.Factory
                : !string.IsNullOrWhiteSpace(lot.Mark) ? lot.Mark : lot.SellingMark;
            if (string.IsNullOrWhiteSpace(raw)) continue;

            var status = (lot.Status ?? "").Trim();
            var isSold = status.Equals("Sold", StringComparison.OrdinalIgnoreCase) || status.Equals("Outsold", StringComparison.OrdinalIgnoreCase);
            if (status.Length > 0 && !status.Equals("Pending", StringComparison.OrdinalIgnoreCase)) agg.Settled = true;
            var price = lot.PurchasedPrice ?? 0m;
            var sold = isSold && price > 0;

            agg.Lots++;
            agg.OfferedKg += kg;

            var code = NormalizeFactoryCode(raw);
            if (!agg.Factories.TryGetValue(code, out var f))
                agg.Factories[code] = f = new FactoryAgg { Code = code };
            if (f.Name.Length == 0 && !string.IsNullOrWhiteSpace(lot.FactoryName)) f.Name = lot.FactoryName.Trim();
            f.TotalKg += kg;
            if (!string.IsNullOrWhiteSpace(lot.SellingMark))
            {
                f.Marks.Add(lot.SellingMark.Trim());
                if (CtcWordRe.IsMatch(lot.SellingMark)) f.CtcKg += kg;
            }
            var elev = (lot.Elevation ?? "").Trim().ToUpperInvariant();
            if (elev.Length > 0) f.KgByElevation[elev] = f.KgByElevation.GetValueOrDefault(elev) + kg;

            var grade = string.IsNullOrWhiteSpace(lot.Grade) ? "(No grade)" : lot.Grade.Trim();
            AddTo(f.Grades, grade, kg, sold, price);
            if (elev.Length > 0)
            {
                if (!agg.ElevationGrades.TryGetValue(elev, out var eg))
                    agg.ElevationGrades[elev] = eg = new Dictionary<string, GradeAgg>(StringComparer.OrdinalIgnoreCase);
                AddTo(eg, grade, kg, sold, price);
            }
        }
        foreach (var f in agg.Factories.Values)
            if (f.Name.Length == 0) f.Name = f.Marks.FirstOrDefault() ?? f.Code;
        return agg;

        static void AddTo(Dictionary<string, GradeAgg> d, string grade, decimal kg, bool sold, decimal price)
        {
            if (!d.TryGetValue(grade, out var g)) d[grade] = g = new GradeAgg();
            g.OfferedKg += kg;
            if (sold) { g.SoldKg += kg; g.ValueRs += kg * price; }
        }
    }

    // ---- helpers -----------------------------------------------------------------------

    // Same rule the rest of the app uses to treat MF01257 / MF1257 / MF1257A as one factory.
    internal static string NormalizeFactoryCode(string raw)
    {
        var t = raw.Trim().ToUpperInvariant();
        var m = Regex.Match(t, @"^([A-Z]+)0*(\d+)[A-Z]*$");
        return m.Success ? $"{m.Groups[1].Value}{m.Groups[2].Value}" : t;
    }

    private static string? FactoryElevation(FactoryAgg f) =>
        f.KgByElevation.Count == 0 ? null : f.KgByElevation.OrderByDescending(kv => kv.Value).First().Key;

    private static string? ElevationLabelFor(string? code) =>
        code is not null && ElevationNames.TryGetValue(code, out var n) && ElevationLabels.TryGetValue(n, out var l) ? l : code;

    /// <summary>Which Tea Board section (Orthodox/CTC/Combined) suits this factory: by weight of
    /// lots whose selling mark says CTC.</summary>
    private static string SectionFor(FactoryAgg f)
    {
        if (f.TotalKg <= 0) return "COMBINED";
        var share = f.CtcKg / f.TotalKg;
        return share >= 0.9m ? "CTC" : share <= 0.1m ? "ORTHODOX" : "COMBINED";
    }

    private static SaleRefDto ToSaleRefDto(SaleAgg s) => new(s.Year, s.SaleNo, s.Date);
}
