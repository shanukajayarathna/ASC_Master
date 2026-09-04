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
        // real recorded zero.
        var calendar = new List<(int SaleNo, DateTime Date)> { (36, new DateTime(2026, 9, 16)), (37, new DateTime(2026, 9, 23)) };
        var row = Row("MF0001", "TEST ESTATE", "Low Grown", asc36: 0, asc37: 0);
        var result = new SharedMarkCatalogueResult(2026, 36, new DateTime(2026, 9, 16), calendar, [row], []);

        var bytes = SharedMarkCatalogueWorkbookBuilder.BuildBucket(result, "Low Grown", [row]);
        using var wb = new XSSFWorkbook(new MemoryStream(bytes));
        var ws = wb.GetSheetAt(0);

        // Row 3 = estate name, row 4 = first (ASC) broker row. Col 1 = week 36, col 2 = week 37.
        var ascRow = ws.GetRow(4);
        var week36Cell = ascRow.GetCell(1);
        var week37Cell = ascRow.GetCell(2);

        Assert.Equal(0d, week36Cell.NumericCellValue);
        Assert.Equal(FillPattern.SolidForeground, week36Cell.CellStyle.FillPattern);

        Assert.Equal(CellType.Blank, week37Cell.CellType);
        Assert.NotEqual(FillPattern.SolidForeground, week37Cell.CellStyle.FillPattern);
    }
}
