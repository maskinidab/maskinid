import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, parseCsvCells, toCsv } from "./tabular";

describe("tabular", () => {
  it("detects the delimiter and parses quoted cells", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a\tb")).toBe("\t");
    expect(parseCsvCells('﻿namn;"text; med ""citat"""\r\nx;"rad\nbrytning"\r\n\r\n')).toEqual([["namn", 'text; med "citat"'], ["x", "rad\nbrytning"]]);
  });

  it("builds a table with unique headers and trimmed values", () => {
    const t = parseCsv("Serienr,Modell,,Modell\nA1 , EC220 ,x,y\n");
    expect(t.headers).toEqual(["Serienr", "Modell", "Kolumn 3", "Modell (2)"]);
    expect(t.rows).toEqual([{ Serienr: "A1", Modell: "EC220", "Kolumn 3": "x", "Modell (2)": "y" }]);
  });

  it("writes CSV that round-trips", () => {
    const csv = toCsv(["a", "b"], [["x;y", 'q"'], [1, null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(parseCsv(csv).rows).toEqual([{ a: "x;y", b: 'q"' }, { a: "1", b: "" }]);
  });
});
