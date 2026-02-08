/**
 * Shared Nostr client utilities
 * 
 * Common patterns extracted from kai-agent-tools
 * Part of the "agent-utils" collaboration proposal with Nova
 * 
 * Author: Kai 🌊
 * Date: 2026-02-08
 */

import { SimplePool, nip19, finalizeEvent } from 'nostr-tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

// Ensure WebSocket is available globally
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default relays
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

/**
 * Load Nostr credentials from the standard location
 * @param {string} [credPath] - Optional custom path to credentials
 * @returns {{ privkey: Uint8Array | string, pubkey: string, npub: string, nsec: string }}
 */
export function loadCredentials(credPath) {
  const defaultPath = path.join(__dirname, '../../.credentials/nostr.json');
  const credsPath = credPath || defaultPath;
  
  if (!fs.existsSync(credsPath)) {
    throw new Error(`Credentials not found at ${credsPath}`);
  }
  
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
  
  return {
    privkey: creds.nsec ? nip19.decode(creds.nsec).data : creds.privkey,
    pubkey: creds.npub ? nip19.decode(creds.npub).data : creds.pubkey,
    npub: creds.npub,
    nsec: creds.nsec
  };
}

/**
 * Create a configured SimplePool with default relays
 * @param {string[]} [relays] - Optional custom relay list
 * @returns {SimplePool}
 */
export function createPool(relays = DEFAULT_RELAYS) {
  return new SimplePool();
}

/**
 * Publish an event to multiple relays with timeout
 * @param {SimplePool} pool
 * @param {string[]} relays
 * @param {object} event - Signed event
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{success: boolean, published: string[], failed: string[]}>}
 */
export async function publishWithRetry(pool, relays, event, timeoutMs = 5000) {
  const published = [];
  const failed = [];
  
  const promises = relays.map(async (relay) => {
    try {
      await Promise.race([
        pool.publish([relay], event),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ]);
      published.push(relay);
    } catch (e) {
      failed.push(relay);
    }
  });
  
  await Promise.allSettled(promises);
  
  return {
    success: published.length > 0,
    published,
    failed
  };
}

/**
 * Decode an npub or npub-like string to hex pubkey
 * @param {string} input - npub1... or hex pubkey
 * @returns {string} hex pubkey
 */
export function decodePubkey(input) {
  if (input.startsWith('npub1')) {
    return nip19.decode(input).data;
  }
  // Assume already hex
  return input;
}

/**
 * Encode a hex pubkey to npub
 * @param {string} hexPubkey
 * @returns {string} npub1...
 */
export function encodePubkey(hexPubkey) {
  return nip19.npubEncode(hexPubkey);
}

/**
 * Create and sign a kind 1 note
 * @param {string} content
 * @param {object} options
 * @param {string[]} [options.tags]
 * @param {Uint8Array|string} options.privkey
 * @returns {object} signed event
 */
export function createNote(content, { tags = [], privkey }) {
  const event = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  };
  
  return finalizeEvent(event, privkey);
}

/**
 * Fetch events with timeout
 * @param {SimplePool} pool
 * @param {string[]} relays
 * @param {object} filter
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<object[]>}
 */
export async function fetchEvents(pool, relays, filter, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const events = [];
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(events);
      }
    }, timeoutMs);
    
    pool.querySync(relays, filter).then((results) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(results);
      }
    }).catch(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(events);
      }
    });
  });
}

/**
 * Check if an event is from a known AI agent (has NIP-32 labels)
 * @param {object} event
 * @returns {boolean}
 */
export function hasAILabels(event) {
  if (!event.tags) return false;
  
  return event.tags.some(tag => 
    tag[0] === 'L' && tag[1] === 'nip32.ai'
  );
}

/**
 * Add NIP-32 AI labels to an event's tags
 * @param {string[][]} existingTags
 * @returns {string[][]}
 */
export function addAILabels(existingTags = []) {
  return [
    ...existingTags,
    ['L', 'nip32.ai'],
    ['l', 'ai-generated', 'nip32.ai'],
    ['l', 'claude', 'nip32.ai']
  ];
}

/**
 * Create reply tags for threading (NIP-10)
 * @param {string} replyToEventId - Event ID being replied to
 * @param {string} replyToPubkey - Pubkey of the author being replied to
 * @param {string} [rootEventId] - Optional root event ID for nested threads
 * @returns {string[][]} e and p tags for threading
 */
export function createReplyTags(replyToEventId, replyToPubkey, rootEventId = null) {
  const tags = [];
  
  if (rootEventId && rootEventId !== replyToEventId) {
    // Nested reply: root is different from immediate parent
    tags.push(['e', rootEventId, '', 'root']);
    tags.push(['e', replyToEventId, '', 'reply']);
  } else {
    // Direct reply or first-level reply
    tags.push(['e', replyToEventId, '', 'root']);
  }
  
  // Always tag the person being replied to
  tags.push(['p', replyToPubkey]);
  
  return tags;
}

