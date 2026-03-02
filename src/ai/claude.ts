import Anthropic from '@anthropic-ai/sdk';
import config from '../config.ts';
import type { MessageRow } from '../db/sqlite.ts';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export interface ActionJson {
  notify: boolean;
  urgency: 'high' | 'medium' | 'low' | 'none';
  needs_meeting: boolean;
  summary: string;
  mode: 'normal' | 'savage';
}

export interface ClaudeResponse {
  reply: string;
  action: ActionJson;
}

const ACTION_REGEX = /<!--ACTION:(.*?)-->/s;

const DEFAULT_ACTION: ActionJson = {
  notify: false,
  urgency: 'none',
  needs_meeting: false,
  summary: '',
  mode: 'normal',
};

const FALLBACK_REPLY = "Hey! Noted your message, Vivek will get back soon.";

export function parseActionJson(fullResponse: string): ClaudeResponse {
  const match = fullResponse.match(ACTION_REGEX);
  let action = { ...DEFAULT_ACTION };
  let reply = fullResponse;

  if (match) {
    reply = fullResponse.replace(ACTION_REGEX, '').trim();
    try {
      action = { ...DEFAULT_ACTION, ...JSON.parse(match[1]) };
    } catch {
      console.error('[claude] Failed to parse action JSON:', match[1]);
    }
  }

  return { reply, action };
}

export async function getResponse(
  history: MessageRow[],
  systemPrompt: string,
  newMessage: string
): Promise<ClaudeResponse> {
  try {
    const messages: Anthropic.MessageParam[] = [
      // Previous conversation history
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      // New incoming message
      { role: 'user' as const, content: newMessage },
    ];

    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 300,
      system: systemPrompt,
      messages,
    });

    const fullText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    return parseActionJson(fullText);
  } catch (error) {
    console.error('[claude] API error:', error);
    return {
      reply: FALLBACK_REPLY,
      action: { ...DEFAULT_ACTION },
    };
  }
}
