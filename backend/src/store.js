// Off-chain records the pages need (tender titles, file names, IPFS CIDs), in PostgreSQL.
// The ledger stays the record of truth for hashes, times and statuses.

const tenderView = (t) => ({
  reference: t.reference, title: t.title, fileName: t.fileName, docHash: t.docHash, cid: t.cid,
  closingTime: t.closingTime.toISOString().replace(/\.\d{3}Z$/, 'Z'), txId: t.txId, block: t.block,
  publishedAt: t.createdAt.toISOString(),
});

export function dbStore(db) {
  return {
    async addTender(t) {
      await db.tender.create({ data: {
        reference: t.reference, title: t.title, fileName: t.fileName, docHash: t.docHash, cid: t.cid,
        closingTime: new Date(t.closingTime), txId: t.txId, block: t.block, publishedById: t.publishedById,
      } });
    },
    async listTenders() {
      return (await db.tender.findMany({ orderBy: { createdAt: 'desc' } })).map(tenderView);
    },
    async getTender(reference) {
      const t = await db.tender.findUnique({ where: { reference } });
      return t ? tenderView(t) : null;
    },
    async addBid(b) {
      await db.bid.create({ data: {
        bidId: b.bidId, tenderRef: b.tenderId, supplierId: b.supplierId, supplierRef: b.supplierRef,
        fileName: b.fileName, cid: b.cid, cipherHash: b.cipherHash, txId: b.txId, submittedAt: new Date(b.submittedAt),
      } });
    },
  };
}
