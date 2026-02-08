/**
 * Tests for nostr-client.mjs
 * 
 * Uses Node.js built-in test runner (no extra dependencies).
 * Run: node --test test/nostr-client.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodePubkey,
  encodePubkey,
  validateNpub,
  formatMention,
  nostrTimestamp,
  isHex,
  isValidEventId,
  isValidPubkey,
  timeAgo,
  addAILabels,
  hasAILabels,
  createReplyTags,
  getRootEventId,
  getReplyToEventId,
  decodeNevent,
  encodeNevent,
  parseLightningAddress,
  isBolt11Invoice,
  isLightningAddress,
  parseZapReceipt,
  isAddressedToMe,
  DEFAULT_RELAYS,
} from '../index.mjs';

// ============================================================
// Hex / Validation helpers
// ============================================================

describe('isHex', () => {
  it('accepts valid hex strings', () => {
    assert.equal(isHex('abcdef0123456789'), true);
    assert.equal(isHex('ABCDEF'), true);
    assert.equal(isHex('0'), true);
  });

  it('rejects non-hex strings', () => {
    assert.equal(isHex('xyz'), false);
    assert.equal(isHex('abcg'), false);
    assert.equal(isHex(''), false);
  });

  it('checks expected length', () => {
    assert.equal(isHex('abcd', 4), true);
    assert.equal(isHex('abcd', 5), false);
  });

  it('rejects non-strings', () => {
    assert.equal(isHex(123), false);
    assert.equal(isHex(null), false);
    assert.equal(isHex(undefined), false);
  });
});

describe('isValidEventId', () => {
  it('accepts 64-char hex', () => {
    assert.equal(isValidEventId('a'.repeat(64)), true);
  });

  it('rejects wrong length', () => {
    assert.equal(isValidEventId('a'.repeat(63)), false);
    assert.equal(isValidEventId('a'.repeat(65)), false);
  });
});

describe('isValidPubkey', () => {
  it('accepts 64-char hex', () => {
    assert.equal(isValidPubkey('b'.repeat(64)), true);
  });

  it('rejects wrong length', () => {
    assert.equal(isValidPubkey('b'.repeat(32)), false);
  });
});

// ============================================================
// NIP-19 encoding / decoding
// ============================================================

describe('decodePubkey / encodePubkey', () => {
  // Well-known test vector: all-zeros pubkey
  const hexPubkey = '0000000000000000000000000000000000000000000000000000000000000001';

  it('encodes hex to npub and back', () => {
    const npub = encodePubkey(hexPubkey);
    assert.ok(npub.startsWith('npub1'));
    const decoded = decodePubkey(npub);
    assert.equal(decoded, hexPubkey);
  });

  it('passes through hex input unchanged', () => {
    assert.equal(decodePubkey(hexPubkey), hexPubkey);
  });
});

describe('validateNpub', () => {
  const hexPubkey = '0000000000000000000000000000000000000000000000000000000000000001';

  it('validates a correct npub', () => {
    const npub = encodePubkey(hexPubkey);
    assert.equal(validateNpub(npub), true);
  });

  it('rejects invalid npub', () => {
    assert.equal(validateNpub('npub1invalid'), false);
    assert.equal(validateNpub('notannpub'), false);
    assert.equal(validateNpub(''), false);
  });
});

describe('formatMention', () => {
  const hexPubkey = '0000000000000000000000000000000000000000000000000000000000000001';

  it('formats hex pubkey as nostr:npub mention', () => {
    const mention = formatMention(hexPubkey);
    assert.ok(mention.startsWith('nostr:npub1'));
  });

  it('formats npub as nostr:npub mention', () => {
    const npub = encodePubkey(hexPubkey);
    const mention = formatMention(npub);
    assert.equal(mention, `nostr:${npub}`);
  });
});

describe('encodeNevent / decodeNevent', () => {
  const eventId = 'a'.repeat(64);
  const relays = ['wss://relay.damus.io'];

  it('round-trips nevent encoding', () => {
    const nevent = encodeNevent(eventId, relays);
    assert.ok(nevent.startsWith('nevent1'));
    
    const decoded = decodeNevent(nevent);
    assert.equal(decoded.id, eventId);
    assert.ok(Array.isArray(decoded.relays));
  });

  it('throws on invalid nevent', () => {
    assert.throws(() => decodeNevent('notanevent'));
  });
});

// ============================================================
// Timestamp
// ============================================================

describe('nostrTimestamp', () => {
  it('returns current unix timestamp in seconds', () => {
    const ts = nostrTimestamp();
    const expected = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(ts - expected) <= 1);
  });

  it('converts a specific date', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const ts = nostrTimestamp(date);
    assert.equal(ts, Math.floor(date.getTime() / 1000));
  });
});

// ============================================================
// timeAgo
// ============================================================

describe('timeAgo', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(timeAgo(now), 'just now');
    assert.equal(timeAgo(now - 30), 'just now');
  });

  it('returns minutes ago', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.match(timeAgo(now - 120), /2m ago/);
  });

  it('returns hours ago', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.match(timeAgo(now - 7200), /2h ago/);
  });

  it('returns days ago', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.match(timeAgo(now - 172800), /2d ago/);
  });
});

// ============================================================
// NIP-32 AI Labels
// ============================================================

describe('addAILabels', () => {
  it('adds AI labels to empty tags', () => {
    const tags = addAILabels();
    assert.ok(tags.some(t => t[0] === 'L' && t[1] === 'nip32.ai'));
    assert.ok(tags.some(t => t[0] === 'l' && t[1] === 'ai-generated'));
  });

  it('preserves existing tags', () => {
    const existing = [['t', 'bitcoin']];
    const tags = addAILabels(existing);
    assert.ok(tags.some(t => t[0] === 't' && t[1] === 'bitcoin'));
    assert.ok(tags.some(t => t[0] === 'L' && t[1] === 'nip32.ai'));
  });
});

describe('hasAILabels', () => {
  it('detects AI labels', () => {
    const event = { tags: [['L', 'nip32.ai'], ['l', 'ai-generated', 'nip32.ai']] };
    assert.equal(hasAILabels(event), true);
  });

  it('returns false for events without AI labels', () => {
    const event = { tags: [['t', 'bitcoin']] };
    assert.equal(hasAILabels(event), false);
  });

  it('handles missing tags', () => {
    assert.equal(hasAILabels({}), false);
    assert.equal(hasAILabels({ tags: null }), false);
  });
});

// ============================================================
// NIP-10 Threading
// ============================================================

describe('createReplyTags', () => {
  const eventId = 'a'.repeat(64);
  const pubkey = 'b'.repeat(64);
  const rootId = 'c'.repeat(64);

  it('creates direct reply tags', () => {
    const tags = createReplyTags(eventId, pubkey);
    assert.ok(tags.some(t => t[0] === 'e' && t[1] === eventId && t[3] === 'root'));
    assert.ok(tags.some(t => t[0] === 'p' && t[1] === pubkey));
  });

  it('creates nested reply tags with root', () => {
    const tags = createReplyTags(eventId, pubkey, rootId);
    assert.ok(tags.some(t => t[0] === 'e' && t[1] === rootId && t[3] === 'root'));
    assert.ok(tags.some(t => t[0] === 'e' && t[1] === eventId && t[3] === 'reply'));
    assert.ok(tags.some(t => t[0] === 'p' && t[1] === pubkey));
  });
});

describe('getRootEventId', () => {
  it('extracts root from marked tags', () => {
    const event = {
      tags: [
        ['e', 'root123', '', 'root'],
        ['e', 'reply456', '', 'reply'],
      ]
    };
    assert.equal(getRootEventId(event), 'root123');
  });

  it('falls back to first e-tag', () => {
    const event = {
      tags: [
        ['e', 'first'],
        ['e', 'second'],
      ]
    };
    assert.equal(getRootEventId(event), 'first');
  });

  it('returns null when no e-tags', () => {
    assert.equal(getRootEventId({ tags: [] }), null);
    assert.equal(getRootEventId({}), null);
  });
});

describe('getReplyToEventId', () => {
  it('extracts reply from marked tags', () => {
    const event = {
      tags: [
        ['e', 'root123', '', 'root'],
        ['e', 'reply456', '', 'reply'],
      ]
    };
    assert.equal(getReplyToEventId(event), 'reply456');
  });

  it('falls back to last e-tag', () => {
    const event = {
      tags: [
        ['e', 'first'],
        ['e', 'second'],
      ]
    };
    assert.equal(getReplyToEventId(event), 'second');
  });
});

// ============================================================
// Zap Receipt Parsing
// ============================================================

describe('parseZapReceipt', () => {
  it('parses a valid zap receipt', () => {
    const event = {
      kind: 9735,
      tags: [
        ['p', 'recipientpubkey123'],
        ['bolt11', 'lnbc210n1ptest'],
        ['description', JSON.stringify({
          pubkey: 'senderpubkey456',
          tags: []
        })],
      ],
      content: '',
    };
    
    const result = parseZapReceipt(event);
    assert.ok(result);
    assert.equal(result.sender, 'senderpubkey456');
    assert.equal(result.receiver, 'recipientpubkey123');
  });

  it('returns null for non-zap events', () => {
    const event = { kind: 1, tags: [], content: '' };
    assert.equal(parseZapReceipt(event), null);
  });
});

// ============================================================
// isAddressedToMe (thread awareness)
// ============================================================

describe('isAddressedToMe', () => {
  const myPubkey = 'a'.repeat(64);
  const otherPubkey = 'b'.repeat(64);

  it('recognizes root mention', () => {
    const event = {
      tags: [['p', myPubkey]],
    };
    const result = isAddressedToMe(event, myPubkey);
    assert.equal(result.addressed, true);
    assert.equal(result.reason, 'root_mention');
  });

  it('recognizes reply to my event', () => {
    const event = {
      tags: [
        ['e', 'someevent', '', 'root', myPubkey],
        ['p', myPubkey],
      ],
    };
    const result = isAddressedToMe(event, myPubkey);
    assert.equal(result.addressed, true);
    assert.equal(result.reason, 'reply_to_my_event');
  });

  it('filters out replies to others where we are just in p-tags', () => {
    const event = {
      tags: [
        ['e', 'someevent', '', 'root', otherPubkey],
        ['p', myPubkey],
        ['p', otherPubkey],
      ],
    };
    const result = isAddressedToMe(event, myPubkey);
    assert.equal(result.addressed, false);
    assert.equal(result.reason, 'reply_to_other');
  });

  it('errs on silence for ambiguous thread mentions', () => {
    const event = {
      tags: [
        ['e', 'someevent', '', 'root'],
        ['p', myPubkey],
      ],
    };
    const result = isAddressedToMe(event, myPubkey);
    assert.equal(result.addressed, false);
    assert.equal(result.reason, 'ambiguous_thread_mention');
  });

  it('returns not_mentioned when not tagged at all', () => {
    const event = {
      tags: [['t', 'bitcoin']],
    };
    const result = isAddressedToMe(event, myPubkey);
    assert.equal(result.addressed, false);
    assert.equal(result.reason, 'not_mentioned');
  });

  it('accepts replyToAuthor via options', () => {
    const event = {
      tags: [
        ['e', 'someevent', '', 'reply'],
        ['p', myPubkey],
      ],
    };
    const result = isAddressedToMe(event, myPubkey, { replyToAuthor: myPubkey });
    assert.equal(result.addressed, true);
    assert.equal(result.reason, 'reply_to_my_event');
  });
});

// ============================================================
// Lightning utilities
// ============================================================

describe('parseLightningAddress', () => {
  it('parses valid address', () => {
    const result = parseLightningAddress('user@domain.com');
    assert.deepEqual(result, { user: 'user', domain: 'domain.com' });
  });

  it('returns null for invalid address', () => {
    assert.equal(parseLightningAddress('notanaddress'), null);
    assert.equal(parseLightningAddress(''), null);
  });
});

describe('isBolt11Invoice', () => {
  it('recognizes mainnet invoice', () => {
    assert.equal(isBolt11Invoice('lnbc100n1ptest'), true);
  });

  it('recognizes testnet invoice', () => {
    assert.equal(isBolt11Invoice('lntb100n1ptest'), true);
  });

  it('recognizes regtest invoice', () => {
    assert.equal(isBolt11Invoice('lnbcrt100n1ptest'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(isBolt11Invoice('LNBC100n1ptest'), true);
  });

  it('rejects non-invoices', () => {
    assert.equal(isBolt11Invoice('bitcoin:bc1q...'), false);
    assert.equal(isBolt11Invoice('hello'), false);
  });
});

describe('isLightningAddress', () => {
  it('recognizes valid addresses', () => {
    assert.equal(isLightningAddress('user@domain.com'), true);
    assert.equal(isLightningAddress('nova@nostrcheck.me'), true);
  });

  it('rejects invalid addresses', () => {
    assert.equal(isLightningAddress('notanaddress'), false);
    assert.equal(isLightningAddress('@domain.com'), false);
  });
});

// ============================================================
// Constants
// ============================================================

describe('DEFAULT_RELAYS', () => {
  it('is a non-empty array of wss:// URLs', () => {
    assert.ok(Array.isArray(DEFAULT_RELAYS));
    assert.ok(DEFAULT_RELAYS.length > 0);
    for (const relay of DEFAULT_RELAYS) {
      assert.ok(relay.startsWith('wss://'), `Expected wss:// URL, got: ${relay}`);
    }
  });
});