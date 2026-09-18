using Asc.Api.Modules.MarkIntelligence;
using NPOI.SS.UserModel;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Tests;

public class SharedMarkCatalogueWorkbookBuilderTests
{
    private static SharedMarkCatalogueRow Row(string code, string name, string bucket, decimal asc36, decimal asc37) =>
        new(
            EstateName: name,
            Code: code,
            ElevationBucket: bucket,
            SaleQtyByBrokerAndSaleNo: new Dictionary<string, IReadOnlyDictionary<int, decimal>>
            {
                ["ASC"] = new Dictionary<int, decimal> { [36] = asc36, [37] = asc37 },
            },
            MonthQtyByBroker: new Dictionary<string, decimal> { ["ASC"] = asc36 + asc37, ["JK"] = 500 },
            YearQtyByBroker: new Dictionary<string, decimal> { ["ASC"] = asc36 + asc37, ["JK"] = 500 });

    [Fact]
    public void FutureWeek_IsLeftBlank_PastWeekWithZero_ShowsRedZero()
    {
        // Sale 36 is the target/current sale (result.SaleNo = 36): week 36 has really
        // happened with a genuine recorded zero for ASC (should show "0" on red), while
        // week 37 hasn't happened yet at all (should be genuinely blank — not "0", no red)
        // per explicit instruction: a future week has nothing to report, distinct from a
        // real recorded zero. MonthCalendar is passed already in the report's own display
        // order (target sale first — see SharedMarkCatalogueService.BuildMonthCalendar's own
        // doc comment); the workbook builder no longer reorders it itself.
        var calendar = new List<(int SaleNo, DateTime Date)> { (36, new DateTime(2026, 9, 16)), (37, new DateTime(2026, 9, 23)) };
        var row = Row("MF0001", "TEST ESTATE", "Low Grown", asc36: 0, asc37: 0);
        var result = new SharedMarkCatalogueResult(2026, 36, new DateTime(2026, 9, 16), calendar, [row], []);

        var bytes = SharedMarkCatalogueWorkbookBuilder.BuildBucket(result, "Low Grown", [row]);
        using var wb = new XSSFWorkbook(new MemoryStream(bytes));
        var ws = wb.GetSheetAt(0);

        // Row 3 = estate name, row 4 = first (ASC) broker row. Target-first order: col 1 =
        // week 36 (the target), col 2 = week 37 (the later, not-yet-happened sale).
        var ascRow = ws.GetRow(4);
        var week36Cell = ascRow.GetCell(1);
        var week37Cell = ascRow.GetCell(2);

        Assert.Equal(0d, week36Cell.NumericCellValue);
        Assert.Equal(FillPattern.SolidForeground, week36Cell.CellStyle.FillPattern);

        Assert.Equal(CellType.Blank, week37Cell.CellType);
        Assert.NotEqual(FillPattern.SolidForeground, week37Cell.CellStyle.FillPattern);
    }

    [Theory]
    [InlineData("BOSCOMBE", 1)]
    [InlineData("Diggala Enterprises Tea Processing Center", 2)] // real Sale 39/2026 case — 42 chars
    [InlineData("Polkollagollawatta Tea Processing Center", 2)] // real Sale 38/2026 case — 41 chars
    public void EstimateWrappedLines_MatchesRealNamesFoundLive(string name, int expectedLines)
    {
        // Found live converting a real Sale 39/2026 PDF through LibreOffice headless: WrapText
        // alone doesn't grow a row's height there the way Excel does when opened interactively,
        // so Diggala's own wrapped second line rendered on top of the row above it. The name
        // row's height now has to be set explicitly from this estimate — this pins the two
        // real names that exposed the bug to the line count that actually avoids it.
        Assert.Equal(expectedLines, SharedMarkCatalogueWorkbookBuilder.EstimateWrappedLines(name));
    }

    [Fact]
    public void LongEstateName_GetsATallerRow_ThanAShortOne()
    {
        var shortRow = Row("MF0001", "BOSCOMBE", "Low Grown", asc36: 100, asc37: 0);
        var longRow = Row("MF0002", "Diggala Enterprises Tea Processing Center", "Low Grown", asc36: 100, asc37: 0);
        var calendar = new List<(int SaleNo, DateTime Date)> { (36, new DateTime(2026, 9, 16)) };
        var result = new SharedMarkCatalogueResult(2026, 36, new DateTime(2026, 9, 16), calendar, [shortRow, longRow], []);

        var bytes = SharedMarkCatalogueWorkbookBuilder.BuildBucket(result, "Low Grown", [shortRow, longRow]);
        using var wb = new XSSFWorkbook(new MemoryStream(bytes));
        var ws = wb.GetSheetAt(0);

        // Row 3 = short name's header; Row() stamps both ASC and JK into MonthQtyByBroker, so
        // each estate's block is 3 rows (name + ASC + JK) — long name's header lands at row 6.
        var shortNameRow = ws.GetRow(3);
        var longNameRow = ws.GetRow(6);

        Assert.True(longNameRow.HeightInPoints > shortNameRow.HeightInPoints);
    }
}
