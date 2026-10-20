import { LineError } from "./copy-mode.ts";

export function invalidCsv(): LineError {
  return new LineError({
    de: "Die CSV-Datei ist unvollständig oder fehlerhaft. Bitte erneut als CSV exportieren. Es wurde nichts übernommen.",
    en: "The CSV file is incomplete or malformed. Export it as CSV again. Nothing was imported.",
  });
}

/** One quote state across records: embedded line breaks remain field content. */
export function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  const finishField = (): void => {
    record.push(field);
    field = "";
    state = "start";
  };
  const finishRecord = (): void => {
    // Ignore empty physical lines, never empty lines inside a quoted field.
    if (record.length === 0 && field === "" && state === "start") return;
    finishField();
    records.push(record);
    record = [];
  };
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (state === "quoted") {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') state = "closed";
      else field += ch;
    } else if (ch === ",") finishField();
    else if (ch === "\n" || ch === "\r") {
      finishRecord();
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
    } else if (ch === '"' && state === "start") state = "quoted";
    else {
      if (state === "closed" || ch === '"') throw invalidCsv();
      field += ch;
      state = "plain";
    }
  }
  if (state === "quoted") throw invalidCsv();
  finishRecord();
  return records;
}
