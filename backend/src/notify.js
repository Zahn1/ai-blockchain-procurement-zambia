// E-mail and SMS notifications for key events (Chapter 3, 3.5.10): tender publication, bid receipt,
// contract award and payment. Sent after the action has succeeded; a failed delivery never undoes the action.
// Every attempt is logged in the Notification table.

const zmw = (ngwee) => `K${(Number(ngwee) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
const lusaka = (d) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lusaka' });

/** SMS gateway client (the stand-in, or a real gateway behind the same URL). */
export function smsClient({ url, fetchImpl = fetch }) {
  return {
    async send(to, message) {
      const res = await fetchImpl(`${url}/api/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, message }), signal: AbortSignal.timeout(10_000) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `SMS gateway returned ${res.status}`);
      return body.messageId;
    },
  };
}

export function createNotifier({ db, mailer, sms, from }) {
  const pending = new Set();

  async function log(data) {
    await db.notification.create({ data });
  }

  async function deliver(event, user, { subject, text, sms: smsText }) {
    try {
      const info = await mailer.sendMail({ from, to: user.email, subject, text });
      await log({ event, channel: 'EMAIL', recipient: user.email, subject, body: text, status: 'SENT', providerRef: info?.messageId ?? null });
    } catch (err) {
      await log({ event, channel: 'EMAIL', recipient: user.email, subject, body: text, status: 'FAILED', error: err.message });
    }
    if (!user.phone) return;
    try {
      const ref = await sms.send(user.phone, smsText);
      await log({ event, channel: 'SMS', recipient: user.phone, body: smsText, status: 'SENT', providerRef: ref });
    } catch (err) {
      await log({ event, channel: 'SMS', recipient: user.phone, body: smsText, status: 'FAILED', error: err.message });
    }
  }

  /** Runs delivery in the background; flush() waits for it (used by tests and on shutdown). */
  function background(work) {
    const p = work().catch((err) => console.error('notification error:', err));
    pending.add(p);
    p.finally(() => pending.delete(p));
  }

  const activeUsersOf = (supplierRef) => db.user.findMany({
    where: { status: 'ACTIVE', supplier: { supplierRef, status: 'VERIFIED' } } });

  return {
    flush: () => Promise.all([...pending]),

    /** A new tender: every active user of a verified supplier. */
    tenderPublished(t) {
      background(async () => {
        const users = await db.user.findMany({ where: { role: 'SUPPLIER', status: 'ACTIVE', supplier: { status: 'VERIFIED' } } });
        for (const u of users) {
          await deliver('TENDER_PUBLISHED', u, {
            subject: `New tender: ${t.reference} ${t.title}`,
            text: `A new tender has been published.\n\n${t.title}\nReference: ${t.reference}\nCloses: ${lusaka(t.closingTime)} (Lusaka time)\n\nSign in to submit a sealed bid before the closing time.`,
            sms: `New tender ${t.reference}: ${t.title}. Closes ${lusaka(t.closingTime)}.`,
          });
        }
      });
    },

    /** A sealed bid recorded on the ledger: the bidder who submitted it. */
    bidReceived(user, receipt) {
      background(() => deliver('BID_RECEIVED', user, {
        subject: `Bid received for ${receipt.tenderId}`,
        text: `Your sealed bid has been recorded on the ledger.\n\nBid: ${receipt.bidId}\nTender: ${receipt.tenderId}\nSubmitted: ${lusaka(receipt.submittedAt)} (Lusaka time)\nLedger transaction: ${receipt.txId}\nFingerprint of your encrypted bid: ${receipt.cipherHash}\n\nKeep your signed receipt as proof of on-time submission.`,
        sms: `Bid ${receipt.bidId} for ${receipt.tenderId} received ${lusaka(receipt.submittedAt)}. Tx ${receipt.txId.slice(0, 12)}.`,
      }));
    },

    /** A contract awarded: the users of the winning company. */
    contractAwarded(c, title) {
      background(async () => {
        for (const u of await activeUsersOf(c.supplierRef)) {
          await deliver('CONTRACT_AWARDED', u, {
            subject: `Contract awarded: ${c.tenderRef}`,
            text: `Your bid ${c.bidId} for ${title} (${c.tenderRef}) has been awarded.\n\nContract: ${c.awardId}\nValue: ${zmw(c.amountNgwee)}\nThe contract can be signed after the standstill period, which ends ${lusaka(c.standstillEnds)} (Lusaka time).`,
            sms: `Awarded: ${c.tenderRef}, contract ${c.awardId}, ${zmw(c.amountNgwee)}.`,
          });
        }
      });
    },

    /** A payment made through IFMIS: the users of the paid company. */
    paymentMade(c, m, ifmisRef) {
      background(async () => {
        for (const u of await activeUsersOf(c.supplierRef)) {
          await deliver('PAYMENT_MADE', u, {
            subject: `Payment made: ${c.awardId} ${m.milestoneId}`,
            text: `A payment has been made for contract ${c.awardId}.\n\nMilestone: ${m.milestoneId} ${m.description}\nAmount: ${zmw(m.amountNgwee)}\nIFMIS reference: ${ifmisRef}`,
            sms: `Paid ${zmw(m.amountNgwee)} for ${c.awardId} ${m.milestoneId}. IFMIS ${ifmisRef}.`,
          });
        }
      });
    },
  };
}
