import config from '../config.ts';
import type { Message } from 'whatsapp-web.js';

export interface GroupFilterResult {
  process: boolean;
  isIskcon: boolean;
}

export function shouldProcess(message: Message): GroupFilterResult {
  if (message.fromMe) {
    return { process: false, isIskcon: false };
  }

  const chatId = message.from;
  const isGroup = chatId.endsWith('@g.us');

  if (!isGroup) {
    return { process: true, isIskcon: false };
  }

  // Group message — only process ISKCON when Vivek is mentioned
  if (config.iskconGroupId && chatId === config.iskconGroupId) {
    const mentionedIds = message.mentionedIds ?? [];
    const isMentioned = mentionedIds.some(id => {
      const idStr = (id as any)?._serialized ?? id?.toString() ?? id;
      return idStr === config.myNumber;
    });
    if (isMentioned) {
      return { process: true, isIskcon: true };
    }
  }

  return { process: false, isIskcon: false };
}
