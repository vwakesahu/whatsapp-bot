// Exact-match greetings (lowercase)
const EXACT_GREETINGS = new Set([
  'hi', 'hey', 'hello', 'hola', 'yo', 'sup', 'howdy',
  'hii', 'hiii', 'heyo', 'heya', 'heyy', 'helloo', 'hellooo',
  'namaste', 'namaskar', 'wassup', 'whatsup',
]);

// Regex patterns for stretched greetings — must match the ENTIRE token
const STRETCHED_PATTERNS: RegExp[] = [
  /^h+i+$/,         // hii, hiiii, hhhiii
  /^h+e+l+l*o+$/,   // hellooo, helllooo
  /^h+e+y+$/,       // heyyy, heyy
  /^y+o+$/,         // yooo, yoooo
  /^s+u+p+$/,       // suuup
];

// Multi-word greeting phrases
const GREETING_PHRASES = [
  'good morning', 'good afternoon', 'good evening', 'good night',
  "what's up", 'whats up', 'wassup',
  'how are you', "how's it going", 'hows it going',
  'kya haal', 'kaise ho', 'kya chal raha',
];

function tokenize(text: string): string[] {
  // Split by whitespace and punctuation boundaries, keep words only
  return text
    .toLowerCase()
    .split(/[\s,;:!?.]+/)
    .map(t => t.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
    .filter(Boolean);
}

function isGreetingToken(token: string): boolean {
  if (EXACT_GREETINGS.has(token)) return true;
  return STRETCHED_PATTERNS.some(pattern => pattern.test(token));
}

export interface GreetingResult {
  isGreeting: boolean;
}

export function detectGreeting(text: string): GreetingResult {
  const trimmed = text.trim();
  if (!trimmed) return { isGreeting: false };

  const lower = trimmed.toLowerCase();

  // Check multi-word phrases first
  for (const phrase of GREETING_PHRASES) {
    if (lower.startsWith(phrase)) {
      return { isGreeting: true };
    }
  }

  // Tokenize and check each word independently
  const tokens = tokenize(trimmed);
  for (const token of tokens) {
    if (isGreetingToken(token)) {
      return { isGreeting: true };
    }
  }

  return { isGreeting: false };
}

// Only emojis, no actual text content
const EMOJI_ONLY_REGEX = /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}\s]+$/u;

export function isEmojiOnly(text: string): boolean {
  return EMOJI_ONLY_REGEX.test(text.trim());
}
