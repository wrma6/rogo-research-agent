import { describe, expect, it } from "vitest";
import { splitCitations } from "./citations.ts";

const text = (value: string) => ({ type: "text", text: value });
const ref = (n: number) => ({ type: "ref", n });

describe("splitCitations", () => {
  it("splits references out of the text", () => {
    expect(splitCitations("Revenue grew 47% [1], but slowing [2].", 2)).toEqual([
      text("Revenue grew 47%"),
      ref(1),
      text(", but slowing"),
      ref(2),
      text("."),
    ]);
  });

  it("handles adjacent and comma-separated references", () => {
    expect(splitCitations("A [1][2] B [3, 4]", 4)).toEqual([
      text("A"),
      ref(1),
      ref(2),
      text(" B"),
      ref(3),
      ref(4),
    ]);
  });

  it("drops references to facts that do not exist", () => {
    expect(splitCitations("A [0] B [3] C [2]", 2)).toEqual([text("A"), text(" B"), text(" C"), ref(2)]);
  });

  it("returns plain text unchanged", () => {
    expect(splitCitations("No citations here.", 0)).toEqual([text("No citations here.")]);
  });
});
