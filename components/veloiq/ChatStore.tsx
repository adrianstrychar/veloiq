'use client';

// Stan czatu podniesiony NAD zakładki (provider w (app)/layout.tsx) — przeżywa nawigację między
// modułami, bo layout nie remontuje się przy zmianie zakładki (tylko segment strony). Zero bazy,
// zero endpointów: wątek żyje w pamięci sesji przeglądarki. TTL 30 min bezczynności → świeży start.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type PendingStatus = 'pending' | 'committed' | 'cancelled' | 'expired';

export interface PendingCard {
  change_id: string;
  kind: 'plan' | 'race';
  diff: string;
  status: PendingStatus;
  resultMsg?: string;
  busy?: boolean;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  pendings?: PendingCard[];
}

export interface Suggestion {
  label: string;
  prompt: string;
}

const TTL_MS = 30 * 60 * 1000; // 30 min bezczynności → wątek się kasuje przy następnym wejściu

interface ChatStoreValue {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  suggestions: Suggestion[];
  setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
  touch: () => void;       // odśwież znacznik aktywności (wysłanie / akcja pending)
  ensureFresh: () => void; // wejście na czat: wyczyść wątek+input, jeśli minęło > TTL bezczynności
}

const ChatContext = createContext<ChatStoreValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // 0 = brak aktywności (świeży draft nie wygasa, dopóki nic nie wysłano).
  const lastActivity = useRef<number>(0);

  // Stabilne tożsamości (useCallback []) — dzięki temu efekt ensureFresh w ChatPage jest mount-only,
  // a nie „co render". Referują tylko stabilne settery i ref.
  const touch = useCallback(() => { lastActivity.current = Date.now(); }, []);
  const ensureFresh = useCallback(() => {
    if (lastActivity.current && Date.now() - lastActivity.current > TTL_MS) {
      setMessages([]);
      setInput('');
      lastActivity.current = 0;
    }
  }, []);

  return (
    <ChatContext.Provider value={{ messages, setMessages, input, setInput, suggestions, setSuggestions, touch, ensureFresh }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatStore(): ChatStoreValue {
  const v = useContext(ChatContext);
  if (!v) throw new Error('useChatStore użyty poza <ChatProvider>');
  return v;
}
