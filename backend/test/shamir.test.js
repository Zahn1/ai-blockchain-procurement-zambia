// Unit tests for Shamir key splitting (FR-BID-07): splitting the tender's opening key and wrapping bid keys for it.
import crypto from 'node:crypto';
import { tenderKeyPair, wrapKey, unwrapKey, splitKey, parseShare, shareHash, combineShares } from '../src/shamir.js';

describe('Wrapping bid keys for the tender', () => {
  test('a bid key wrapped with the public key comes back only with the private key', () => {
    const pair = tenderKeyPair();
    const bidKey = crypto.randomBytes(32);
    const wrapped = wrapKey(bidKey, pair.publicKey);
    expect(unwrapKey(wrapped, pair.privateKey).equals(bidKey)).toBe(true);
    expect(() => unwrapKey(wrapped, tenderKeyPair().privateKey)).toThrow(); // another tender's key
  });

  test('a changed wrapped key is detected', () => {
    const pair = tenderKeyPair();
    const wrapped = Buffer.from(wrapKey(crypto.randomBytes(32), pair.publicKey), 'base64');
    wrapped[wrapped.length - 1] ^= 1;
    expect(() => unwrapKey(wrapped.toString('base64'), pair.privateKey)).toThrow();
  });
});

describe('Splitting the opening key among the committee', () => {
  test('any quorum of shares rebuilds the key; fewer do not', async () => {
    const pair = tenderKeyPair();
    const shares = await splitKey(pair.privateKey, 3, 2, 'ZPPA/T/1');
    expect(shares).toHaveLength(3);
    for (const two of [[0, 1], [0, 2], [1, 2]]) {
      expect((await combineShares(two.map((i) => shares[i]), pair.publicKey)).equals(pair.privateKey)).toBe(true);
    }
    await expect(combineShares([shares[0]], pair.publicKey)).rejects.toThrow();
  });

  test('a quorum of 3 is not met by 2 shares, even though combining them gives a key', async () => {
    const pair = tenderKeyPair();
    const shares = await splitKey(pair.privateKey, 4, 3, 'ZPPA/T/1');
    await expect(combineShares(shares.slice(0, 2), pair.publicKey)).rejects.toThrow(/do not rebuild/);
    expect((await combineShares(shares.slice(1, 4), pair.publicKey)).equals(pair.privateKey)).toBe(true);
  });

  test('shares from another tender do not rebuild this one', async () => {
    const a = tenderKeyPair();
    const b = tenderKeyPair();
    const sharesB = await splitKey(b.privateKey, 2, 2, 'ZPPA/T/2');
    await expect(combineShares(sharesB, a.publicKey)).rejects.toThrow(/do not rebuild/);
  });

  test('a share reads back as tender, number and bytes; anything else is refused', async () => {
    const [share] = await splitKey(tenderKeyPair().privateKey, 2, 2, 'ZPPA/MOH/2026/0501');
    expect(parseShare(share)).toMatchObject({ reference: 'ZPPA/MOH/2026/0501', index: 1 });
    expect(shareHash(`  ${share}\n`)).toBe(shareHash(share));
    expect(() => parseShare('hello')).toThrow(/not a key share/);
  });
});
