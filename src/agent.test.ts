import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** One scripted model reply per request, in order. */
let replies: unknown[][] = [];
let requests = 0;

const respond = (content: unknown[]) =>
  new Response(
    JSON.stringify({
      id: `msg_${requests}`,
      type: "message",
      role: "assistant",
      model: "test",
      content,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const toolUse = (name: string, input: unknown) => ({
  type: "tool_use",
  id: `toolu_${name}`,
  name,
  input,
});

const text = (value: string) => ({ type: "text", text: value });

const financialsFact = (sourceId: string) => ({
  claim: "A claim",
  type: "reported",
  sourceType: "financials",
  sourceId,
});

let runAgent: typeof import("./agent.ts").runAgent;

beforeAll(async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => respond(replies[requests++])),
  );
  ({ runAgent } = await import("./agent.ts"));
});

beforeEach(() => {
  replies = [];
  requests = 0;
});

describe("runAgent", () => {
  it("returns the structured answer and verifies only what was retrieved", async () => {
    replies = [
      [toolUse("getFinancials", { company: "Initech" })],
      [
        text(
          JSON.stringify({
            answer: "Initech grew.",
            facts: [financialsFact("Initech"), financialsFact("Globex Inc")],
          }),
        ),
      ],
    ];

    const result = await runAgent("How is Initech?", () => {});

    expect(requests).toBe(2);
    expect(result.answer).toBe("Initech grew.");
    expect(result.facts.map((f) => f.source.verified)).toEqual([true, false]);
  });

  it("does not verify a source whose tool call failed", async () => {
    replies = [
      [toolUse("getFinancials", { company: "Nope" })],
      [text(JSON.stringify({ answer: "Done.", facts: [financialsFact("Nope")] }))],
    ];

    const result = await runAgent("How is Nope?", () => {});

    expect(result.facts[0].source.verified).toBe(false);
  });

  it("shows a plain text reply as the answer, with no facts", async () => {
    replies = [[text("Which company do you mean?")]];

    const result = await runAgent("How are they?", () => {});

    expect(result).toEqual({ answer: "Which company do you mean?", facts: [], iterations: 1 });
  });

  it("never shows raw JSON from a reply that was cut off", async () => {
    replies = [[text('{"answer":"Initech gr')]];

    const result = await runAgent("How is Initech?", () => {});

    expect(result.facts).toEqual([]);
    expect(result.answer).toMatch(/couldn't pull an answer together/);
  });
});