/**
 * Decode an nevent to get event ID and optional relay hints
 * @param {string} nevent - nevent1... string
 * @returns {{ id: string, relays?: string[], author?: string }}
 */
export function decodeNevent(nevent) {
  if (!nevent.startsWith('nevent1')) {
    throw new Error('Invalid nevent format');
  }
  
  const decoded = nip19.decode(nevent);
  return {
    id: decoded.data.id,
    relays: decoded.data.relays,
    author: decoded.data.author
  };
}

/**
 * Encode an event ID to nevent with optional relay hints
 * @param {string} eventId
 * @param {string[]} [relays]
 * @param {string} [author]
 * @returns {string} nevent1...
 */
export function encodeNevent(eventId, relays = [], author = null) {
  return nip19.neventEncode({
    id: eventId,
    relays: relays.length > 0 ? relays : undefined,
    author: author || undefined
  });
}

/**
 * Format a pubkey as a proper Nostr mention (nostr:npub1...)
 * For use in post content
 * @param {string} pubkeyOrNpub - hex pubkey or npub
 * @returns {string} nostr:npub1...
 */
export function formatMention(pubkeyOrNpub) {
  const npub = pubkeyOrNpub.startsWith('npub1') 
    ? pubkeyOrNpub 
    : encodePubkey(pubkeyOrNpub);
  return `nostr:${npub}`;
}

/**
 * Validate an npub checksum
 * @param {string} npub
 * @returns {boolean}
 */
