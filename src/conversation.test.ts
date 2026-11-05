import { describe, expect, it } from "vitest";
import type { ResolvedFact } from "./answer.ts";
import { historyToMessages, MAX_HISTORY_TURNS, parseConversation, type Turn } from "./conversation.ts";

const fact: ResolvedFact = {
  claim: "A claim",
  type: "reported",
  source: {
    type: "document",
    id: "DOC-ACME-001",
    label: "A title",
    date: "2026-02-18",
    excerpt: "A long document body",
    verified: true,
  },
};
const turn: Turn = { question: "Q", answer: "A [1]", facts: [fact] };

describe("parseConversation", () => {
  it("reads a valid conversation", () => {
    expect(parseConversation({ history: [turn], sources: ["document:DOC-ACME-001"] })).toEqual({
      history: [turn],
      sources: ["document:DOC-ACME-001"],
    });
  });

  it("treats a missing conversation as empty", () => {
    expect(parseConversation({})).toEqual({ history: [], sources: [] });
  });

  it("ignores malformed turns and sources", () => {
    const body = { history: [turn, { question: "Q" }, null, "nope"], sources: ["ok", 1, null] };
    expect(parseConversation(body)).toEqual({ history: [turn], sources: ["ok"] });
  });

  it("keeps only the most recent turns", () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 3 }, (_, i) => ({
      ...turn,
      question: `Q${i}`,
    }));
    const parsed = parseConversation({ history }).history;
    expect(parsed).toHaveLength(MAX_HISTORY_TURNS);
    expect(parsed.at(-1)?.question).toBe(`Q${MAX_HISTORY_TURNS + 2}`);
  });
});

describe("historyToMessages", () => {
  it("replays turns with source ids but without document bodies", () => {
    const messages = historyToMessages([turn]);
    expect(messages[0]).toEqual({ role: "user", content: "Q" });
    expect(messages[1].role).toBe("assistant");
    expect(JSON.parse(messages[1].content as string)).toEqual({
      answer: "A [1]",
      facts: [
        { claim: "A claim", type: "reported", sourceType: "document", sourceId: "DOC-ACME-001" },
      ],
    });
  });
});
