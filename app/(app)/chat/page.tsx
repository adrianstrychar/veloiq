'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Błąd serwera');
        return;
      }

      setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
    } catch {
      setError('Nie udało się połączyć z serwerem');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    // 100vh − dolna nawigacja (5rem, pb-20 layoutu) − pionowy padding main (2rem, py-4)
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <header className="py-3 text-center border-b border-border">
        <span className="font-bold text-sm">Chat z trenerem AI</span>
      </header>

      {/* Lista wiadomości */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-secondary text-sm text-center mt-8">
            Napisz do swojego AI trenera — zapytaj o plan, formę lub ostatni trening.
          </p>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
              m.role === 'user'
                ? 'self-end bg-accent text-background whitespace-pre-wrap'
                : 'self-start bg-card border border-border text-foreground prose prose-invert prose-sm max-w-none'
            }`}
          >
            {m.role === 'user' ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
          </div>
        ))}

        {loading && (
          <div className="self-start bg-card border border-border rounded-2xl px-4 py-3 text-sm text-secondary">
            Trener pisze…
          </div>
        )}

        {error && (
          <p className="text-center text-sm" style={{ color: '#FF4757' }}>
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 flex gap-2 items-end border-t border-border pt-3">
        <textarea
          className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm resize-none"
          rows={2}
          placeholder="Napisz wiadomość… (Enter = wyślij, Shift+Enter = nowa linia)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="bg-accent text-background text-sm font-semibold rounded-xl px-4 py-2 disabled:opacity-40 shrink-0"
        >
          Wyślij
        </button>
      </div>
    </div>
  );
}
