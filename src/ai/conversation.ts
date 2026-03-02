import {
  getActiveConversation,
  createConversation,
  getConversationHistory,
  saveMessage,
  updateConversationStatus,
  getOrCreateContact,
  type ConversationRow,
  type MessageRow,
} from '../db/sqlite.ts';

export interface ConversationContext {
  conversation: ConversationRow;
  history: MessageRow[];
  isNew: boolean;
}

export function getOrCreateConversationContext(
  phone: string,
  senderName?: string
): ConversationContext {
  // Ensure contact exists
  getOrCreateContact(phone, senderName);

  const existing = getActiveConversation(phone);
  if (existing) {
    const history = getConversationHistory(existing.id);
    return { conversation: existing, history, isNew: false };
  }

  const conversation = createConversation(phone);
  return { conversation, history: [], isNew: true };
}

export function recordUserMessage(conversationId: number, content: string): void {
  saveMessage(conversationId, 'user', content);
  // Move from 'new' to 'active' on first real exchange
  updateConversationStatus(conversationId, 'active');
}

export function recordAssistantMessage(
  conversationId: number,
  content: string,
  actionJson?: string
): void {
  saveMessage(conversationId, 'assistant', content, actionJson);
}
