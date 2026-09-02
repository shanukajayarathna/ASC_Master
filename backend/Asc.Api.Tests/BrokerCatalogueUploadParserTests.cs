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
        var lots = BrokerCatalogueUploadParser.ParseAeb(rows);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Aeb, lot.Broker);
        Assert.Equal("MF34", lot.Factory);
        Assert.Equal("STRATHSPEY", lot.SellingMark);
        Assert.Equal(1000m, lot.NetWeight);
        Assert.False(lot.IsReprint); // 20 * 50 == 1000
    }

    [Fact]
    public void ParseBc_ReadsRealSample36Row()
    {
        var rows = Blank(Row("BC", "2026", "037", "0001", "MF0864A", "AULTMORE CTC", "", "0252", "PF1", "10", "52", "520", "520", "EX", " Ex-estate Basis"));
        var lots = BrokerCatalogueUploadParser.ParseBc(rows);

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
        var lots = BrokerCatalogueUploadParser.ParseJk(rows);

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
        var lots = BrokerCatalogueUploadParser.ParseLcbl(rows);

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
        var lots = BrokerCatalogueUploadParser.ParseMb(rows);

        var lot = Assert.Single(lots);
        Assert.Equal(BrokerCode.Mb, lot.Broker); // "MPB", matching MslModels.ExcelCodeToMslCode, not the file's own "MB"
        Assert.Equal("MF1257", lot.Factory); // same estate as the LCBL sample above, despite the zero-padding difference
        Assert.Equal(1100m, lot.NetWeight);
    }

    [Fact]
    public void ParseFw_ReadsRealSample36Row()
    {
        var rows = Blank(Row("FW", "36", "2026-09-16", "1", "MF0007", "WINDSORFOREST", "179", "BOPF", "20", "B", "58", "1160", "1", "EX-ESTATE", "10"));
        var lots = BrokerCatalogueUploadParser.ParseFw(rows);

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
        var lots = BrokerCatalogueUploadParser.ParseAsc(new CatalogueImportService(), rows);

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
        var lots = BrokerCatalogueUploadParser.ParseCtb(rows);

        Assert.Equal(2, lots.Count);
        Assert.Equal(BrokerCode.Ctb, lots[0].Broker);
        Assert.Equal("MF835", lots[0].Factory);
        Assert.False(lots[0].IsReprint); // 10 * 58 == 580
        Assert.True(lots[1].IsReprint); // 10 * 58 != 497
    }
}
