using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Asc.Api.Modules.Oklo;

/// <summary>One row of Catalogs/get-catalog-by-status.</summary>
public class OkloCatalog
{
    public int Id { get; set; }
    public string? SaleNumber { get; set; }
    public string? Name { get; set; }
    public DateTime? AuctionDate { get; set; }
    public string? StatusName { get; set; }
    public int StatusId { get; set; }
}

/// <summary>
/// One lot of Reports/general-report. Only the fields the app's sale files carry are declared;
/// the live API returns more than the 2022 PDF documents (SubElevation, SellingEndTime,
/// Warehouse, FinalBuyer*, ...) — verified field-by-field against a real sale file.
/// Note the API's own naming quirk: PostSaleType is the text, PostSaleTypeName is a number.
/// </summary>
public class OkloLot
{
    public long AuctionItemId { get; set; }
    public string? Broker { get; set; }
    public int BrokerLotNumber { get; set; }
    public string? SellingMark { get; set; }
    public string? Grade { get; set; }
    public string? InvoiceNumber { get; set; }
    public string? SubElevation { get; set; }
    public string? AuctionName { get; set; }
    public string? CategoryName { get; set; }
    public string? RePrint { get; set; }
    public string? RainforestCertified { get; set; }
    public string? SellerCertifications { get; set; }
    public string? TradeMark { get; set; }
    public decimal? Units { get; set; }
    public decimal? PerUnitWeight { get; set; }
    public decimal? TotalWeight { get; set; }
    public string? PrimaryStandard { get; set; }
    public string? BrokerRemark { get; set; }
    public string? BrokerLiquorRemark { get; set; }
    public decimal? BrokerValuation { get; set; }
    public decimal? BrokerUpperValuation { get; set; }
    public decimal? AskingPrice { get; set; }
    public decimal? BaselineOfferValue { get; set; }
    public decimal? HighestBid { get; set; }
    public string? HighestBidBuyer { get; set; }
    public string? HighestBidBuyerName { get; set; }
    public string? HighestBidBuyerUserName { get; set; }
    public decimal? SecondHighestBid { get; set; }
    public string? SecondHighestBidBuyer { get; set; }
    public string? SecondHighestBidBuyerName { get; set; }
    public string? SecondHighestBidBuyerUserName { get; set; }
    public decimal? TotalPrice { get; set; }
    public string? AuctionItemStatus { get; set; }
    public decimal? BiddingPrice { get; set; }
    public string? Buyer { get; set; }
    public string? BuyerName { get; set; }
    public string? BuyerUserName { get; set; }
    public string? FactoryName { get; set; }
    public string? Factory { get; set; }
    public string? CountryName { get; set; }
    public string? Warehouse { get; set; }
    public string? WarehouseLocation { get; set; }
    public string? ManufacturedDate { get; set; }
    public string? OutlotSettingType { get; set; }
    public string? SellingEndTime { get; set; }
    public string? ProducerParentCompany { get; set; }
    public string? FinalBuyerCompany { get; set; }
    public string? FinalBuyerCode { get; set; }
    public string? FinalBuyerUserName { get; set; }
    public decimal? FinalPrice { get; set; }
    public decimal? FinalTotalValue { get; set; }
    public string? PostSaleType { get; set; }
}

/// <summary>A page of a report: rows plus the total the API says exist.</summary>
public record OkloPage<T>(List<T> Rows, int TotalItems);

/// <summary>What the live layer needs from OKLO — an interface so it can be tested without the network.</summary>
public interface IOkloFeed
{
    bool IsConfigured { get; }
    Task<List<OkloCatalog>> ListCatalogsAsync(CancellationToken ct);
    /// <param name="background">Background work (file sync, warm-up, size probes) yields to a sale someone is waiting on.</param>
    Task<OkloPage<OkloLot>> GetGeneralReportPageAsync(int catalogId, int pageNumber, int pageSize, CancellationToken ct, bool background = false);
}

