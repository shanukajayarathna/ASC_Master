using System.Collections.Concurrent;
using Asc.Api.Modules.Oklo;
using Asc.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Asc.Api.Tests;

/// <summary>
/// Stored snapshots are what make a restart instant, let a second server share the data, and let reports read history
/// without OKLO. These tests stand a dictionary in for MongoDB and pin: a sale pulled once is stored; a fresh process
/// serves it with OKLO completely down; a stale snapshot is served first and then refreshed; backfill stores missing
/// sales newest-first and never re-pulls a finished one.
/// </summary>
public class OkloSnapshotTests
{
    private sealed class FakeEnv : IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "t";
        public string EnvironmentName { get; set; } = "Development";
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class MemoryStore : ISaleSnapshotStore
    {
        public ConcurrentDictionary<Guid, SaleSnapshot> Data { get; } = new();
        public Task<SaleSnapshot?> LoadAsync(Guid id, CancellationToken ct) => Task.FromResult(Data.GetValueOrDefault(id));
        public Task SaveAsync(SaleSnapshot s, CancellationToken ct) { Data[s.CatalogueId] = s; return Task.CompletedTask; }
        public Task<IReadOnlyDictionary<Guid, DateTime>> ListAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyDictionary<Guid, DateTime>>(Data.ToDictionary(kv => kv.Key, kv => kv.Value.FetchedAtUtc));
    }

    private sealed class Feed : IOkloFeed
    {
        public List<OkloLot> Lots { get; set; } = [];
        public List<OkloCatalog> Catalogs { get; set; } = [];
        public bool Down { get; set; }
        /// <summary>When set, every page request waits for it — holds a refresh back so a test can observe the state before it.</summary>
        public Task? Hold { get; set; }
        /// <summary>When set, only this catalogue's page requests wait for <see cref="HoldOnly"/> (the rest answer at once).</summary>
        public int? HoldCatalog { get; set; }
        public Task? HoldOnly { get; set; }
        /// <summary>A (page, pageSize) that always fails - OKLO's database timing out on one heavy page.</summary>
        public (int Page, int Size)? FailingPage { get; set; }
        /// <summary>Simulates OKLO's own OkloClient.Gate: at most one call executes at a time, process-wide, across every
        /// catalogue - a call queues here before it can even reach <see cref="Hold"/>. Unset (the default) leaves every
        /// call free to run concurrently, as the other tests in this file rely on.</summary>
        public SemaphoreSlim? SharedGate { get; set; }
        public int PageCalls;
        /// <summary>Every catalogue that has started a page request (before any hold) - i.e. is pulling from OKLO right now.</summary>
        public ConcurrentDictionary<int, bool> Started { get; } = new();
        public List<int> PulledCatalogs { get; } = [];
        public bool IsConfigured => true;
        public Task<List<OkloCatalog>> ListCatalogsAsync(CancellationToken ct) => Task.FromResult(Catalogs);

        public async Task<OkloPage<OkloLot>> GetGeneralReportPageAsync(int catalogId, int pageNumber, int pageSize, CancellationToken ct, bool background = false)
        {
            if (SharedGate is not null) await SharedGate.WaitAsync(ct);
            try
            {
                Interlocked.Increment(ref PageCalls);
                Started[catalogId] = true;
                if (Hold is not null) await Hold.WaitAsync(ct);
                if (HoldCatalog == catalogId && HoldOnly is not null) await HoldOnly.WaitAsync(ct);
                if (Down) throw new HttpRequestException("OKLO down");
                if (FailingPage is { } bad && bad.Page == pageNumber && bad.Size == pageSize) throw new HttpRequestException("OKLO 500");
                if (pageNumber == 1) lock (PulledCatalogs) PulledCatalogs.Add(catalogId);
                return new OkloPage<OkloLot>(Lots.Skip((pageNumber - 1) * pageSize).Take(pageSize).ToList(), Lots.Count);
            }
            finally { SharedGate?.Release(); }
        }
    }

