using Asc.Api.Modules.Msl;
using Xunit;

namespace Asc.Api.Tests;

/// <summary>
/// Every sample line below is a real row from the MSL corpus (data/msl), one per broker
/// layout family plus the known legacy variants — the exact lines the corpus study
/// validated against the CBA's own CBACWS workbooks.
/// </summary>
public class MslTxtParserTests
{
    private const string AsLine2020 =
        " 8    11   1200107 474R MF 0351VELLAIOYA                     BOP          0099700 00045000M94  MABROC TEAS (PVT) LT                   VELLAI OYA                      0028   MF 035111             2221";

    private const string BtlLine2022 =
        " 100067100052202010714  MF 0391GONAPITIYA                    BOPF           90000    48000H64  HERITAGE TEAS PVT. LTD.                GONAPITIYA                      0020   MF 039125             1111";

    private const string JkLine2020 =
        " 40000110001200107000625MF 0548KENILWORTH                    BOP       0000100000000081000A41  AKBAR BROTHERS LTD.                    KENILWORTH                      0028   MF 054837             2221";

    private const string UnsoldLine =
        " 8    11   1250108 587R MF 1003SHANNON                       BOP          0100000000000000                                            SHANNON                         2000   MF 100312             1221";

    private const string Line2013 =
        " 8    11  51131230 0429 MF 0387TYMAWR                        BOPF         0115700  0041500                                            TYMAWR                          0001   MFA038733             1221";

    private const string PvtLine2026 =
        " 103450200012601020334R MFA0545EAST FASSIFERN                GTOPA2         90000   135000I11  IMPERIAL TEA EXPORTS PVT LTD           AGARAKANDE                      2000   MFE054501             1221";

    [Fact]
    public void Parses_spaced_layout_AS()
    {
        Assert.True(MslTxtParser.TryParseLine(AsLine2020, false, out var lot));
        Assert.Equal("AS", lot!.Broker);
        Assert.Equal("1", lot.LotNo);
        Assert.Equal(1, lot.SaleNo);
        Assert.Equal(new DateTime(2020, 1, 7), lot.SaleDate.Date);
        Assert.Equal("474R", lot.Invoice);
        Assert.Equal("MF0351", lot.FactoryCode);
        Assert.Equal("VELLAIOYA", lot.SellingMark);
        Assert.Equal("BOP", lot.Grade);
        Assert.Equal(997.00m, lot.QuantityKg);
        Assert.Equal(450.00m, lot.PriceRs);
        Assert.Equal("M94", lot.BuyerCode);
        Assert.Equal("VELLAI OYA", lot.EstateName);
        Assert.Equal("MF035111", lot.MslCode);
        Assert.Equal("22", lot.ElevationCode); // WESTERN MEDIUM
        Assert.False(lot.IsPrivate);
    }

    [Fact]
    public void Parses_spaced_layout_BTL_matching_CBACWS_reference_row()
    {
        // CBACWS for sale 05 2022 lists this exact lot: BARTLEET lot 67, inv 714,
        // GONAPITIYA BOPF, 900 kg at Rs 480, buyer H64, elevation 11 (UVA HIGH).
        Assert.True(MslTxtParser.TryParseLine(BtlLine2022, false, out var lot));
        Assert.Equal("BTL", lot!.Broker);
        Assert.Equal("67", lot.LotNo);
        Assert.Equal(5, lot.SaleNo);
        Assert.Equal(new DateTime(2022, 2, 1), lot.SaleDate.Date);
        Assert.Equal(900.00m, lot.QuantityKg);
        Assert.Equal(480.00m, lot.PriceRs);
        Assert.Equal("H64", lot.BuyerCode);
        Assert.Equal("11", lot.ElevationCode);
    }

    [Fact]
    public void Parses_zero_padded_layout_JK()
    {
        Assert.True(MslTxtParser.TryParseLine(JkLine2020, false, out var lot));
        Assert.Equal("JK", lot!.Broker);
        Assert.Equal("1", lot.LotNo);
        Assert.Equal(1000.00m, lot.QuantityKg);
        Assert.Equal(810.00m, lot.PriceRs);
        Assert.Equal("A41", lot.BuyerCode);
    }

    [Fact]
    public void Unsold_lot_has_zero_price_and_no_buyer()
    {
        Assert.True(MslTxtParser.TryParseLine(UnsoldLine, false, out var lot));
        Assert.Equal(0m, lot!.PriceRs);
        Assert.Null(lot.BuyerCode);
        Assert.Null(lot.BuyerName);
        Assert.Equal(1000.00m, lot.QuantityKg);
    }

    [Fact]
    public void Parses_2013_era_line()
    {
        Assert.True(MslTxtParser.TryParseLine(Line2013, false, out var lot));
        Assert.Equal(51, lot!.SaleNo);
        Assert.Equal(new DateTime(2013, 12, 30), lot.SaleDate.Date);
        Assert.Equal(1157.00m, lot.QuantityKg);
        Assert.Equal(415.00m, lot.PriceRs);
    }

    [Fact]
    public void Parses_private_sale_file_line()
    {
        // PVT rows use the same header as auction rows — broker digit, lot, sale no.
        // Verified against the Power BI portal: sale-scoped totals only reconcile to the
        // cent when private rows join their real sale under their real broker.
        Assert.True(MslTxtParser.TryParseLine(PvtLine2026, true, out var lot));
        Assert.True(lot!.IsPrivate);
        Assert.Equal("BTL", lot.Broker);
        Assert.Equal("3450", lot.LotNo);
        Assert.Equal(1, lot.SaleNo);
        Assert.Equal(new DateTime(2026, 1, 2), lot.SaleDate.Date);
        Assert.Equal("GTOPA2", lot.Grade);
        Assert.Equal(900.00m, lot.QuantityKg);
        Assert.Equal(1350.00m, lot.PriceRs);
    }

    [Fact]
    public void Old_pvt_class_variant_with_space_still_yields_elevation()
    {
        // Older PVT files write the trailing class as "11 1" instead of "1111".
        var line = PvtLine2026[..193] + "  11 1";
        Assert.True(MslTxtParser.TryParseLine(line, true, out var lot));
        Assert.Equal("11", lot!.ElevationCode);
    }

    [Fact]
    public void Refuse_tea_FR_class_flag_is_detected()
    {
        var line = PvtLine2026[..191] + "  FR31 2";
        Assert.True(MslTxtParser.TryParseLine(line, true, out var lot));
        Assert.True(lot!.RefuseTea);
        Assert.Equal("31", lot.ElevationCode);
    }

    [Fact]
    public void Truncated_197_char_line_is_recovered()
    {
        Assert.True(MslTxtParser.TryParseLine(AsLine2020[..197], false, out var lot));
        Assert.Equal(997.00m, lot!.QuantityKg);
    }

    [Fact]
    public void Legacy_EB_shifted_numeric_block_is_recovered()
    {
        // 2015-era eb4.txt shifts the numeric block by one, leaving an embedded space.
        var line = JkLine2020[..61] + "BOP       000 096000000076000" + JkLine2020[90..];
        Assert.True(MslTxtParser.TryParseLine(line, false, out var lot));
        Assert.Equal(960.00m, lot!.QuantityKg);
        Assert.Equal(760.00m, lot.PriceRs);
    }

    [Fact]
    public void Eof_control_lines_are_skipped_not_fatal()
    {
        using var ms = new MemoryStream(System.Text.Encoding.Latin1.GetBytes(AsLine2020 + "\r\n\x1a"));
        var result = MslTxtParser.ParseFile(ms, false);
        Assert.Single(result.Lots);
    }
}
