using Asc.Api.Models;
using Asc.Api.Modules.ApiKeys;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Asc.Api.Modules.Deadlines;
using Asc.Api.Modules.Documents;
using Asc.Api.Modules.MasterData;
using Asc.Api.Modules.Msl;
using Asc.Api.Modules.Notifications;
using Asc.Api.Modules.Observability;
using Asc.Api.Modules.Webhooks;
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

        // Email is how a user logs in and how /register checks for an existing account —
        // must be unique. CreateMany is idempotent, same as the index above.
        Users.Indexes.CreateMany(
        [
            new CreateIndexModel<AppUser>(Builders<AppUser>.IndexKeys.Ascending(u => u.Email), new CreateIndexOptions { Unique = true }),
        ]);

        // Every chunk lookup/delete is scoped to its parent document.
        DocumentChunks.Indexes.CreateMany(
        [
            new CreateIndexModel<DocumentChunk>(Builders<DocumentChunk>.IndexKeys.Ascending(c => c.DocumentId)),
        ]);

        // Message history is always fetched per conversation, and conversation lists are
        // always scoped to the current user.
        ConversationMessages.Indexes.CreateMany(
        [
            new CreateIndexModel<ConversationMessage>(Builders<ConversationMessage>.IndexKeys.Ascending(m => m.ConversationId)),
        ]);
        Conversations.Indexes.CreateMany(
        [
            new CreateIndexModel<Conversation>(Builders<Conversation>.IndexKeys.Ascending(c => c.UserId)),
        ]);

        // The admin screen filters by entity type when reviewing/editing aliases.
        // MasterDataResolver loads every row into memory regardless (a few hundred rows at
        // most across nine types), so this index only serves that filtered list query.
        MasterDataEntities.Indexes.CreateMany(
        [
            new CreateIndexModel<MasterDataEntity>(Builders<MasterDataEntity>.IndexKeys.Ascending(e => e.Type)),
        ]);

        // The audit log view is always "most recent first" — nothing else queries this
        // collection.
        AuditLogs.Indexes.CreateMany(
        [
            new CreateIndexModel<AuditLogEntry>(Builders<AuditLogEntry>.IndexKeys.Descending(e => e.Timestamp)),
        ]);

        // Every real query here is "this user's unread notifications" or "this user's
        // notifications" — a compound index serves both.
        Notifications.Indexes.CreateMany(
        [
            new CreateIndexModel<Notification>(Builders<Notification>.IndexKeys.Ascending(n => n.UserId).Ascending(n => n.ReadAt)),
        ]);

        // DeadlineEngine upserts by (Type, EntityId) every check — a compound unique index
        // both makes that lookup cheap and guarantees the "one tracking row per entity"
        // invariant even under concurrent ticks.
        Deadlines.Indexes.CreateMany(
        [
            new CreateIndexModel<Deadline>(
                Builders<Deadline>.IndexKeys.Ascending(d => d.Type).Ascending(d => d.EntityId),
                new CreateIndexOptions { Unique = true }),
        ]);

        // The usage/cost summary endpoint always aggregates "last N days" — a descending
        // index on CreatedAt is all that query needs.
        AiUsageLogs.Indexes.CreateMany(
        [
            new CreateIndexModel<AiUsageLogEntry>(Builders<AiUsageLogEntry>.IndexKeys.Descending(e => e.CreatedAt)),
        ]);

        // MSL archive — millions of lot rows, so every filter the master search offers gets
        // an index: sale identity, the searchable name fields, buyer, and elevation. The
        // SourceFile index backs the idempotent per-file delete+reinsert on re-import.
        AuctionLots.Indexes.CreateMany(
        [
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Ascending(l => l.SaleYear).Ascending(l => l.SaleNo)),
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Ascending(l => l.SellingMark)),
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Ascending(l => l.EstateName)),
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Ascending(l => l.FactoryCode)),
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Ascending(l => l.BuyerCode)),
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Ascending(l => l.ElevationCode).Ascending(l => l.SaleYear)),
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Ascending(l => l.SourceFile)),
            new CreateIndexModel<AuctionLot>(Builders<AuctionLot>.IndexKeys.Descending(l => l.SaleDate)),
        ]);
        TeaBoardAverages.Indexes.CreateMany(
        [
            new CreateIndexModel<TeaBoardAverage>(Builders<TeaBoardAverage>.IndexKeys.Ascending(t => t.Year).Ascending(t => t.Month)),
            new CreateIndexModel<TeaBoardAverage>(Builders<TeaBoardAverage>.IndexKeys.Ascending(t => t.SourceFile)),
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

    public IMongoCollection<AppUser> Users => Database.GetCollection<AppUser>("users");

    public IMongoCollection<KnowledgeDocument> Documents => Database.GetCollection<KnowledgeDocument>("documents");
    public IMongoCollection<DocumentChunk> DocumentChunks => Database.GetCollection<DocumentChunk>("documentChunks");

    public IMongoCollection<Conversation> Conversations => Database.GetCollection<Conversation>("conversations");
    public IMongoCollection<ConversationMessage> ConversationMessages => Database.GetCollection<ConversationMessage>("conversationMessages");

    public IMongoCollection<ApiKey> ApiKeys => Database.GetCollection<ApiKey>("apiKeys");
    public IMongoCollection<WebhookSubscription> WebhookSubscriptions => Database.GetCollection<WebhookSubscription>("webhookSubscriptions");

    public IMongoCollection<MasterDataEntity> MasterDataEntities => Database.GetCollection<MasterDataEntity>("masterDataEntities");

    public IMongoCollection<AuditLogEntry> AuditLogs => Database.GetCollection<AuditLogEntry>("auditLogs");

    public IMongoCollection<Notification> Notifications => Database.GetCollection<Notification>("notifications");
    public IMongoCollection<Deadline> Deadlines => Database.GetCollection<Deadline>("deadlines");

    public IMongoCollection<AiUsageLogEntry> AiUsageLogs => Database.GetCollection<AiUsageLogEntry>("aiUsageLogs");

    /// <summary>The imported MSL archive — every auction + private-sale lot, 2013–present.</summary>
    public IMongoCollection<AuctionLot> AuctionLots => Database.GetCollection<AuctionLot>("auctionLots");
    public IMongoCollection<TeaBoardAverage> TeaBoardAverages => Database.GetCollection<TeaBoardAverage>("teaBoardAverages");
    public IMongoCollection<MslFileState> MslFiles => Database.GetCollection<MslFileState>("mslFiles");
}
