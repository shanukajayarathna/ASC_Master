namespace Asc.Api.Modules.MasterData;

/// <summary>
/// Every Lot field that names a business entity (as opposed to a measurement/status) rather
/// than nine near-identical bespoke tables — see MasterDataEntity's doc comment.
/// </summary>
public enum MasterDataEntityType
{
    Broker,
    Buyer,
    Garden,
    Grade,
    Category,
    Elevation,
    Region,
    Warehouse,
    Factory,
}
