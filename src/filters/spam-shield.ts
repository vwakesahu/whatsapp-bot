import config from '../config.ts';
import { isBlacklisted, recordSpamTrigger, getOrCreateContact } from '../db/sqlite.ts';
import type { Message } from 'whatsapp-web.js';

export type SpamVerdict = 'ok' | 'rate_limited' | 'silenced' | 'blacklisted' | 'forwarded' | 'link_spam' | 'media_only';

interface SenderRecord {
  timestamps: number[];
  silencedUntil: number;
}

// In-memory rate tracking (resets on restart — fine for this use case)
const senderMap = new Map<string, SenderRecord>();

function getSenderRecord(phone: string): SenderRecord {
  let record = senderMap.get(phone);
  if (!record) {
    record = { timestamps: [], silencedUntil: 0 };
    senderMap.set(phone, record);
  }
  return record;
}

function checkRateLimit(phone: string): SpamVerdict {
  const record = getSenderRecord(phone);
  const now = Date.now();

  // Currently silenced?
  if (record.silencedUntil > now) {
    return 'silenced';
  }

  // Slide the window — keep only timestamps within the window
  const windowMs = config.rateLimit.windowSeconds * 1000;
  record.timestamps = record.timestamps.filter(t => now - t < windowMs);
  record.timestamps.push(now);

  if (record.timestamps.length > config.rateLimit.maxMessages) {
    // Trigger rate limit
    record.silencedUntil = now + config.rateLimit.silenceMinutes * 60 * 1000;
    const wasBlacklisted = recordSpamTrigger(phone);
    return wasBlacklisted ? 'blacklisted' : 'rate_limited';
  }

  return 'ok';
}

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/i;

export function checkSpam(message: Message): SpamVerdict {
  const phone = message.from;
  const body = (message.body ?? '').trim();

  // Check blacklist first
  if (isBlacklisted(phone)) return 'blacklisted';

  // Rate limit
  const rateResult = checkRateLimit(phone);
  if (rateResult !== 'ok') return rateResult;

  // Forwarded message from unknown
  if (message.isForwarded) {
    const contact = getOrCreateContact(phone);
    // Known whitelisted contacts: let it slide with no AI processing
    // Unknown contacts: ignore entirely
    return contact.is_whitelisted ? 'forwarded' : 'forwarded';
  }

  // Link from unknown sender as first message
  if (URL_REGEX.test(body)) {
    const contact = getOrCreateContact(phone);
    if (!contact.is_whitelisted && !contact.name) {
      return 'link_spam';
    }
  }

  // Media only (no text)
  if (!body && message.hasMedia) {
    return 'media_only';
  }

  return 'ok';
}

export function getSpamReply(verdict: SpamVerdict): string | null {
  switch (verdict) {
    case 'rate_limited':
      return "Hey, I'll get back to you shortly.";
    case 'forwarded':
      return 'Noted 👍';
    case 'media_only':
      return '👍';
    default:
      return null; // silenced, blacklisted, link_spam → no reply
  }
}