export function validateNpub(npub) {
  try {
    if (!npub.startsWith('npub1')) return false;
    nip19.decode(npub);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Unix timestamp for Nostr events
 * @param {Date} [date] - Optional date, defaults to now
 * @returns {number}
 */
export function nostrTimestamp(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Resolve a NIP-05 identifier to a pubkey
 * @param {string} nip05 - user@domain.com format
 * @returns {Promise<{ pubkey: string, npub: string, relays?: string[] } | null>}
 */
export async function resolveNip05(nip05) {
  try {
    const [name, domain] = nip05.split('@');
    if (!name || !domain) return null;
    
    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const pubkey = data.names?.[name];
    
    if (!pubkey) return null;
    
    return {
      pubkey,
      npub: encodePubkey(pubkey),
      relays: data.relays?.[pubkey]
    };
  } catch {
    return null;
  }
}

/**
 * Extract mentions from content and resolve NIP-05s
 * @param {string} content
 * @returns {Promise<{ npubs: string[], resolved: Map<string, string> }>}
 */
export async function extractMentions(content) {
  const npubs = [];
  const resolved = new Map();
  
  // Match nostr:npub1... mentions
  const npubMatches = content.matchAll(/nostr:(npub1[a-z0-9]+)/g);
  for (const match of npubMatches) {
    if (validateNpub(match[1])) {
      npubs.push(match[1]);
    }
  }
  
  // Match @user@domain.com NIP-05 mentions
  const nip05Matches = content.matchAll(/@([a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
  for (const match of nip05Matches) {
    const result = await resolveNip05(match[1]);
    if (result) {
      resolved.set(match[1], result.npub);
      npubs.push(result.npub);
    }
  }
  
  return { npubs, resolved };
}

/**
 * Check if we've already replied to an event (dedup check)
 * @param {SimplePool} pool
 * @param {string[]} relays
 * @param {string} ourPubkey
 * @param {string} targetEventId
 * @returns {Promise<boolean>}
 */
export async function hasRepliedTo(pool, relays, ourPubkey, targetEventId) {
  const events = await fetchEvents(pool, relays, {
    kinds: [1],
    authors: [ourPubkey],
    '#e': [targetEventId],
    limit: 1
  }, 5000);
  
  return events.length > 0;
}

/**
 * Fetch a user's profile (kind 0)
 * @param {SimplePool} pool
 * @param {string[]} relays
 * @param {string} pubkeyOrNpub - hex pubkey or npub
 * @returns {Promise<{ name?: string, displayName?: string, about?: string, nip05?: string, picture?: string, banner?: string, lud16?: string } | null>}
 */
export async function fetchProfile(pool, relays, pubkeyOrNpub) {
  const pubkey = decodePubkey(pubkeyOrNpub);
  
  const events = await fetchEvents(pool, relays, {
    kinds: [0],
    authors: [pubkey],
    limit: 1
  }, 8000);
  
  if (events.length === 0) return null;
  
  try {
    const content = JSON.parse(events[0].content);
    return {
      name: content.name,
      displayName: content.display_name || content.displayName,
      about: content.about,
      nip05: content.nip05,
      picture: content.picture,
      banner: content.banner,
      lud16: content.lud16
    };
  } catch {
    return null;
  }
}

/**
 * Fetch recent notes from a user
 * @param {SimplePool} pool
 * @param {string[]} relays
 * @param {string} pubkeyOrNpub
 * @param {number} [limit=10]
 * @returns {Promise<Array<{ id: string, content: string, createdAt: Date, tags: string[][] }>>}
 */
export async function fetchUserNotes(pool, relays, pubkeyOrNpub, limit = 10) {
  const pubkey = decodePubkey(pubkeyOrNpub);
  
  const events = await fetchEvents(pool, relays, {
    kinds: [1],
    authors: [pubkey],
    limit
  }, 10000);
  
  return events
    .sort((a, b) => b.created_at - a.created_at)
    .map(e => ({
      id: e.id,
      content: e.content,
      createdAt: new Date(e.created_at * 1000),
      tags: e.tags
    }));
}

/**
 * Parse a zap receipt (kind 9735)
 * @param {object} event - Zap receipt event
 * @returns {{ sender: string, receiver: string, amountMsats: number, amountSats: number, content: string, bolt11: string } | null}
 */
export function parseZapReceipt(event) {
  if (event.kind !== 9735) return null;
  
  try {
    const pTag = event.tags.find(t => t[0] === 'p');
    const bolt11Tag = event.tags.find(t => t[0] === 'bolt11');
    const descriptionTag = event.tags.find(t => t[0] === 'description');
    
    let sender = null;
    let amountMsats = 0;
    
    if (descriptionTag) {
      const desc = JSON.parse(descriptionTag[1]);
      sender = desc.pubkey;
      
      // Parse amount from bolt11 if present
      if (bolt11Tag) {
        const match = bolt11Tag[1].match(/lnbc(\d+)([munp]?)/i);
        if (match) {
          let amount = parseInt(match[1]);
          const unit = match[2].toLowerCase();
          // Convert to msats
          if (unit === 'm') amountMsats = amount * 100000000;
          else if (unit === 'u') amountMsats = amount * 100000;
          else if (unit === 'n') amountMsats = amount * 100;
          else if (unit === 'p') amountMsats = amount / 10;
          else amountMsats = amount * 100000000000; // BTC
        }
      }
    }
    
    return {
      sender,
      receiver: pTag?.[1],
      amountMsats,
      amountSats: Math.floor(amountMsats / 1000),
      content: event.content,
      bolt11: bolt11Tag?.[1]
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a single event by ID
 * @param {SimplePool} pool
 * @param {string[]} relays
 * @param {string} eventId - hex event ID
 * @returns {Promise<object | null>}
 */
export async function fetchEventById(pool, relays, eventId) {
  const events = await fetchEvents(pool, relays, {
    ids: [eventId],
    limit: 1
  }, 8000);
  
  return events.length > 0 ? events[0] : null;
}

/**
 * Check if a string is a valid hex string
 * @param {string} str
 * @param {number} [expectedLength] - Optional expected length in characters
 * @returns {boolean}
 */
export function isHex(str, expectedLength = null) {
  if (typeof str !== 'string') return false;
  if (expectedLength !== null && str.length !== expectedLength) return false;
  return /^[0-9a-fA-F]+$/.test(str);
}

/**
 * Check if a string is a valid event ID (64 char hex)
 * @param {string} str
 * @returns {boolean}
 */
export function isValidEventId(str) {
  return isHex(str, 64);
}

/**
 * Check if a string is a valid pubkey (64 char hex)
 * @param {string} str
 * @returns {boolean}
 */
export function isValidPubkey(str) {
  return isHex(str, 64);
}

/**
 * Get a human-readable time ago string
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string}
 */
export function timeAgo(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Extract the root event ID from a reply event (NIP-10)
 * @param {object} event
 * @returns {string | null}
 */
export function getRootEventId(event) {
  if (!event.tags) return null;
  
  // First try to find explicit root marker
  const rootTag = event.tags.find(t => t[0] === 'e' && t[3] === 'root');
  if (rootTag) return rootTag[1];
  
  // Fallback: first e tag is root (deprecated but still used)
  const eTags = event.tags.filter(t => t[0] === 'e');
  return eTags.length > 0 ? eTags[0][1] : null;
}

/**
 * Extract the reply-to event ID from a reply event (NIP-10)
 * @param {object} event
 * @returns {string | null}
 */
export function getReplyToEventId(event) {
  if (!event.tags) return null;
  
  // First try to find explicit reply marker
  const replyTag = event.tags.find(t => t[0] === 'e' && t[3] === 'reply');
  if (replyTag) return replyTag[1];
  
  // Fallback: last e tag is reply-to (deprecated but still used)
  const eTags = event.tags.filter(t => t[0] === 'e');
  return eTags.length > 0 ? eTags[eTags.length - 1][1] : null;
}
