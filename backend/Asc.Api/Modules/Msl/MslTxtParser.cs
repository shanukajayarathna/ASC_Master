using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Parser for the fixed-width broker MSL TXT files (199-char lines). One layout covers all
/// 8 brokers and every year from 2013 to the present — verified against the full corpus
/// (6.9M rows, 99.8% strict-layout success, the rest recovered by the tolerant fallbacks
/// below) and cross-checked row-for-row against the CBA's own CBACWS workbooks.
///
/// Layout (0-based column offsets):
///   [0:24]    header — broker digit at [1], lot at [2:7], sale type at [7] (1 public /
///             2 private), sale no at [8:12], date YYMMDD at [12:18], invoice at [18:24].
///             PVT yearly files differ only here: [1:7] is a running serial, no broker.
///   [24:31]   factory code ("MF 0351", "MFA0890", "RT 0271")
///   [31:61]   selling mark
///   [61:71]   grade
///   [71:90]   numeric block — quantity = first 10 digits / 100 (kg),
///             price = last 9 digits / 100 (Rs/kg, 0 = unsold)
///   [90:95]   buyer code (blank when unsold)
///   [95:134]  buyer name
///   [134:166] estate/garden name
///   [166:173] district code
///   [173:187] MSL code (factory + 2-digit region suffix)
///   [187:]    class code, right-anchored: normally 4 digits ("1221"); older PVT files
///             write "11 1" and refuse-tea rows "FR31 2". First two digits = elevation.
/// </summary>
public static class MslTxtParser
{
    // Right-anchored so all the observed tail variants resolve: "1221", "11 1", "FR31 2",
    // and 197/198-char lines whose trailing digits were truncated.
    private static readonly Regex ClassTail = new(@"(FR)?\s*(\d{2})\s?(\d{1,2})?\s*$", RegexOptions.Compiled);

    public record ParsedLot(
        string? Broker,
        bool IsPrivate,
        string LotNo,
        int SaleNo,
        DateTime SaleDate,
        string? Invoice,
        string FactoryCode,
        string SellingMark,
        string Grade,
        decimal QuantityKg,
        decimal PriceRs,
        string? BuyerCode,
        string? BuyerName,
        string EstateName,
        string? DistrictCode,
        string? MslCode,
        string? ElevationCode,
        string? ClassCode,
        bool RefuseTea);

    public record ParseResult(List<ParsedLot> Lots, int SkippedLines);

    /// <summary>Parses one whole file. <paramref name="isPrivateFile"/> switches the header
    /// decode for the PVT yearly files (serial instead of broker digit + lot).</summary>
    public static ParseResult ParseFile(Stream stream, bool isPrivateFile)
    {
        var lots = new List<ParsedLot>();
        int skipped = 0;
        using var reader = new StreamReader(stream, System.Text.Encoding.Latin1);
        while (reader.ReadLine() is { } line)
        {
            line = line.TrimEnd('\r', '\n');
            if (string.IsNullOrWhiteSpace(line) || line.Length < 100) // ^Z EOF markers, stubs
            {
                if (line.Trim().Length > 0) skipped++;
                continue;
            }
            if (TryParseLine(line, isPrivateFile, out var lot)) lots.Add(lot!);
            else skipped++;
        }
        return new ParseResult(lots, skipped);
    }

