using Asc.Api.Models;
using MongoDB.Driver;

namespace Asc.Api.Data;

public class MongoContext
{
    public IMongoDatabase Database { get; }

    public MongoContext(IConfiguration config)
    {
        var connectionString = config.GetConnectionString("Mongo") ?? "mongodb://localhost:27017";
        var databaseName = config["MongoDatabaseName"] ?? "asc_tea";
        var client = new MongoClient(connectionString);
        Database = client.GetDatabase(databaseName);

        // Catalogue data is file-backed (SaleFileStore); the database keeps only small
        // user-entered state. Valuations are fetched per catalogue on every merge, so
        // keep that path indexed. CreateMany is idempotent.
        Valuations.Indexes.CreateMany(
        [
            new CreateIndexModel<StoredValuation>(Builders<StoredValuation>.IndexKeys.Ascending(v => v.CatalogueId)),
        ]);
    }

    /// <summary>User-entered valuations — the only per-lot state the database holds.</summary>
    public IMongoCollection<StoredValuation> Valuations => Database.GetCollection<StoredValuation>("valuations");

    public IMongoCollection<FilterPreset> FilterPresets => Database.GetCollection<FilterPreset>("filterPresets");
    public IMongoCollection<ActualPrice> ActualPrices => Database.GetCollection<ActualPrice>("actualPrices");
    public IMongoCollection<SavedReport> SavedReports => Database.GetCollection<SavedReport>("savedReports");

    // Legacy collections from the pre-file-store era — kept addressable only so the purge
    // endpoint can drop them and reclaim the space.
    public IMongoCollection<Catalogue> LegacyCatalogues => Database.GetCollection<Catalogue>("catalogues");
    public IMongoCollection<Lot> LegacyLots => Database.GetCollection<Lot>("lots");
}