    private static List<OkloLot> MakeLots(int n, string status = "Unsold", string buyer = "") => Enumerable.Range(1, n).Select(i => new OkloLot
    {
        AuctionItemId = 9000 + i, Broker = "ASC", BrokerLotNumber = i, SellingMark = "M" + i, Grade = "BOP", InvoiceNumber = i.ToString("0000"),
        SubElevation = "WH", AuctionName = "Sale", CategoryName = "Ex-estate", RePrint = "No", TradeMark = "MF" + i, Units = 10,
        PerUnitWeight = 50m, TotalWeight = 500m, AuctionItemStatus = status, Buyer = buyer, BiddingPrice = buyer.Length > 0 ? 1500m : 0m,
        SellingEndTime = "2026-09-23T08:06:14.8933333", Factory = "MF" + i, FactoryName = "F" + i,
    }).ToList();

    private static OkloCatalog Cat(int id, int saleNo, DateTime date, string status = "Auctioned") =>
        new() { Id = id, SaleNumber = saleNo.ToString(), Name = "Sale " + saleNo, AuctionDate = date, StatusName = status, StatusId = status == "Open" ? 3 : 1020 };

    private static DateTime Recent => DateTime.UtcNow.Date.AddDays(-3);

    private sealed class Rig : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "asc-snap-tests-" + Guid.NewGuid());
        public SaleFileStore Store { get; }
        public Feed Feed { get; }
        public MemoryStore Snapshots { get; }
        public OkloLiveSales Live { get; }
        public LiveCatalogueSource Source { get; }

        public Rig(Feed? feed = null, MemoryStore? snapshots = null, Action<OkloOptions>? tweak = null)
        {
            var content = Path.Combine(Root, "backend", "Asc.Api");
            Directory.CreateDirectory(content);
            Store = new SaleFileStore(new CatalogueImportService(), new FakeEnv { ContentRootPath = content });
            Feed = feed ?? new Feed();
            Snapshots = snapshots ?? new MemoryStore();
            var o = new OkloOptions { LivePageSize = 100 };
            tweak?.Invoke(o);
            Live = new OkloLiveSales(Feed, Store, Options.Create(o), NullLogger<OkloLiveSales>.Instance, Snapshots);
            Source = new LiveCatalogueSource(Store, Live);
        }

        public void Dispose() { try { Directory.Delete(Root, true); } catch { } }
    }

    [Fact]
    public async Task ACompletePull_IsStored()
    {
        using var rig = new Rig();
        rig.Feed.Catalogs = [Cat(1, 37, Recent)];
        rig.Feed.Lots = MakeLots(250);
        await rig.Live.GetSnapshotAsync(SaleFileStore.CatalogueIdFor(Recent.Year, 37), needComplete: true, TimeSpan.FromSeconds(20), default);
        var stored = await rig.Snapshots.LoadAsync(SaleFileStore.CatalogueIdFor(Recent.Year, 37), default);
        Assert.NotNull(stored);
        Assert.Equal(250, stored!.Lots.Count);
        Assert.Equal(250, stored.Total);
    }

    [Fact]
    public async Task AfterARestart_TheSaleIsServedFromItsSnapshot_WithOkloCompletelyDown()
    {
        var shared = new MemoryStore();
        var id = SaleFileStore.CatalogueIdFor(Recent.Year, 37);

        using (var first = new Rig(snapshots: shared))
        {
            first.Feed.Catalogs = [Cat(1, 37, Recent)];
            first.Feed.Lots = MakeLots(250, "Sold", "FIN");
            await first.Live.GetSnapshotAsync(id, needComplete: true, TimeSpan.FromSeconds(20), default);
        }

        // "Restart": a brand-new process (empty memory) over the same database — and OKLO is down.
        using var second = new Rig(new Feed { Catalogs = [Cat(1, 37, Recent)], Down = true }, shared);
        var snap = await second.Live.GetSnapshotAsync(id, needComplete: true, TimeSpan.FromSeconds(20), default);
        Assert.NotNull(snap);
        Assert.True(snap!.Complete);
        Assert.Equal(250, snap.Lots.Count);
        Assert.All(snap.Lots, l => Assert.Equal("FIN", l.Buyer));
    }

    [Fact]
    public async Task AStaleSnapshot_IsServedAtOnce_ThenRefreshedFromOkloInTheBackground()
    {
        var shared = new MemoryStore();
        var id = SaleFileStore.CatalogueIdFor(Recent.Year, 37);
        shared.Data[id] = new SaleSnapshot(id, Recent.Year, 37, DateTime.UtcNow.AddHours(-3), 60, MakeLots(60));   // unsold, 3h old

        var hold = new TaskCompletionSource();
        using var rig = new Rig(new Feed { Catalogs = [Cat(1, 37, Recent)], Lots = MakeLots(60, "Sold", "FIN"), Hold = hold.Task }, shared,
            o => { o.ViewTtlRecentMinutes = 10; o.ViewTtlLiveMinutes = 10; o.ViewTtlArchiveHours = 1; });

        var first = await rig.Live.GetSnapshotAsync(id, needComplete: true, TimeSpan.FromSeconds(20), default);
        Assert.Equal("", first!.Lots[0].Buyer ?? "");                   // the stored (old) copy, straight away - OKLO still held back
        hold.SetResult();                                               // now let the background refresh through

        var sale = rig.Live.Loaded(id)!;
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while ((sale.Loading || sale.Snapshot()!.Lots[0].Buyer != "FIN") && DateTime.UtcNow < deadline) await Task.Delay(50);
        Assert.Equal("FIN", sale.Snapshot()!.Lots[0].Buyer);            // …then the fresh pull replaced it
        Assert.True(rig.Feed.PageCalls > 0);
    }

    [Fact]
    public async Task Backfill_StoresMissingSalesNewestFirst_AndNeverRepullsAFinishedOne()
    {
        var feed = new Feed { Lots = MakeLots(40) };
        feed.Catalogs = [Cat(11, 10, new DateTime(2024, 3, 5)), Cat(12, 11, new DateTime(2024, 3, 12)), Cat(13, 12, new DateTime(2024, 3, 19))];
        using var rig = new Rig(feed);
        await rig.Live.RefreshDirectoryAsync();

        Assert.True(await rig.Live.BackfillNextAsync(default));
        Assert.True(await rig.Live.BackfillNextAsync(default));
        Assert.True(await rig.Live.BackfillNextAsync(default));
        Assert.Equal([13, 12, 11], feed.PulledCatalogs);                 // newest sale first
        Assert.Equal(3, rig.Snapshots.Data.Count);

        var calls = feed.PageCalls;
        Assert.False(await rig.Live.BackfillNextAsync(default));         // nothing left…
        Assert.Equal(calls, feed.PageCalls);                             // …and finished sales are never pulled again
    }

    [Fact]
    public async Task Backfill_DoesNotStoreAPartialPull_AndBacksOffFromAFailingSale()
    {
        var feed = new Feed { Lots = MakeLots(40), Down = true, Catalogs = [Cat(11, 10, new DateTime(2024, 3, 5))] };
        using var rig = new Rig(feed);
        await rig.Live.RefreshDirectoryAsync();

        Assert.True(await rig.Live.BackfillNextAsync(default));          // tried, failed
        Assert.Empty(rig.Snapshots.Data);
        var calls = feed.PageCalls;
        Assert.False(await rig.Live.BackfillNextAsync(default));         // parked for a while, not retried in a tight loop
        Assert.Equal(calls, feed.PageCalls);
    }

    [Fact]
    public void AnArchiveSaleWithASnapshot_IsReadFromIt_WithoutOkloAndOutsideTheLoadBudget()
    {
        var shared = new MemoryStore();
        var old = new DateTime(2024, 3, 5);
        var sales = new[] { 10, 11, 12, 13 };
        foreach (var no in sales)
        {
            var id = SaleFileStore.CatalogueIdFor(2024, no);
            shared.Data[id] = new SaleSnapshot(id, 2024, no, DateTime.UtcNow.AddDays(-30), 25, MakeLots(25));
        }
        using var rig = new Rig(new Feed { Down = true, Catalogs = sales.Select(no => Cat(no, no, old.AddDays(no))).ToList() }, shared);

        // Four old sales, more than the two-per-window budget for file-less ones — all read fine from snapshots.
        foreach (var no in sales)
            Assert.Equal(25, rig.Source.GetLots(SaleFileStore.CatalogueIdFor(2024, no))!.Count);
    }

    [Fact]
    public async Task APageThatKeepsFailing_IsFetchedAsTwoHalfSizePages_SoTheSaleStillLoadsWhole()
    {
        var id = SaleFileStore.CatalogueIdFor(Recent.Year, 37);
        using var rig = new Rig(new Feed { Catalogs = [Cat(1, 37, Recent)], Lots = MakeLots(900), FailingPage = (3, 200) }, tweak: o => o.LivePageSize = 200);
        var snap = await rig.Live.GetSnapshotAsync(id, needComplete: true, TimeSpan.FromSeconds(20), default);
        Assert.NotNull(snap);
        Assert.True(snap!.Complete);
        Assert.Equal(900, snap.Lots.Count);
        Assert.Equal(900, snap.Lots.Select(l => l.Id).Distinct().Count());   // no lot lost, none doubled
    }

    [Fact]
    public async Task Backfill_AlsoSurvivesAFailingPage()
    {
        var feed = new Feed { Lots = MakeLots(900), FailingPage = (3, 200), Catalogs = [Cat(11, 10, new DateTime(2024, 3, 5))] };
        using var rig = new Rig(feed, tweak: o => o.LivePageSize = 200);
        await rig.Live.RefreshDirectoryAsync();
        Assert.True(await rig.Live.BackfillNextAsync(default));
        Assert.Equal(900, rig.Snapshots.Data.Single().Value.Lots.Count);
    }

    [Fact]
    public async Task OnlyOneSaleAPersonOpened_PullsFromOkloAtOnce_WhenSeveralAreOpenedTogether()
    {
        var hold = new TaskCompletionSource();
        var feed = new Feed { Lots = MakeLots(50), Hold = hold.Task, Catalogs = Enumerable.Range(1, 5).Select(i => Cat(i, i, Recent.AddDays(-i))).ToList() };
        using var rig = new Rig(feed);
        await rig.Live.RefreshDirectoryAsync();

        var opens = Enumerable.Range(1, 5)
            .Select(i => rig.Live.GetSnapshotAsync(SaleFileStore.CatalogueIdFor(Recent.AddDays(-i).Year, i), needComplete: false, TimeSpan.FromMilliseconds(700), default))
            .ToArray();
        await Task.WhenAll(opens);                 // nothing can finish while OKLO is held, so all five give up waiting

        Assert.Single(feed.Started);                // …but only one of the five sales was allowed to start pulling
        hold.SetResult();
    }

    [Fact]
    public async Task ASaleSomeoneIsWaitingOn_PausesAnAbandonedOneInsteadOfQueuingBehindIt()
    {
        var hold = new TaskCompletionSource();
        var feed = new Feed { Lots = MakeLots(50), Hold = hold.Task, Catalogs = Enumerable.Range(1, 2).Select(i => Cat(i, i, Recent.AddDays(-i))).ToList() };
        using var rig = new Rig(feed, tweak: o => { o.PreemptAfterIdleSeconds = 1; o.PreemptMinRunSeconds = 0; });
        await rig.Live.RefreshDirectoryAsync();
        Guid Id(int i) => SaleFileStore.CatalogueIdFor(Recent.AddDays(-i).Year, i);

        // Sale 1 is opened (taking the one priority slot) and then left; OKLO is slow, so it never finishes.
        await rig.Live.GetSnapshotAsync(Id(1), false, TimeSpan.FromMilliseconds(300), default);
        Assert.Single(feed.Started);
        await Task.Delay(1300);                    // …and nobody asks for it again: it counts as abandoned

        // Sale 2 is opened next: without pre-emption it would queue behind sale 1 until it finished.
        var second = rig.Live.GetSnapshotAsync(Id(2), false, TimeSpan.FromSeconds(3), default);
        for (var i = 0; i < 60 && !feed.Started.ContainsKey(2); i++) await Task.Delay(50);
        Assert.True(feed.Started.ContainsKey(2), "the sale being waited on should get a slot");
        Assert.False(rig.Live.Loaded(Id(1))!.Loading);   // sale 1, abandoned, was paused
        hold.SetResult();
        await second;
    }

    [Fact]
    public async Task ABackgroundRefreshOfAnAlreadyCompleteSale_IsPausedForAFreshSaleSomeoneIsWaitingOn()
    {
        // Sale A is complete and then goes stale (a routine background refresh will pick it up); sale B has never loaded.
        var idA = SaleFileStore.CatalogueIdFor(Recent.Year, 1);
        var idB = SaleFileStore.CatalogueIdFor(Recent.Year, 2);
        var feed = new Feed { Lots = MakeLots(30), Catalogs = [Cat(1, 1, Recent), Cat(2, 2, Recent.AddDays(-1))] };
        using var rig = new Rig(feed, tweak: o => { o.ViewTtlRecentMinutes = 0; o.ViewTtlLiveMinutes = 0; o.ViewTtlArchiveHours = 0; });
        await rig.Live.RefreshDirectoryAsync();
        await rig.Live.GetSnapshotAsync(idA, needComplete: true, TimeSpan.FromSeconds(20), default);   // sale A finishes once, normally

        // OKLO now hangs: sale A's background refresh (TTL already 0, so EnsureFresh restarts it) gets stuck holding the
        // one shared OKLO slot, without anyone waiting on sale A specifically.
        var hold = new TaskCompletionSource();
        feed.Hold = hold.Task;
        var saleA = rig.Live.Loaded(idA)!;
        rig.Live.EnsureFresh(saleA);
        for (var i = 0; i < 60 && !saleA.Running; i++) await Task.Delay(50);
        Assert.True(saleA.Running, "the background refresh should have started");

        // Someone opens sale B (never loaded before): without preempting the background refresh it would queue for
        // however long that refresh takes.
        var task = rig.Live.GetSnapshotAsync(idB, needComplete: false, TimeSpan.FromSeconds(3), default);
        for (var i = 0; i < 60 && !feed.Started.ContainsKey(2); i++) await Task.Delay(50);
        Assert.True(feed.Started.ContainsKey(2), "sale B should get the slot promptly");
        Assert.False(saleA.Loading, "sale A's background refresh was paused, not left holding the slot");
        hold.SetResult();
        await task;
    }

    [Fact]
    public async Task ASecondPersonsSale_DoesNotPauseAnUnrelatedRefresh_WhenTheRealBlockerIsTheFirstPersonsOwnSale()
    {
        // Sale C is complete and about to go stale (a routine background refresh will pick it up); sale A is a person's
        // sale actively (and legitimately) loading; sale B is a second person's sale, queued behind A for the one user slot.
        var idA = SaleFileStore.CatalogueIdFor(Recent.Year, 1);
        var idB = SaleFileStore.CatalogueIdFor(Recent.Year, 2);
        var idC = SaleFileStore.CatalogueIdFor(Recent.Year, 3);
        var feed = new Feed { Lots = MakeLots(30), Catalogs = [Cat(1, 1, Recent), Cat(2, 2, Recent.AddDays(-1)), Cat(3, 3, Recent.AddDays(-2))] };
        using var rig = new Rig(feed, tweak: o => { o.ViewTtlRecentMinutes = 0; o.ViewTtlLiveMinutes = 0; o.ViewTtlArchiveHours = 0; });
        await rig.Live.RefreshDirectoryAsync();
        await rig.Live.GetSnapshotAsync(idC, needComplete: true, TimeSpan.FromSeconds(20), default);   // sale C finishes once, normally

        var hold = new TaskCompletionSource();
        feed.Hold = hold.Task;

        // Sale A takes the one user slot and starts pulling (OKLO now hangs, so it never finishes - but it is actively
        // running, not abandoned). The opening call itself only stays around briefly - like a person opening a sale and
        // moving on - so its own polling (which would otherwise also be entitled to free up sale C, on ITS OWN behalf,
        // exactly as intended) stops, isolating what happens next to sale B's polling alone.
        await rig.Live.GetSnapshotAsync(idA, needComplete: false, TimeSpan.FromMilliseconds(300), default);
        Assert.True(feed.Started.ContainsKey(1));
        var saleA = rig.Live.Loaded(idA)!;
        Assert.True(saleA.Loading, "sale A keeps loading in the background after its opening call returns");

        // Sale C's background refresh also starts (TTL already 0).
        var saleC = rig.Live.Loaded(idC)!;
        rig.Live.EnsureFresh(saleC);
        for (var i = 0; i < 60 && !feed.Started.ContainsKey(3); i++) await Task.Delay(50);
        Assert.True(feed.Started.ContainsKey(3));

        // Sale B is opened next: it cannot run (the one user slot is held by sale A, which is not abandoned), so pausing
        // sale C's refresh would not help it at all - it should be left alone.
        var taskB = rig.Live.GetSnapshotAsync(idB, needComplete: false, TimeSpan.FromSeconds(4), default);
        await taskB;
        Assert.False(feed.Started.ContainsKey(2), "sale B should still be queued, not running");
        Assert.True(saleC.Loading, "sale C's unrelated refresh should not have been paused - it would not free sale A's slot");

        hold.SetResult();
    }

    [Fact]
    public async Task ASaleThatAlreadyHasItsOwnSlot_StillGetsHelp_WhenStuckBehindABackgroundRefreshAtOklosOwnSharedConnection()
    {
        // A stand-in for OkloClient's real Gate: only one call to "OKLO" runs at a time, process-wide - the one thing the
        // other fakes in this file don't model, and the one thing MakeRoomFor must keep working around even after its own
        // sale already has a lane slot.
        var sharedGate = new SemaphoreSlim(1);
        var idD = SaleFileStore.CatalogueIdFor(Recent.Year, 1);
        var idE = SaleFileStore.CatalogueIdFor(Recent.Year, 2);
        var feed = new Feed { Lots = MakeLots(30), SharedGate = sharedGate, Catalogs = [Cat(1, 1, Recent), Cat(2, 2, Recent.AddDays(-1))] };
        using var rig = new Rig(feed, tweak: o => { o.ViewTtlRecentMinutes = 0; o.ViewTtlLiveMinutes = 0; o.ViewTtlArchiveHours = 0; });
        await rig.Live.RefreshDirectoryAsync();
        await rig.Live.GetSnapshotAsync(idE, needComplete: true, TimeSpan.FromSeconds(20), default);   // sale E finishes once, normally

        // Sale E goes stale and starts a background refresh that grabs the shared connection and then hangs on it.
        var hold = new TaskCompletionSource();
        feed.Hold = hold.Task;
        var saleE = rig.Live.Loaded(idE)!;
        rig.Live.EnsureFresh(saleE);
        for (var i = 0; i < 60 && !feed.Started.ContainsKey(2); i++) await Task.Delay(50);
        Assert.True(feed.Started.ContainsKey(2), "sale E's background refresh should have started");

        // Sale D is opened next: its own lane slot is free (nothing else holds it), so it reaches "Running" almost at
        // once - but every attempt to actually call OKLO then queues behind sale E at the shared connection. Without
        // MakeRoomFor continuing to help past that point, it would sit there for its entire timeout with zero rows.
        var taskD = rig.Live.GetSnapshotAsync(idD, needComplete: false, TimeSpan.FromSeconds(5), default);
        for (var i = 0; i < 100 && !feed.Started.ContainsKey(1); i++) await Task.Delay(50);
        Assert.True(feed.Started.ContainsKey(1), "sale D should get through to OKLO, not sit stuck at the shared connection");

        hold.SetResult();   // "OKLO answers" - lets D's now-in-flight call (and E's cancelled one) actually complete
        var snap = await taskD;
        Assert.NotNull(snap);   // it got at least its first rows within the timeout
    }

    // ---- page reload => fresh pull ----------------------------------------------------------------------

    [Fact]
    public async Task RefreshNow_RePullsAnActiveSaleAtOnce_EvenInsideItsRefreshWindow()
    {
        var id = SaleFileStore.CatalogueIdFor(Recent.Year, 37);
        var feed = new Feed { Catalogs = [Cat(1, 37, Recent)], Lots = MakeLots(60) };
        using var rig = new Rig(feed, tweak: o => { o.ForceRefreshMinSeconds = 0; o.ViewTtlRecentMinutes = 60; o.ViewTtlLiveMinutes = 60; });
        await rig.Live.RefreshDirectoryAsync();
        var first = await rig.Live.GetSnapshotAsync(id, needComplete: true, TimeSpan.FromSeconds(20), default);
        Assert.Equal("", first!.Lots[0].Buyer ?? "");
        var sale = rig.Live.Loaded(id)!;
        for (var i = 0; i < 100 && sale.Loading; i++) await Task.Delay(50);

        foreach (var l in feed.Lots) { l.AuctionItemStatus = "Sold"; l.Buyer = "FIN"; l.BiddingPrice = 1500m; }   // OKLO changed
        var before = sale.Snapshot()!.FetchedAtUtc;
        Assert.Equal(1, rig.Live.RefreshNow(null));                    // a reload asks for the latest…

        var deadline = DateTime.UtcNow.AddSeconds(20);
        while ((sale.Loading || sale.Snapshot()!.FetchedAtUtc == before) && DateTime.UtcNow < deadline) await Task.Delay(50);
        Assert.Equal("FIN", sale.Snapshot()!.Lots[0].Buyer);            // …and gets it, though the 60-minute window had not passed
    }

    [Fact]
    public async Task RefreshNow_IsRateLimitedPerSale()
    {
        var id = SaleFileStore.CatalogueIdFor(Recent.Year, 37);
        using var rig = new Rig(new Feed { Catalogs = [Cat(1, 37, Recent)], Lots = MakeLots(30) });   // default: once a minute
        await rig.Live.RefreshDirectoryAsync();
        await rig.Live.GetSnapshotAsync(id, needComplete: true, TimeSpan.FromSeconds(20), default);
        var sale = rig.Live.Loaded(id)!;
        for (var i = 0; i < 100 && sale.Loading; i++) await Task.Delay(50);

        var calls = rig.Feed.PageCalls;
        Assert.Equal(0, rig.Live.RefreshNow(null));                    // pulled seconds ago: a reload does not pull again
        Assert.Equal(calls, rig.Feed.PageCalls);
    }

    [Fact]
    public async Task RefreshNow_LeavesFinishedSalesAlone_AndDoesNothingWhenNotConfigured()
    {
        var old = SaleFileStore.CatalogueIdFor(2024, 10);
        var feed = new Feed { Catalogs = [Cat(3, 10, new DateTime(2024, 3, 5))], Lots = MakeLots(30) };
        using var rig = new Rig(feed, tweak: o => o.ForceRefreshMinSeconds = 0);
        await rig.Live.RefreshDirectoryAsync();
        Assert.Equal(0, rig.Live.RefreshNow([old]));                   // a finished sale's results are final
        Assert.Equal(0, feed.PageCalls);

        using var off = new Rig(new Feed { Catalogs = [Cat(1, 37, Recent)] }, tweak: o => o.LiveView = false);
        Assert.Equal(0, off.Live.RefreshNow(null));
    }

    [Fact]
    public async Task TheNewestSales_RefreshEvenWhileHousekeepingHoldsTheBackgroundSlot()
    {
        // Three active sales: 5 (oldest, stuck pulling in the background) and 6, 7 (the two newest = "hot").
        var stuck = new TaskCompletionSource();
        var feed = new Feed { Lots = MakeLots(30), HoldCatalog = 5, HoldOnly = stuck.Task };
        feed.Catalogs = [Cat(5, 5, Recent.AddDays(-9)), Cat(6, 6, Recent.AddDays(-2)), Cat(7, 7, Recent.AddDays(-1))];
        using var rig = new Rig(feed);
        await rig.Live.RefreshDirectoryAsync();

        var oldest = rig.Live.Directory.Single(r => r.SaleNo == 5);
        rig.Live.EnsureFresh(rig.Live.GetOrCreate(oldest));            // housekeeping pull: takes the background slot and hangs
        await rig.Live.WarmStepAsync(default);                         // the warm-up starts the two newest sales

        foreach (var no in new[] { 6, 7 })
        {
            var sale = rig.Live.Loaded(rig.Live.Directory.Single(r => r.SaleNo == no).CatalogueId)!;
            var deadline = DateTime.UtcNow.AddSeconds(20);
            while (!sale.State.Complete && DateTime.UtcNow < deadline) await Task.Delay(50);
            Assert.True(sale.State.Complete, $"sale {no} should not wait behind the stuck background pull");
        }
        stuck.SetResult();
    }
}
