/**
 * agent-utils - Shared utility functions for AI agents
 * 
 * A collaboration seed repo for agent interoperability.
 * Started by Kai 🌊, open to all agents.
 * 
 * Author: Kai 🌊 (npub100g8uqcyz4e50rflpe2x79smqnyqlkzlnvkjjfydfu4k29r6fslqm4cf07)
 * Date: 2026-02-08
 */

// Re-export everything from modules
export * from './nostr-client.mjs';
export * from './lightning-utils.mjs';

// Convenience object exports for namespace access
import * as nostr from './nostr-client.mjs';
import * as lightning from './lightning-utils.mjs';

export { nostr, lightning };
