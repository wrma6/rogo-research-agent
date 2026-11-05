import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** One scripted model reply per request, in order. */
let replies: unknown[][] = [];
let requests = 0;
/** The request bodies the agent sent. */
let sent: { messages: { content: unknown }[] }[] = [];

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
    vi.fn(async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return respond(replies[requests++]);
    }),
  );
  ({ runAgent } = await import("./agent.ts"));
});

beforeEach(() => {
  replies = [];
  requests = 0;
  sent = [];
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

  it("runs tools at the same time and returns results in request order", async () => {
    replies = [
      [
        toolUse("getFinancials", { company: "Initech" }), // the slower tool, requested first
        toolUse("searchCompanies", { query: "Acme" }),
      ],
      [text(JSON.stringify({ answer: "Done.", facts: [] }))],
    ];
    const events: string[] = [];

    await runAgent("How is Initech?", (event) => {
      if (event.type === "tool_start" || event.type === "tool_end") {
        events.push(`${event.type}:${event.name}`);
      }
    });

    expect(events).toEqual([
      "tool_start:getFinancials",
      "tool_start:searchCompanies",
      "tool_end:searchCompanies",
      "tool_end:getFinancials",
    ]);
    const results = sent[1].messages.at(-1)!.content as { tool_use_id: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual([
      "toolu_getFinancials",
      "toolu_searchCompanies",
    ]);
  });

  it("sends earlier turns and keeps earlier sources verified", async () => {
    replies = [[text(JSON.stringify({ answer: "Still true.", facts: [financialsFact("Initech")] }))]];

    const result = await runAgent("Is that still true?", () => {}, {
      history: [{ question: "How is Initech?", answer: "It grew.", facts: [] }],
      sources: ["financials:Initech"],
    });

    expect(sent[0].messages).toHaveLength(3);
    expect(sent[0].messages[0].content).toBe("How is Initech?");
    expect(sent[0].messages[2].content).toBe("Is that still true?");
    expect(result.facts[0].source.verified).toBe(true);
    expect(result.sources).toEqual(["financials:Initech"]);
  });

  it("flags only the tool calls that failed as errors", async () => {
    replies = [
      [
        toolUse("getFinancials", { company: "Nope" }),
        toolUse("searchCompanies", { query: "Acme" }),
      ],
      [text(JSON.stringify({ answer: "Done.", facts: [] }))],
    ];

    await runAgent("How is Nope?", () => {});

    const results = sent[1].messages.at(-1)!.content as { is_error: boolean; content: string }[];
    expect(results.map((r) => r.is_error)).toEqual([true, false]);
    expect(results[0].content).toBe('getFinancials failed: no financials found for "Nope"');
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

    expect(result).toEqual({
      answer: "Which company do you mean?",
      facts: [],
      sources: [],
      iterations: 1,
    });
  });

  it("retries once after a broken reply", async () => {
    replies = [
      [text('{"facts":[],"answer":"Initech gr')],
      [text(JSON.stringify({ answer: "Initech grew.", facts: [] }))],
    ];

    const result = await runAgent("How is Initech?", () => {});

    expect(requests).toBe(2);
    expect(result.answer).toBe("Initech grew.");
    // The broken reply must not stay in the conversation.
    expect(sent[1].messages).toHaveLength(1);
  });

  it("retries when JSON leaks into the summary", async () => {
    replies = [
      [text(JSON.stringify({ answer: "Initech grew.}} Wait, let me not break JSON...", facts: [] }))],
      [text(JSON.stringify({ answer: "Initech grew.", facts: [] }))],
    ];

    const result = await runAgent("How is Initech?", () => {});

    expect(result.answer).toBe("Initech grew.");
  });

  it("gives up with a clear message if the retry is also broken", async () => {
    replies = [[text('{"answer":"Initech gr')], [text('{"answer":"Initech gr')]];

    const result = await runAgent("How is Initech?", () => {});

    expect(requests).toBe(2);
    expect(result.facts).toEqual([]);
    expect(result.answer).toMatch(/couldn't pull an answer together/);
  });
});
