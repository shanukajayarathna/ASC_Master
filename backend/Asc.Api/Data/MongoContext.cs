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
    }

    public IMongoCollection<Catalogue> Catalogues => Database.GetCollection<Catalogue>("catalogues");
    public IMongoCollection<Lot> Lots => Database.GetCollection<Lot>("lots");
    public IMongoCollection<FilterPreset> FilterPresets => Database.GetCollection<FilterPreset>("filterPresets");
    public IMongoCollection<ActualPrice> ActualPrices => Database.GetCollection<ActualPrice>("actualPrices");
    public IMongoCollection<SavedReport> SavedReports => Database.GetCollection<SavedReport>("savedReports");
}
