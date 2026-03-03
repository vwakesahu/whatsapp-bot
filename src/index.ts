import { initDB, closeStaleConversations, isWhitelisted } from './db/sqlite.ts';
import { initWhatsApp } from './whatsapp.ts';
import { shouldProcess } from './filters/group-filter.ts';
import { checkSpam, getSpamReply } from './filters/spam-shield.ts';
import { detectGreeting, isEmojiOnly } from './filters/greeting.ts';
import { getPersonalSystemPrompt, getIskconSystemPrompt } from './ai/prompts.ts';
import {
  getOrCreateConversationContext,
  recordUserMessage,
  recordAssistantMessage,
} from './ai/conversation.ts';
import { getResponse, type ActionJson } from './ai/claude.ts';
import { sendNotification } from './notifications/ntfy.ts';
import { updateConversationStatus } from './db/sqlite.ts';
import config from './config.ts';
import type { Message } from 'whatsapp-web.js';

// --- Initialize ---

console.log('[gatekeeper] Starting WhatsApp AI Gatekeeper...');
initDB();
console.log('[gatekeeper] Database initialized');

// Stale conversation cleanup
setInterval(() => {
  const closed = closeStaleConversations();
  if (closed > 0) console.log(`[gatekeeper] Closed ${closed} stale conversations`);
}, config.conversation.cleanupIntervalMs);

// --- Message Pipeline ---

async function handleMessage(message: Message): Promise<void> {
  const body = (message.body ?? '').trim();
  const senderId = message.from;

  // LAYER 0: Channel filter (groups, own messages, status/stories)
  const { process: shouldContinue, isIskcon } = shouldProcess(message);
  if (!shouldContinue) return;

  const contact = await message.getContact();
  const senderName = contact?.pushname ?? contact?.name ?? senderId;
  console.log(`[gatekeeper] Message from ${senderName} (${senderId}): ${body.slice(0, 80)}`);

  // ISKCON group — separate flow
  if (isIskcon) {
    await handleIskconMessage(message, body, senderName);
    return;
  }

  // LAYER 1: Spam shield
  const spamVerdict = checkSpam(message);
  if (spamVerdict !== 'ok') {
    console.log(`[gatekeeper] Spam filtered: ${spamVerdict}`);
    const reply = getSpamReply(spamVerdict);
    if (reply) await message.reply(reply);
    return;
  }

  // Skip emoji-only messages
  if (body && isEmojiOnly(body)) {
    console.log('[gatekeeper] Emoji-only message, skipping');
    return;
  }

  // Skip empty messages (media with no text)
  if (!body) {
    console.log('[gatekeeper] Empty body (media only), skipping');
    return;
  }

  // LAYER 2: Conversation context
  const ctx = getOrCreateConversationContext(senderId, senderName);

  // If conversation is paused (Vivek is handling it), don't auto-reply
  if (ctx.conversation.status === 'paused') {
    console.log(`[gatekeeper] Conversation paused for ${senderName}, skipping auto-reply`);
    // Still notify for new messages in paused conversations
    await sendNotification({
      senderName,
      action: { notify: true, urgency: 'medium', needs_meeting: false, summary: `Follow-up: ${body.slice(0, 100)}`, mode: 'paused' },
    });
    return;
  }

  // Greeting detection (shapes response, doesn't block)
  const greeting = detectGreeting(body);
  if (greeting.isGreeting) {
    console.log('[gatekeeper] Greeting detected');
  }

  // LAYER 3: Claude
  const whitelisted = isWhitelisted(senderId);

  // Record user message
  recordUserMessage(ctx.conversation.id, body);

  // Get Claude response
  const systemPrompt = getPersonalSystemPrompt();
  const { reply, action } = await getResponse(ctx.history, systemPrompt, body);

  // Force notify for whitelisted contacts
  const finalAction: ActionJson = whitelisted
    ? { ...action, notify: true, urgency: action.urgency === 'none' ? 'medium' : action.urgency }
    : action;

  // Record assistant response
  recordAssistantMessage(ctx.conversation.id, reply, JSON.stringify(finalAction));

  // Send reply on WhatsApp
  await message.reply(reply);
  console.log(`[gatekeeper] Replied to ${senderName}: ${reply.slice(0, 80)}`);

  // If paused mode — mark conversation so bot stops replying to this sender
  if (finalAction.mode === 'paused') {
    updateConversationStatus(ctx.conversation.id, 'paused');
    console.log(`[gatekeeper] Conversation PAUSED for ${senderName} — Vivek takes over`);
  }

  // Send notification if needed
  if (finalAction.notify) {
    await sendNotification({ senderName, action: finalAction });
  }

  console.log(`[gatekeeper] Action: notify=${finalAction.notify}, urgency=${finalAction.urgency}, mode=${finalAction.mode}`);
}

async function handleIskconMessage(message: Message, body: string, senderName: string): Promise<void> {
  console.log(`[gatekeeper] ISKCON✨ mention from ${senderName}`);

  const systemPrompt = getIskconSystemPrompt();
  const { reply, action } = await getResponse([], systemPrompt, body);

  await message.reply(reply);
  console.log(`[gatekeeper] ISKCON reply: ${reply.slice(0, 80)}`);

  if (action.notify) {
    await sendNotification({ senderName: `ISKCON✨ — ${senderName}`, action });
  }
}

// --- Start ---

const client = initWhatsApp(handleMessage);

client.initialize().then(() => {
  console.log('[gatekeeper] WhatsApp client initializing...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[gatekeeper] Shutting down...');
  await client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[gatekeeper] Shutting down...');
  await client.destroy();
  process.exit(0);
});
