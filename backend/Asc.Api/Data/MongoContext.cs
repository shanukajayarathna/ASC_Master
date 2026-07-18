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

        // Real weekly sales put ~350k lots in the store and every lot query filters by
        // catalogue — without this index each one is a full collection scan. CreateMany
        // is idempotent, so declaring it at startup keeps the index in step with the code.
        Lots.Indexes.CreateMany(
        [
            new CreateIndexModel<Lot>(Builders<Lot>.IndexKeys.Ascending(l => l.CatalogueId)),
        ]);
    }

    public IMongoCollection<Catalogue> Catalogues => Database.GetCollection<Catalogue>("catalogues");
    public IMongoCollection<Lot> Lots => Database.GetCollection<Lot>("lots");
    public IMongoCollection<FilterPreset> FilterPresets => Database.GetCollection<FilterPreset>("filterPresets");
    public IMongoCollection<ActualPrice> ActualPrices => Database.GetCollection<ActualPrice>("actualPrices");
    public IMongoCollection<SavedReport> SavedReports => Database.GetCollection<SavedReport>("savedReports");
}
