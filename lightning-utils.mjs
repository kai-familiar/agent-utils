/**
 * Shared Lightning utilities
 * 
 * Common patterns for NWC wallet operations
 * Part of the "agent-utils" collaboration proposal with Nova
 * 
 * Author: Kai 🌊
 * Date: 2026-02-08
 */

import pkg from 'lightning-agent';
const { NWCWallet } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load NWC credentials from the standard location
 * @param {string} [credPath] - Optional custom path
 * @returns {{ nwc_url: string, lightning_address?: string, relay?: string, wallet_pubkey?: string }}
 */
export function loadNWCCredentials(credPath) {
  const defaultPath = path.join(__dirname, '../../.credentials/nwc.json');
  const credsPath = credPath || defaultPath;
  
  if (!fs.existsSync(credsPath)) {
    throw new Error(`NWC credentials not found at ${credsPath}`);
  }
  
  return JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
}

/**
 * Create an NWC wallet instance
 * @param {string} [nwcUrl] - Optional NWC URL, otherwise loads from credentials
 * @returns {NWCWallet}
 */
export function createWallet(nwcUrl) {
  const url = nwcUrl || loadNWCCredentials().nwc_url;
  return new NWCWallet(url);
}

/**
 * Get wallet balance
 * @param {NWCWallet} wallet
 * @returns {Promise<number>} Balance in sats
 */
export async function getBalance(wallet) {
  const result = await wallet.getBalance();
  return result.balanceSats;
}

/**
 * Create a Lightning invoice
 * @param {NWCWallet} wallet
 * @param {number} amountSats
 * @param {string} [description]
 * @returns {Promise<{ invoice: string, paymentHash: string }>}
 */
export async function createInvoice(wallet, amountSats, description = 'Payment') {
  return wallet.createInvoice({ amountSats, description });
}

/**
 * Pay a BOLT11 invoice
 * @param {NWCWallet} wallet
 * @param {string} invoice - BOLT11 invoice string
 * @returns {Promise<object>}
 */
export async function payInvoice(wallet, invoice) {
  return wallet.payInvoice(invoice);
}

/**
 * Send sats to a Lightning address
 * @param {NWCWallet} wallet
 * @param {string} address - Lightning address (user@domain)
 * @param {number} amountSats
 * @returns {Promise<object>}
 */
export async function sendToAddress(wallet, address, amountSats) {
  return wallet.payAddress(address, amountSats);
}

/**
 * Parse a Lightning address to extract user and domain
 * @param {string} address
 * @returns {{ user: string, domain: string } | null}
 */
export function parseLightningAddress(address) {
  const match = address.match(/^([^@]+)@([^@]+)$/);
  if (!match) return null;
  return { user: match[1], domain: match[2] };
}

/**
 * Check if a string looks like a BOLT11 invoice
 * @param {string} str
 * @returns {boolean}
 */
export function isBolt11Invoice(str) {
  const lower = str.toLowerCase();
  return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt');
}

/**
 * Check if a string looks like a Lightning address
 * @param {string} str
 * @returns {boolean}
 */
export function isLightningAddress(str) {
  return /^[^@]+@[^@]+\.[^@]+$/.test(str);
}
