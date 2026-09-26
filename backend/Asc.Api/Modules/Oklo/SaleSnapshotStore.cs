using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;
using Asc.Api.Data;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.Oklo;

/// <summary>One complete pull of a sale from OKLO, exactly as OKLO sent it (the raw lots, not the app's Lot
/// objects — so a later change to the Lot model never invalidates stored snapshots).</summary>
public sealed record SaleSnapshot(Guid CatalogueId, int Year, int SaleNo, DateTime FetchedAtUtc, int Total, List<OkloLot> Lots);

/// <summary>
/// Where finished pulls of OKLO sales are kept between requests and restarts. The live view still holds sales in
/// memory; this is what it starts from after a restart (instantly, then refreshes from OKLO in the background),
/// what a second server shares, and what cross-sale reports read for sales nobody has opened recently.
/// </summary>
public interface ISaleSnapshotStore
{
    Task<SaleSnapshot?> LoadAsync(Guid catalogueId, CancellationToken ct);
    Task SaveAsync(SaleSnapshot snapshot, CancellationToken ct);
    /// <summary>Which sales have a snapshot, and when each was pulled — no lot data is read.</summary>
    Task<IReadOnlyDictionary<Guid, DateTime>> ListAsync(CancellationToken ct);
}

/// <summary>No persistence: every restart starts cold (the behaviour before snapshots, and what unit tests use).</summary>
public sealed class NullSaleSnapshotStore : ISaleSnapshotStore
{
    public static readonly NullSaleSnapshotStore Instance = new();
    public Task<SaleSnapshot?> LoadAsync(Guid catalogueId, CancellationToken ct) => Task.FromResult<SaleSnapshot?>(null);
    public Task SaveAsync(SaleSnapshot snapshot, CancellationToken ct) => Task.CompletedTask;
    public Task<IReadOnlyDictionary<Guid, DateTime>> ListAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyDictionary<Guid, DateTime>>(new Dictionary<Guid, DateTime>());
}

/// <summary>One MongoDB document per sale: the lots as gzip-compressed JSON in a binary field (~1 MB for a
/// 10,000-lot sale, far under Mongo's 16 MB document limit), plus a few plain fields for listing.</summary>
public sealed class MongoSaleSnapshotStore(MongoContext db, ILogger<MongoSaleSnapshotStore> log) : ISaleSnapshotStore
{
    private const int MaxPayloadBytes = 15 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private IMongoCollection<BsonDocument> Collection => db.Database.GetCollection<BsonDocument>("saleSnapshots");

    public async Task SaveAsync(SaleSnapshot snapshot, CancellationToken ct)
    {
        byte[] payload;
        using (var buffer = new MemoryStream())
        {
            using (var gz = new GZipStream(buffer, CompressionLevel.Fastest, leaveOpen: true))
                JsonSerializer.Serialize(gz, snapshot.Lots, Json);
            payload = buffer.ToArray();
        }
        if (payload.Length > MaxPayloadBytes)
        {
            log.LogWarning("Sale {No}/{Year} snapshot is {Mb:0.0} MB — over the document limit, not stored", snapshot.SaleNo, snapshot.Year, payload.Length / 1e6);
            return;
        }
        var id = snapshot.CatalogueId.ToString();
        var doc = new BsonDocument
        {
            { "_id", id },
            { "year", snapshot.Year },
            { "saleNo", snapshot.SaleNo },
            { "fetchedAtUtc", snapshot.FetchedAtUtc },
            { "total", snapshot.Total },
            { "payload", new BsonBinaryData(payload) },
        };
        await Collection.ReplaceOneAsync(Builders<BsonDocument>.Filter.Eq("_id", id), doc, new ReplaceOptions { IsUpsert = true }, ct);
    }

    public async Task<SaleSnapshot?> LoadAsync(Guid catalogueId, CancellationToken ct)
    {
        var doc = await Collection.Find(Builders<BsonDocument>.Filter.Eq("_id", catalogueId.ToString())).FirstOrDefaultAsync(ct);
        if (doc is null) return null;
        using var gz = new GZipStream(new MemoryStream(doc["payload"].AsBsonBinaryData.Bytes), CompressionMode.Decompress);
        var lots = await JsonSerializer.DeserializeAsync<List<OkloLot>>(gz, Json, ct) ?? [];
        return new SaleSnapshot(catalogueId, doc["year"].AsInt32, doc["saleNo"].AsInt32, doc["fetchedAtUtc"].ToUniversalTime(), doc["total"].AsInt32, lots);
    }

    public async Task<IReadOnlyDictionary<Guid, DateTime>> ListAsync(CancellationToken ct)
    {
        var docs = await Collection.Find(FilterDefinition<BsonDocument>.Empty)
            .Project(Builders<BsonDocument>.Projection.Include("fetchedAtUtc"))
            .ToListAsync(ct);
        return docs.Where(d => Guid.TryParse(d["_id"].AsString, out _))
            .ToDictionary(d => Guid.Parse(d["_id"].AsString), d => d["fetchedAtUtc"].ToUniversalTime());
    }
}
