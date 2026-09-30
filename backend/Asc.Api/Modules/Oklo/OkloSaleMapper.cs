using System.Globalization;

namespace Asc.Api.Modules.Oklo;

/// <summary>
/// Turns OKLO general-report lots into the exact column layout of the "General Report" Excel
/// export the app has always been fed (see data/sales/*.xlsx) — so SaleFileStore, the importer,
/// every report and every stored valuation keep working unchanged; only where the rows come
/// from changes. Column order and the two-row header (blank top-row cells for the buyer
/// sub-columns, named on the second row) are reproduced verbatim: the importer names those
/// blank headers "Column 23" etc. and reads by position-independent header names, but keeping
/// the shape identical means old and API-built files parse to the same table.
///
/// Verified field-by-field against sale 37/2026's real file (10,269 lots, all 27 comparable
/// columns identical; remaining differences are lots sold after that file was downloaded).
/// A trailing "Auction Item Id" column carries OKLO's own lot key — SaleFileStore uses it as
/// the lot's stable identity so a live refresh that changes a lot's price or status can't
/// orphan a stored valuation (the legacy row-content hash would change with every edit).
/// </summary>
public static class OkloSaleMapper
{
    private static readonly System.Text.RegularExpressions.Regex SaleNoRegex = new(@"^\D*(\d{1,3})$", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>The (year, sale number) a catalogue maps to, or null for OKLO's mock/test
    /// catalogues ("Sale 35-SEP13", "Sale 28 T2") and anything before <paramref name="firstYear"/>.
    /// Year is the auction date's year — sale numbers restart each January.</summary>
    public static (int Year, int SaleNo)? Identify(OkloCatalog c, int firstYear)
    {
        if (c.AuctionDate is not { } date || date.Year < firstYear) return null;
        var m = SaleNoRegex.Match((c.SaleNumber ?? "").Trim());
        if (!m.Success || !int.TryParse(m.Groups[1].Value, out var no) || no <= 0) return null;
        return (date.Year, no);
    }

    /// <summary>The column names the importer gives this layout once it has read the top header
    /// row: blank cells become "Column N" (1-based position) — identical to what SaleFileStore
    /// sees when it parses an API-built or hand-downloaded workbook.</summary>
    public static IReadOnlyList<string> ImporterHeaders => _importerHeaders ??=
        TopHeaders.Select((h, i) => string.IsNullOrWhiteSpace(h) ? $"Column {i + 1}" : h.Trim()).ToArray();

    // Lazy on purpose: static fields initialise in textual order, and this one depends on TopHeaders below.
    private static IReadOnlyList<string>? _importerHeaders;

    /// <summary>OKLO lots as the parsed table SaleFileStore.BuildSale expects — no workbook involved.</summary>
    public static Asc.Api.Services.ParsedCatalogue ToParsed(IEnumerable<OkloLot> lots)
    {
        var headers = ImporterHeaders;
        var parsed = new Asc.Api.Services.ParsedCatalogue { Headers = headers.ToList() };
        foreach (var lot in lots)
        {
            var values = MapRow(lot);
            var row = new Dictionary<string, string>(headers.Count);
            for (var i = 0; i < headers.Count; i++) row[headers[i]] = values[i];
            parsed.Rows.Add(row);
        }
        return parsed;
    }

    /// <summary>Header name for the OKLO lot key column — read by SaleFileStore.</summary>
    public const string AuctionItemIdHeader = Asc.Api.Services.SaleFileStore.AuctionItemIdHeader;

    // (top-row header, second-row sub-header). Blank top-row cells are intentional.
    private static readonly (string Top, string Sub)[] Columns =
    [
        ("Broker", ""), ("Lot No", ""), ("Selling Mark", ""), ("Grade", ""), ("Invoice No", ""),
        ("Sub Elevation", ""), ("Sale Code", ""), ("Category", ""), ("RP", ""), ("RA", ""),
        ("Certifications", ""), ("Trade Mark", ""), ("Bags", ""), ("Net Weight", ""), ("Total Weight", ""),
        ("Standard/Adjective", ""), ("Remarks", ""), ("Liquor Remarks", ""), ("Valuation", ""),
        ("Asking Price", "Amount"), ("Baseline Price", ""), ("Registered Bid", "Amount"),
        ("", "Buyer Code"), ("", "Buyer Company"), ("", "Buyer User"),
        ("Second Highest Bid", "Amount"), ("", "Buyer Code"), ("", "Buyer Company"), ("", "Buyer User"),
        ("Total Price", ""), ("Status", ""), ("Purchased Price", ""), ("Buyer", ""), ("Buyer Name", ""),
        ("Buyer User Name", ""), ("Factory Name", ""), ("Factory", ""), ("Producer Country", ""),
        ("Warehouse company", ""), ("Warehouse location", ""), ("Manufactured Date", ""),
        ("Outlot Setting Type", ""), ("Selling End Time", ""), ("Producer", ""), ("Final Buyer", "Buyer Company Name"),
        ("", "Buyer Code"), ("", "Buyer Company User"), ("Final Price", "Price"), ("", "Total Value"),
        ("Transaction Type", ""), (AuctionItemIdHeader, ""),
        // Appended after the historically-matched layout (like AuctionItemIdHeader above) rather than naming the blank
        // "Buyer Company" cells above in place - those positions must stay byte-for-byte identical to the original
        // Excel export so old files and OKLO-built ones parse to the same table. OKLO already gives the highest and
        // second-highest bidder's own company name per lot (HighestBidBuyerName/SecondHighestBidBuyerName) - these two
        // extra columns are the one place that identity is exposed by a real header, for the Live Auction watch page.
        ("Highest Bidder", ""), ("Second Highest Bidder", ""),
    ];

    // The original export's second header row starts blank; the API-built one names only
    // where the original did. Asking Price's "Amount" sub-header is original too.
    public static IReadOnlyList<string> TopHeaders { get; } = Columns.Select(c => c.Top).ToArray();
    public static IReadOnlyList<string> SubHeaders { get; } = Columns.Select(c => c.Sub).ToArray();
    public static int ColumnCount => Columns.Length;

    /// <summary>Sri Lanka has no DST: fixed UTC+5:30, same on Windows and Docker/Linux.</summary>
    private static readonly TimeSpan SriLankaOffset = TimeSpan.FromMinutes(330);

    public static string[] MapRow(OkloLot l) =>
    [
        S(l.Broker), l.BrokerLotNumber.ToString(CultureInfo.InvariantCulture), S(l.SellingMark), S(l.Grade), S(l.InvoiceNumber),
        S(l.SubElevation), S(l.AuctionName), S(l.CategoryName), S(l.RePrint), S(l.RainforestCertified),
        S(l.SellerCertifications), S(l.TradeMark), N(l.Units), N(l.PerUnitWeight), N(l.TotalWeight),
        S(l.PrimaryStandard), S(l.BrokerRemark), S(l.BrokerLiquorRemark), Valuation(l.BrokerValuation, l.BrokerUpperValuation),
        N(l.AskingPrice), N(l.BaselineOfferValue), N(l.HighestBid),
        S(l.HighestBidBuyer), S(l.HighestBidBuyerName), S(l.HighestBidBuyerUserName),
        N(l.SecondHighestBid), S(l.SecondHighestBidBuyer), S(l.SecondHighestBidBuyerName), S(l.SecondHighestBidBuyerUserName),
        N(l.TotalPrice), S(l.AuctionItemStatus), N(l.BiddingPrice), S(l.Buyer), S(l.BuyerName),
        S(l.BuyerUserName), S(l.FactoryName), S(l.Factory), S(l.CountryName),
        S(l.Warehouse), S(l.WarehouseLocation), ManufacturedDate(l.ManufacturedDate),
        S(l.OutlotSettingType), SellingEndTime(l.SellingEndTime), S(l.ProducerParentCompany), S(l.FinalBuyerCompany),
        S(l.FinalBuyerCode), S(l.FinalBuyerUserName), N(l.FinalPrice), N(l.FinalTotalValue),
        S(l.PostSaleType), l.AuctionItemId.ToString(CultureInfo.InvariantCulture),
        S(l.HighestBidBuyerName), S(l.SecondHighestBidBuyerName),
    ];

    private static string S(string? v) => v?.Trim() ?? "";

    /// <summary>Numbers print as the importer's own reader prints Excel numerics: whole numbers
    /// without ".0", and zero is a blank cell (the export leaves unset prices empty).</summary>
    private static string N(decimal? v) =>
        v is null or 0 ? "" : v.Value.ToString("0.############", CultureInfo.InvariantCulture);

    /// <summary>"900" or "900 - 950": the export shows the broker's valuation as a range when an
    /// upper valuation above the lower one exists (1,009 of sale 37's lots), which
    /// SaleFileStore.ParseValuation reads back as ValuationFrom/To.</summary>
    private static string Valuation(decimal? lo, decimal? hi)
    {
        if (lo is null or 0) return "";
        return hi is > 0 && hi > lo ? $"{N(lo)} - {N(hi)}" : N(lo);
    }

    /// <summary>The export writes dates as "2026/08/20"; OKLO sends "2026-08-20" (or a full
    /// timestamp, or "0001-01-01T00:00:00" for unset).</summary>
    private static string ManufacturedDate(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return "";
        if (!DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) || d.Year <= 1) return "";
        return d.ToString("yyyy/MM/dd", CultureInfo.InvariantCulture);
    }

    /// <summary>OKLO sends UTC ("2026-09-23T08:06:14.8933333"); the export — and SaleFileStore's
    /// SellingEndTimeFormat — is Sri Lanka local "23/09/2026 13:36:14:893".</summary>
    private static string SellingEndTime(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return "";
        if (!DateTime.TryParse(v, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var utc) || utc.Year <= 1) return "";
        return (utc + SriLankaOffset).ToString("dd/MM/yyyy HH:mm:ss:fff", CultureInfo.InvariantCulture);
    }
}
