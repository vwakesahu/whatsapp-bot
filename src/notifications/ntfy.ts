import config from '../config.ts';
import type { ActionJson } from '../ai/claude.ts';

interface NotificationPayload {
  senderName: string;
  action: ActionJson;
}

function mapPriority(urgency: ActionJson['urgency'], needsMeeting: boolean): number {
  if (urgency === 'high') return 5;    // urgent — bypasses DND
  if (urgency === 'medium') return 4;  // high
  if (needsMeeting) return 3;          // default
  return 2;                            // low
}

export async function sendNotification({ senderName, action }: NotificationPayload): Promise<void> {
  if (!config.ntfyTopic) {
    console.warn('[ntfy] No topic configured, skipping notification');
    return;
  }

  const priority = mapPriority(action.urgency, action.needs_meeting);
  const tags = action.needs_meeting ? 'calendar,incoming_envelope' : 'incoming_envelope';
  const title = action.urgency === 'high'
    ? `URGENT: ${senderName}`
    : `Message from ${senderName}`;

  try {
    const url = `${config.ntfyServer}/${config.ntfyTopic}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: String(priority),
        Tags: tags,
      },
      body: action.summary || `New message from ${senderName}`,
    });

    if (!response.ok) {
      console.error('[ntfy] Failed to send:', response.status, await response.text());
    } else {
      console.log(`[ntfy] Notification sent: ${title} — ${action.summary}`);
    }
  } catch (error) {
    console.error('[ntfy] Error sending notification:', error);
  }
}
