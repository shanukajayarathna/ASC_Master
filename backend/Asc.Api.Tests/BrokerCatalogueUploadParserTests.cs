using Asc.Api.Modules.MarkIntelligence;
using Asc.Api.Services;

namespace Asc.Api.Tests;

public class BrokerCatalogueUploadParserTests
{
    private static List<List<string>> Blank(params List<string>[] dataRows)
    {
        var rows = new List<List<string>> { new() }; // row 0 is always a blank spacer
        rows.AddRange(dataRows);
        return rows;
    }

    private static List<string> Row(params string[] cells) => cells.ToList();

    [Fact]
    public void NormalizeFactoryCode_StripsTrailingLetterAndLeadingZeros()
    {
        // Real Sale 36/2026 case: MB's "MF01257" and LCBL's "MF1257" are the same estate (UPLANDS).
        Assert.Equal("MF1257", BrokerCatalogueUploadParser.NormalizeFactoryCode("MF01257"));
        Assert.Equal("MF1257", BrokerCatalogueUploadParser.NormalizeFactoryCode("MF1257"));
        Assert.Equal("MF1465", BrokerCatalogueUploadParser.NormalizeFactoryCode("MF1465A"));
        Assert.Equal("MF1465", BrokerCatalogueUploadParser.NormalizeFactoryCode("MF1465C"));
    }

