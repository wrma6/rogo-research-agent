import { useState } from "react";
import type { ResolvedFact } from "../answer.ts";

interface Message {
  role: "user" | "assistant";
  text: string;
  facts?: ResolvedFact[];
}

function Facts({ facts }: { facts: ResolvedFact[] }) {
  return (
    <details className="facts">
      <summary>Facts and references ({facts.length})</summary>
      <ul>
        {facts.map(({ claim, type, source }, i) => (
          <li key={i}>
            <div>
              {claim}
              {type === "calculated" && <span className="tag">Calculated</span>}
              {!source.verified && <span className="tag warning">Source not verified</span>}
            </div>
            {source.excerpt ? (
              <details className="source">
                <summary>
                  {source.label}
                  {source.date && `, ${source.date}`}
                </summary>
                <p>{source.excerpt}</p>
              </details>
            ) : (
              <div className="source">{source.label}</div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

const EXAMPLES = [
  "Compare Acme and Globex and tell me which one appears to be growing faster.",
  "What are the biggest risks Umbrella Health flags in its filings?",
  "How is Initech's subscription transition going?",
  "Which company in the universe is growing fastest?",
];

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(question: string) {
    if (!question.trim() || busy) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer ?? data.error, facts: data.facts },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Something went wrong: ${String(err)}` },
      ]);
    }

    setBusy(false);
  }

  return (
    <div className="app">
      <header>
        <h1>Rogo Research</h1>
        <p>Ask a question about a company in our coverage universe.</p>
      </header>

      <div className="transcript">
        {messages.length === 0 && (
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, i) => (
          <div key={i} className={`bubble ${message.role}`}>
            {message.text}
            {message.facts && message.facts.length > 0 && <Facts facts={message.facts} />}
          </div>
        ))}

        {busy && <div className="bubble assistant pending">Thinking…</div>}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a research question…"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}