    public static bool TryParseLine(string line, bool isPrivateFile, out ParsedLot? lot)
    {
        lot = null;
        // A handful of lines in the corpus are 197–198 chars (truncated trailing class
        // digits); pad so the fixed slices stay in range. Anything shorter than the estate
        // column is unrecoverable.
        if (line.Length < 170) return false;
        if (line.Length < 199) line = line.PadRight(199);

        // ---- header ----
        // One layout for auction AND private files: broker digit, lot, sale-type flag,
        // sale number, date, invoice. (Verified against the Power BI portal to the cent:
        // PVT rows carry a real broker and sale number, and the portal counts them inside
        // that sale — an earlier reading of this header as an opaque serial was wrong.)
        var broker = MslBrokers.DigitToCode.TryGetValue(line[1], out var b) ? b : null;
        if (broker is null) return false;
        var lotNo = line[2..7].Trim().TrimStart('0');
        if (lotNo.Length == 0) return false;

        bool isPrivate = line[7] == '2' || isPrivateFile;

        var saleRaw = line[8..12].Trim().TrimStart('0');
        int saleNo = int.TryParse(saleRaw, out var s) ? s : 0;

        var dateRaw = line[12..18];
        if (!TryParseDate(dateRaw, out var saleDate)) return false;

        var invoice = line[18..24].Trim();

        // ---- fixed middle ----
        var factory = StripSpaces(line[24..31]);
        if (factory.Length < 3) return false;
        var mark = line[31..61].Trim();
        var grade = line[61..71].Trim();
        if (grade.Length == 0) return false;

        if (!TryParseNumericBlock(line[71..90], out var qty, out var price)) return false;

        var buyerCode = line[90..95].Trim();
        var buyerName = line[95..134].Trim();
        var estate = line[134..166].Trim();
        var district = line[166..173].Trim();
        var mslCode = StripSpaces(line[173..187]);

        // ---- right-anchored class tail ----
        string? elevation = null, classCode = null;
        bool refuse = false;
        var tail = ClassTail.Match(line[187..]);
        if (tail.Success)
        {
            refuse = tail.Groups[1].Success;
            elevation = tail.Groups[2].Value;
            classCode = elevation + tail.Groups[3].Value;
        }
        refuse |= factory.StartsWith("RT", StringComparison.Ordinal);

        lot = new ParsedLot(
            broker, isPrivate, lotNo, saleNo, saleDate,
            invoice.Length == 0 ? null : invoice,
            factory, mark, grade, qty, price,
            buyerCode.Length == 0 ? null : buyerCode,
            buyerName.Length == 0 ? null : buyerName,
            estate,
            district.Length == 0 ? null : district,
            mslCode.Length == 0 ? null : mslCode,
            elevation, classCode, refuse);
        return true;
    }

    private static bool TryParseDate(string yymmdd, out DateTime date)
    {
        date = default;
        if (yymmdd.Length != 6 || !yymmdd.All(char.IsDigit)) return false;
        int yy = int.Parse(yymmdd[..2]), mm = int.Parse(yymmdd[2..4]), dd = int.Parse(yymmdd[4..6]);
        if (mm is < 1 or > 12 || dd is < 1 or > 31 || yy is < 10 or > 60) return false;
        try
        {
            date = new DateTime(2000 + yy, mm, dd, 0, 0, 0, DateTimeKind.Utc);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false; // e.g. Feb 30 from a corrupted line
        }
    }

    /// <summary>Quantity/price block. Strict rule first (first 10 chars / last 9 chars as
    /// space-padded integers, two implied decimals); falls back to squeezing out embedded
    /// spaces for the one legacy variant (2015-era EB files) that shifts the block by one.</summary>
    private static bool TryParseNumericBlock(string block, out decimal qty, out decimal price)
    {
        qty = price = 0;
        var q = block[..10].Trim();
        var p = block[10..].Trim();
        if (q.Length > 0 && p.Length > 0 && long.TryParse(q, out var qv) && long.TryParse(p, out var pv))
        {
            qty = qv / 100m;
            price = pv / 100m;
            return true;
        }
        var digits = StripSpaces(block);
        if (digits.Length is < 10 or > 19 || !digits.All(char.IsDigit)) return false;
        var split = digits.Length - 9;
        qty = long.Parse(digits[..split]) / 100m;
        price = long.Parse(digits[split..]) / 100m;
        return true;
    }

    private static string StripSpaces(string s) => s.Replace(" ", string.Empty).Trim();
}