    [Fact]
    public void ParseAeb_ReadsRealSample36Row()
    {
        var rows = Blank(Row("EB", "2026", "36A", "1", "MF0034", "STRATHSPEY", "0254R", "BOP", "20", "50", "1000", "1000"));
        var lots = BrokerCatalogueUploadParser.ParseAeb(rows, 36);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Aeb, lot.Broker);
        Assert.Equal("36", lot.SaleNo); // stamped from the caller's target sale, not read off the file
        Assert.Equal("MF34", lot.Factory);
        Assert.Equal("STRATHSPEY", lot.SellingMark);
        Assert.Equal(1000m, lot.NetWeight);
        Assert.False(lot.IsReprint); // 20 * 50 == 1000
    }

    [Fact]
    public void ParseBc_ReadsRealSample36Row()
    {
        var rows = Blank(Row("BC", "2026", "037", "0001", "MF0864A", "AULTMORE CTC", "", "0252", "PF1", "10", "52", "520", "520", "EX", " Ex-estate Basis"));
        var lots = BrokerCatalogueUploadParser.ParseBc(rows, 36);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Bc, lot.Broker);
        Assert.Equal("MF864", lot.Factory);
        Assert.Equal("AULTMORE CTC", lot.SellingMark);
        Assert.Equal(520m, lot.NetWeight);
        Assert.False(lot.IsReprint); // 10 * 52 == 520
    }

    [Fact]
    public void ParseJk_ReadsRealSample36Row_WithNoBrokerColumnInFile()
    {
        var rows = Blank(Row("0001", "MF0548", "KENILWORTH", "", "0353", "RA", "BOPSp", "10", "42", "B", "0", "420"));
        var lots = BrokerCatalogueUploadParser.ParseJk(rows, 36);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Jk, lot.Broker); // broker comes from the caller's tag, not the file
        Assert.Equal("MF548", lot.Factory);
        Assert.Equal("KENILWORTH", lot.SellingMark);
        Assert.Equal(420m, lot.NetWeight);
        Assert.False(lot.IsReprint); // 10 * 42 == 420
    }

    [Fact]
    public void ParseLcbl_SkipsSectionDividerRows()
    {
        // Real shape: a lone "Wt/Chs" spacer row (blank col0, but col0=filler here becomes row0
        // already skipped) plus a lone "EX-ESTATE" divider row with no LotNo, then real data.
        var rows = Blank(
            Row("EX-ESTATE"),
            Row("0001", "MF1257", "UPLANDS", "0346", "BOPF", "20", "B", "55", "SPBS", "0", "1100", "EX-ESTATE"),
            Row("0002", "MF0343", "LABOOKELLIE", "0364R", "BOP", "10", "B", "52", "MWPS", "0", "520", "EX-ESTATE"));
        var lots = BrokerCatalogueUploadParser.ParseLcbl(rows, 36);

        Assert.Equal(2, lots.Count); // the "EX-ESTATE" divider row must not become a lot
        Assert.Equal("MF1257", lots[0].Factory);
        Assert.Equal("UPLANDS", lots[0].SellingMark);
        Assert.Equal(1100m, lots[0].NetWeight);
        Assert.Equal("MF343", lots[1].Factory);
    }

    [Fact]
    public void ParseMb_ReadsRealSample36Row_AndMatchesLcblFactoryAfterNormalization()
    {
        var rows = Blank(Row("MB", "36", "16/09/2026", "1", "MF01257", "UPLANDS", "347", "BOPF", "20", "B", "55", "1100", "EX-ESTATE"));
        var lots = BrokerCatalogueUploadParser.ParseMb(rows, 36);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Mb, lot.Broker); // "MPB", matching MslModels.ExcelCodeToMslCode, not the file's own "MB"
        Assert.Equal("MF1257", lot.Factory); // same estate as the LCBL sample above, despite the zero-padding difference
        Assert.Equal(1100m, lot.NetWeight);
    }

    [Fact]
    public void ParseFw_ReadsRealSample36Row()
    {
        var rows = Blank(Row("FW", "36", "2026-09-16", "1", "MF0007", "WINDSORFOREST", "179", "BOPF", "20", "B", "58", "1160", "1", "EX-ESTATE", "10"));
        var lots = BrokerCatalogueUploadParser.ParseFw(rows, 36);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Fw, lot.Broker);
        Assert.Equal("MF7", lot.Factory);
        Assert.Equal("WINDSORFOREST", lot.SellingMark);
        Assert.Equal(1160m, lot.NetWeight);
    }

    [Fact]
    public void ParseAsc_ReadsRealSample36Row_ViaHeaderRow()
    {
        var rows = new List<List<string>>
        {
            new(), // blank spacer, matches the real file's own leading row
            Row("Broker", "SaleNumber", "SaleYear", "LotNo", "Mark", "SellingMark", "InvoiceNo", "Grade", "NoOfChests", "WeightPerChest", "NettWeight", "GrossWeight", "Category", "StoreDescription"),
            Row("AS", "036", "2026", "0001", "MF0294", "ROBGILL", "0211R", "BOP", "10", "50", "500", "500", "EX-ESTATE", "EX ESTATE"),
        };
        var lots = BrokerCatalogueUploadParser.ParseAsc(new CatalogueImportService(), rows, 36);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Asc, lot.Broker);
        Assert.Equal("MF294", lot.Factory);
        Assert.Equal("ROBGILL", lot.SellingMark);
        Assert.Equal(500m, lot.NetWeight);
        Assert.False(lot.IsReprint);
    }

    [Fact]
    public void ParseCtb_ReadsRealSample36Row_ReprintDetectedFromWeightMismatch()
    {
        // Real sample: 10 chests * 58 kg should be 580, and it is here (not a reprint) —
        // include a second row with a genuine mismatch to prove the heuristic fires.
        var rows = Blank(
            Row("CT036", "16/09/2026", "1", "MF0835", "HARANGALLA", "1191", "BOPF", "10", "B", "58", "RTS", "0", "580", "Warehouse", "EX"),
            Row("CT036", "16/09/2026", "2", "MF0835", "HARANGALLA", "1192", "BOPF", "10", "B", "58", "RTS", "0", "497", "Warehouse", "EX"));
        var lots = BrokerCatalogueUploadParser.ParseCtb(rows, 36);

        Assert.Equal(2, lots.Count);
        Assert.Equal(BrokerCode.Ctb, lots[0].Broker);
        Assert.Equal("MF835", lots[0].Factory);
        Assert.False(lots[0].IsReprint); // 10 * 58 == 580
        Assert.True(lots[1].IsReprint); // 10 * 58 != 497
    }

    // ---- DetectBroker: identifies a zip member's broker from its own content, since
    // filenames vary unpredictably between sales (confirmed live: ASC's own file was
    // "AScat362026xls.xls" for Sale 36 but "cat372026xls.xls" for Sale 37) ------------------

    [Theory]
    [InlineData("AS", BrokerCode.Asc)]
    [InlineData("EB", BrokerCode.Aeb)]
    [InlineData("BC", BrokerCode.Bc)]
    [InlineData("MB", BrokerCode.Mb)]
    [InlineData("FW", BrokerCode.Fw)]
    public void DetectBroker_IdentifiesBySelfReportedBrokerColumn(string brokerColumnValue, string expected)
    {
        // Real Sale 37/2026 case: these 5 brokers' own files carry their broker code as the
        // literal first column of every data row, after a blank spacer row.
        var rows = Blank(Row(brokerColumnValue, "2026", "037", "0001", "MF0294", "ROBGILL", "0211R", "BOP", "10", "50", "500", "500"));
        Assert.Equal(expected, BrokerCatalogueUploadParser.DetectBroker(rows));
    }

    [Theory]
    [InlineData("CT037")]
    [InlineData("CT036")]
    public void DetectBroker_IdentifiesCtb_ByCtPrefixFollowedByDigit(string combinedBrokerSaleNo)
    {
        // CT's file has no blank spacer — real data starts at row 0, and Broker/SaleNo are
        // combined into one column ("CT037"), not their own separate columns.
        var rows = new List<List<string>> { Row(combinedBrokerSaleNo, "23/09/2026", "1", "MF0616A", "DARTRY", "723", "BOPF", "20", "B", "56", "PS", "3", "1114") };
        Assert.Equal(BrokerCode.Ctb, BrokerCatalogueUploadParser.DetectBroker(rows));
    }

    [Fact]
    public void DetectBroker_IdentifiesJk_ByWideRowsStartingWithBareLotNo()
    {
        // JK carries no Broker/Year/SaleNo columns at all — column 0 is just the numeric
        // LotNo. Real Sale 37/2026 rows run 18 columns wide.
        var rows = Blank(Row("0001", "MF0468", "KEW", "", "0333", "RA", "BOP", "20", "48", "B", "0", "960", "960", "H", "EX", "MWPS", "C15", "EX ESTATE"));
        Assert.Equal(BrokerCode.Jk, BrokerCatalogueUploadParser.DetectBroker(rows));
    }

    [Fact]
    public void DetectBroker_IdentifiesLcbl_ByNarrowRowsStartingWithBareLotNo_AfterDividerRows()
    {
        // LCBL also carries no Broker/Year/SaleNo columns (bare LotNo in column 0), but its
        // real Sale 37/2026 rows run only 13 columns wide — narrow enough to tell apart from
        // JK's 18. Real files also open with non-numeric section-divider rows ("Wt/Chs",
        // "EX-ESTATE") before the first real LotNo row, which DetectBroker must scan past.
        var rows = new List<List<string>>
        {
            Row("Wt/Chs"),
            Row("EX-ESTATE"),
            Row("0001", "MF1257", "UPLANDS", "0359", "BOPF", "20", "B", "55", "SPBS", "0", "1100", "EX-ESTATE", "EXESTATE"),
        };
        Assert.Equal(BrokerCode.Lcbl, BrokerCatalogueUploadParser.DetectBroker(rows));
    }

    [Fact]
    public void DetectBroker_ReturnsNull_WhenNothingRecognizable()
    {
        var rows = Blank(Row("SOME OTHER FILE", "not a broker catalogue"));
        Assert.Null(BrokerCatalogueUploadParser.DetectBroker(rows));
    }

    // ---- TryDetectSaleInfo / DetectSaleInfo: most of the 8 files already carry sale
    // year/number/date in their own data, so the user shouldn't have to type it in by hand
    // when a file already says it -----------------------------------------------------------

    private static readonly CatalogueImportService Importer = new();

    [Fact]
    public void TryDetectSaleInfo_Asc_ReadsYearAndSaleNumber_ButNoDate()
    {
        var rows = new List<List<string>>
        {
            new(),
            Row("Broker", "SaleNumber", "SaleYear", "LotNo", "Mark", "SellingMark", "InvoiceNo", "Grade", "NoOfChests", "WeightPerChest", "NettWeight", "GrossWeight", "Category", "StoreDescription"),
            Row("AS", "037", "2026", "0001", "MF0294", "ROBGILL", "0211R", "BOP", "10", "50", "500", "500", "EX-ESTATE", "EX ESTATE"),
        };
        var (year, saleNo, date) = BrokerCatalogueUploadParser.TryDetectSaleInfo(BrokerCode.Asc, Importer, rows);
        Assert.Equal(2026, year);
        Assert.Equal(37, saleNo);
        Assert.Null(date); // ASC's own file carries no date column at all
    }

    [Theory]
    [InlineData(BrokerCode.Aeb)]
    [InlineData(BrokerCode.Bc)]
    public void TryDetectSaleInfo_AebAndBc_ReadYearAndSaleNumber_ButNoDate(string brokerCode)
    {
        var rows = Blank(Row(brokerCode, "2026", "37", "0001", "MF0034", "STRATHSPEY", "0254R", "BOP", "20", "50", "1000", "1000"));
        var (year, saleNo, date) = BrokerCatalogueUploadParser.TryDetectSaleInfo(brokerCode, Importer, rows);
        Assert.Equal(2026, year);
        Assert.Equal(37, saleNo);
        Assert.Null(date);
    }

    [Fact]
    public void TryDetectSaleInfo_Mb_ReadsSaleNumberAndDate_YearDerivedFromDate()
    {
        // MB's own date cell is text in "dd/MM/yyyy" — confirmed live.
        var rows = Blank(Row("MB", "37", "23/09/2026", "1", "BF00020", "WATADENIYA", "3571", "OP1", "10", "B", "30", "300", "LOW GROWN LEAFY"));
        var (year, saleNo, date) = BrokerCatalogueUploadParser.TryDetectSaleInfo(BrokerCode.Mb, Importer, rows);
        Assert.Equal(2026, year);
        Assert.Equal(37, saleNo);
        Assert.Equal(new DateTime(2026, 9, 23), date);
    }

    [Fact]
    public void TryDetectSaleInfo_Fw_ReadsSaleNumberAndDate_FromIsoFormattedDateCell()
    {
        // FW's date cell is a real Excel date — CatalogueImportService.ParseExcel's own
        // date formatting turns that into "yyyy-MM-dd" text before this ever sees it.
        var rows = Blank(Row("FW", "37", "2026-09-23", "1", "MF0007", "WINDSORFOREST", "183", "BOPF", "10", "B", "58", "580", "1", "EX-ESTATE", "10"));
        var (year, saleNo, date) = BrokerCatalogueUploadParser.TryDetectSaleInfo(BrokerCode.Fw, Importer, rows);
        Assert.Equal(2026, year);
        Assert.Equal(37, saleNo);
        Assert.Equal(new DateTime(2026, 9, 23), date);
    }

    [Fact]
    public void TryDetectSaleInfo_Ctb_ReadsSaleNumberFromCombinedColumn_AndDate()
    {
        var rows = new List<List<string>> { Row("CT037", "23/09/2026", "1", "MF0616A", "DARTRY", "723", "BOPF", "20", "B", "56", "PS", "3", "1114") };
        var (year, saleNo, date) = BrokerCatalogueUploadParser.TryDetectSaleInfo(BrokerCode.Ctb, Importer, rows);
        Assert.Equal(2026, year);
        Assert.Equal(37, saleNo);
        Assert.Equal(new DateTime(2026, 9, 23), date);
    }

    [Theory]
    [InlineData(BrokerCode.Jk)]
    [InlineData(BrokerCode.Lcbl)]
    public void TryDetectSaleInfo_JkAndLcbl_FindNothing_NoSaleColumnsAtAll(string brokerCode)
    {
        var rows = Blank(Row("0001", "MF0468", "KEW", "", "0333", "RA", "BOP", "20", "48", "B", "0", "960", "960"));
        var (year, saleNo, date) = BrokerCatalogueUploadParser.TryDetectSaleInfo(brokerCode, Importer, rows);
        Assert.Null(year);
        Assert.Null(saleNo);
        Assert.Null(date);
    }

    [Fact]
    public void DetectSaleInfo_CombinesSeveralFiles_PrefersTheOneWithADate()
    {
        var rowsByBroker = new Dictionary<string, List<List<string>>>
        {
            [BrokerCode.Asc] = new List<List<string>>
            {
                new(),
                Row("Broker", "SaleNumber", "SaleYear", "LotNo", "Mark", "SellingMark", "InvoiceNo", "Grade", "NoOfChests", "WeightPerChest", "NettWeight", "GrossWeight", "Category", "StoreDescription"),
                Row("AS", "037", "2026", "0001", "MF0294", "ROBGILL", "0211R", "BOP", "10", "50", "500", "500", "EX-ESTATE", "EX ESTATE"),
            },
            [BrokerCode.Fw] = Blank(Row("FW", "37", "2026-09-23", "1", "MF0007", "WINDSORFOREST", "183", "BOPF", "10", "B", "58", "580", "1", "EX-ESTATE", "10")),
        };

        var (year, saleNo, date, warnings) = BrokerCatalogueUploadParser.DetectSaleInfo(rowsByBroker, Importer);

        Assert.Equal(2026, year);
        Assert.Equal(37, saleNo);
        Assert.Equal(new DateTime(2026, 9, 23), date);
        Assert.Empty(warnings);
    }

    [Fact]
    public void DetectSaleInfo_WarnsWhenFilesDisagree_RatherThanSilentlyPickingOne()
    {
        var rowsByBroker = new Dictionary<string, List<List<string>>>
        {
            [BrokerCode.Aeb] = Blank(Row("EB", "2026", "37", "0001", "MF0034", "STRATHSPEY", "0254R", "BOP", "20", "50", "1000", "1000")),
            [BrokerCode.Bc] = Blank(Row("BC", "2026", "38", "0001", "MF0034", "STRATHSPEY", "0254R", "BOP", "20", "50", "1000", "1000")), // disagrees on sale number
        };

        var (_, _, _, warnings) = BrokerCatalogueUploadParser.DetectSaleInfo(rowsByBroker, Importer);

        Assert.Single(warnings);
        Assert.Contains("sale number", warnings[0]);
    }

    [Fact]
    public void DetectSaleInfo_ReturnsAllNulls_WhenOnlyJkAndLcblAreOnHand()
    {
        // A live guess made while the user has only picked JK/LCBL so far (neither carries
        // sale info) must not error — just report nothing found yet.
        var rowsByBroker = new Dictionary<string, List<List<string>>>
        {
            [BrokerCode.Jk] = Blank(Row("0001", "MF0468", "KEW", "", "0333", "RA", "BOP", "20", "48", "B", "0", "960", "960")),
        };

        var (year, saleNo, date, warnings) = BrokerCatalogueUploadParser.DetectSaleInfo(rowsByBroker, Importer);

        Assert.Null(year);
        Assert.Null(saleNo);
        Assert.Null(date);
        Assert.Empty(warnings);
    }
}
