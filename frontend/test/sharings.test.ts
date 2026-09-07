import { buildSharingIndex, sharingKey, sharingsFor, sharingsInOtherSale } from "@/lib/sharings";
import type { Lot } from "@/types/api";

function lot(id: string, broker: string, lotNumber: string, mark = "Garden A", grade = "BOP"): Lot {
  return {
    id,
    rowKey: id,
    lotNumber,
    broker,
    grade,
    garden: null,
    category: null,
    elevation: null,
    region: null,
    warehouse: null,
    mark: null,
    saleNo: "12",
    saleYear: "2026",
    invoiceNo: null,
    netWeight: null,
    grossWeight: null,
    rawData: { SellingMark: mark },
    valuation: null,
  };
}

describe("sharing display data", () => {
  it("matches mark and grade case-insensitively and excludes incomplete lots", () => {
    const anchor = lot("anchor", "ASC", "10");
    const matching = lot("other", "BROKER", "2", " garden a ", "bop");
    const missingGrade = lot("missing", "BROKER", "3", "Garden A", "");

    expect(sharingKey(anchor)).toBe("GARDEN A||BOP");
    expect(buildSharingIndex([anchor, matching, missingGrade]).size).toBe(1);
    expect(sharingsFor(buildSharingIndex([anchor, matching]), anchor)).toEqual([matching]);
  });

  it("orders ASC first, then broker and lot number, including across another sale", () => {
    const anchor = lot("anchor", "BROKER-Z", "20");
    const asc = lot("asc", "ASC", "99");
    const brokerA = lot("a", "BROKER-A", "10");
    const brokerAEarlier = lot("a-earlier", "BROKER-A", "2");

    expect(sharingsFor(buildSharingIndex([anchor, brokerA, asc, brokerAEarlier]), anchor).map((x) => x.id))
      .toEqual(["asc", "a-earlier", "a"]);
    expect(sharingsInOtherSale(anchor, [brokerA, asc]).map((x) => x.id)).toEqual(["asc", "a"]);
  });
});