/// <summary>
/// Thin authenticated client for the OKLO SmartAuction API. Handles the B2C password-grant
/// token (cached, refreshed a few minutes before expiry — ~4.3h lifetime), retries transient
/// failures, and re-authenticates once on 401. Registered via AddHttpClient&lt;OkloClient&gt;.
/// </summary>
public class OkloClient(HttpClient http, IOptions<OkloOptions> options, ILogger<OkloClient> log) : IOkloFeed
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    /// <summary>The one request OKLO is allowed to be answering at a time, for the whole process (sync, live view, size
    /// probes) - shared, not per sale. Several sales loading side by side used to send several requests to OKLO at once,
    /// which its slow, shared database answered even more slowly; one request at a time is the most OKLO is asked to do
    /// concurrently, whatever else is queued behind it.</summary>
    private static readonly SemaphoreSlim Gate = new(1);

    /// <summary>Background work may hold at most two of those four slots, so a page a user just opened is never
    /// queued behind a multi-hour back-fill or a warm-up. The small catalogue-list calls skip the queue entirely.</summary>
    private static readonly SemaphoreSlim BackgroundGate = new(2);

    private enum Lane { User, Background, Light }

    // Circuit breaker for background work. When OKLO is overloaded every request times out, and the retries of background
    // jobs (backfill, warm-up, re-link, size probes) only pile more load onto it. After six failed attempts in a row all
    // background requests pause for two minutes; requests a person is waiting on are never blocked by this.
    /// <summary>Wait before retry number <c>attempt</c> (5s, 10s, ...). A field so tests can make it instant.</summary>
    internal static Func<int, TimeSpan> RetryDelay = attempt => TimeSpan.FromSeconds(5 * attempt);

    private static int _failStreak;
    private static long _pauseUntilTicks;
    private static readonly TimeSpan BackgroundPause = TimeSpan.FromMinutes(2);
    private const int FailuresBeforePause = 6;

    private static void RecordSuccess() => Interlocked.Exchange(ref _failStreak, 0);

    private static void RecordFailure()
    {
        if (Interlocked.Increment(ref _failStreak) < FailuresBeforePause) return;
        Interlocked.Exchange(ref _pauseUntilTicks, DateTime.UtcNow.Add(BackgroundPause).Ticks);
        Interlocked.Exchange(ref _failStreak, 0);
    }

    /// <summary>Forget the breaker's state (tests share the static state).</summary>
    internal static void ResetCircuitBreaker()
    {
        Interlocked.Exchange(ref _failStreak, 0);
        Interlocked.Exchange(ref _pauseUntilTicks, 0);
    }

    private readonly OkloOptions _o = options.Value;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private string? _token;
    private DateTime _tokenExpiresUtc;

    public bool IsConfigured => _o.IsConfigured;
    public int PageSize => Math.Max(50, _o.PageSize);

    private async Task<string> GetTokenAsync(bool forceRefresh, CancellationToken ct)
    {
        if (!forceRefresh && _token is not null && DateTime.UtcNow < _tokenExpiresUtc) return _token;
        await _tokenLock.WaitAsync(ct);
        try
        {
            if (!forceRefresh && _token is not null && DateTime.UtcNow < _tokenExpiresUtc) return _token;
            using var req = new HttpRequestMessage(HttpMethod.Post, _o.TokenUrl)
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "password",
                    ["client_id"] = _o.ClientId,
                    ["client_secret"] = _o.ClientSecret,
                    ["username"] = _o.Username,
                    ["password"] = _o.Password,
                    ["scope"] = _o.Scope,
                }),
            };
            using var res = await http.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                // Never log the request — it carries the password. The B2C error body is safe.
                throw new HttpRequestException($"OKLO token request failed ({(int)res.StatusCode}): {Truncate(body)}");
            using var doc = JsonDocument.Parse(body);
            _token = doc.RootElement.GetProperty("access_token").GetString()!;
            // Azure B2C sends expires_in as a JSON string ("15600"), other IdPs as a number.
            var seconds = doc.RootElement.TryGetProperty("expires_in", out var e)
                ? e.ValueKind == JsonValueKind.Number ? e.GetInt32() : int.TryParse(e.GetString(), out var n) ? n : 3600
                : 3600;
            _tokenExpiresUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, seconds - 300));
            return _token;
        }
        finally { _tokenLock.Release(); }
    }

    private async Task<string> PostAsync(string path, string jsonBody, CancellationToken ct, Lane lane = Lane.User)
    {
        // OKLO's database throws transient 500s (SQL timeouts, replica failovers) under load — verified on
        // 2022 sales that read fine one at a time — so retry generously with growing waits.
        const int attempts = 5;
        if (lane == Lane.Background && DateTime.UtcNow.Ticks < Interlocked.Read(ref _pauseUntilTicks))
            throw new OkloApiException(503, "OKLO background requests are paused for a couple of minutes after repeated failures");
        var refreshed = false;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                var token = await GetTokenAsync(false, ct);
                using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(_o.BaseUrl.TrimEnd('/') + "/"), path.TrimStart('/')))
                {
                    Content = new StringContent(jsonBody, Encoding.UTF8, "application/json"),
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                HttpStatusCode status;
                string body;
                if (lane == Lane.Background) await BackgroundGate.WaitAsync(ct);
                try
                {
                    if (lane != Lane.Light) await Gate.WaitAsync(ct);
                    try
                    {
                        // A request that stalls (OKLO sometimes sends headers, then trickles the body) is cut off
                        // and retried rather than holding a slot for the full HttpClient timeout.
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                        timeout.CancelAfter(lane == Lane.Light ? TimeSpan.FromSeconds(30) : TimeSpan.FromSeconds(90));
                        using var res = await http.SendAsync(req, timeout.Token);
                        status = res.StatusCode;
                        body = await res.Content.ReadAsStringAsync(timeout.Token);
                    }
                    finally { if (lane != Lane.Light) Gate.Release(); }
                }
                finally { if (lane == Lane.Background) BackgroundGate.Release(); }
                if (status == HttpStatusCode.Unauthorized && !refreshed)
                {
                    refreshed = true;
                    await GetTokenAsync(true, ct);
                    throw new HttpRequestException("401 — token refreshed, retrying");
                }
                if ((int)status is >= 200 and < 300) { RecordSuccess(); return body; }
                if ((int)status is >= 400 and < 500 && status != HttpStatusCode.RequestTimeout)
                    throw new OkloApiException((int)status, $"OKLO {path} -> {(int)status}: {Truncate(body)}");
                throw new HttpRequestException($"OKLO {path} -> {(int)status}");
            }
            catch (OkloApiException) { throw; }
            catch (Exception ex) when (attempt < attempts && !ct.IsCancellationRequested)
            {
                RecordFailure();
                log.LogWarning("OKLO {Path} attempt {Attempt} failed: {Message}", path, attempt, ex.Message);
                await Task.Delay(RetryDelay(attempt), ct);
            }
        }
    }

    /// <summary>Every catalogue (sale) across the four statuses: Open 3, Published 4, Auctioned 1020, Closed 2056.</summary>
    public async Task<List<OkloCatalog>> ListCatalogsAsync(CancellationToken ct)
    {
        var lists = await Task.WhenAll(new[] { 3, 4, 1020, 2056 }.Select(async status =>
            JsonSerializer.Deserialize<List<OkloCatalog>>(
                await PostAsync("api/Catalogs/get-catalog-by-status", $"[{status}]", ct, Lane.Light), Json) ?? []));
        return lists.SelectMany(l => l).GroupBy(c => c.Id).Select(g => g.First()).OrderBy(c => c.Id).ToList();
    }

    /// <summary>One page of a sale's lots. The live API rejects ignorePaging-only requests
    /// ("Please enter a valid page size"), so pageNumber/pageSize are always sent.</summary>
    /// <summary>The file sync's pull — background work by definition.</summary>
    public Task<OkloPage<OkloLot>> GetGeneralReportPageAsync(int catalogId, int pageNumber, CancellationToken ct) =>
        GetGeneralReportPageAsync(catalogId, pageNumber, PageSize, ct, background: true);

    public async Task<OkloPage<OkloLot>> GetGeneralReportPageAsync(int catalogId, int pageNumber, int pageSize, CancellationToken ct, bool background = false)
    {
        var body = await PostAsync("api/Reports/general-report",
            $"{{\"pageNumber\":{pageNumber},\"pageSize\":{pageSize},\"ignorePaging\":false,\"getAllData\":false,\"catalogId\":{catalogId}}}", ct,
            background ? Lane.Background : Lane.User);
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var rows = root.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Array
            ? d.Deserialize<List<OkloLot>>(Json) ?? []
            : [];
        var total = root.TryGetProperty("TotalItems", out var t) && t.TryGetInt32(out var n) ? n : rows.Count;
        return new OkloPage<OkloLot>(rows, total);
    }

    /// <summary>A whole sale. Page 1 tells the total; remaining pages are fetched two at a time
    /// (be polite — one shared account, and a page already takes ~10s server-side).</summary>
    public async Task<List<OkloLot>> GetSaleLotsAsync(int catalogId, CancellationToken ct)
    {
        var first = await GetGeneralReportPageAsync(catalogId, 1, ct);
        var lots = new List<OkloLot>(first.Rows);
        var pages = (int)Math.Ceiling(first.TotalItems / (double)PageSize);
        var rest = new List<OkloLot>[Math.Max(0, pages - 1)];
        using var gate = new SemaphoreSlim(2);
        await Task.WhenAll(Enumerable.Range(2, Math.Max(0, pages - 1)).Select(async page =>
        {
            await gate.WaitAsync(ct);
            try { rest[page - 2] = (await GetGeneralReportPageAsync(catalogId, page, ct)).Rows; }
            finally { gate.Release(); }
        }));
        foreach (var r in rest) lots.AddRange(r);
        if (lots.Count != first.TotalItems)
            log.LogWarning("OKLO catalogue {Id}: expected {Expected} lots, got {Got}", catalogId, first.TotalItems, lots.Count);
        return lots;
    }

    private static string Truncate(string s) => s.Length <= 300 ? s : s[..300];
}

public class OkloApiException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
