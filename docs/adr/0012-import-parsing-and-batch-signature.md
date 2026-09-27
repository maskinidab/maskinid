# 0012 – Import: parsing in the browser, validation in the database, one signature per batch

**Context.** SPEC §6.5 describes import as upload → column mapping (AI suggestion) → row validation → commit, and lets
a financier's import set active encumbrances directly. The data model has `imports.file_path`, i.e. a stored file.

**Decision.**
- The browser parses CSV (auto-detected `;` `,` or tab, RFC 4180 quotes) and XLSX (first sheet, `read-excel-file`)
  and sends the rows as JSON together with the chosen mapping to `create_import`. The original file is not stored:
  it may contain columns we must not keep (amounts, private persons' data), and nothing server-side needs it.
  `file_path` stays nullable for a later server-side upload path (API).
- All validation that matters is done by the database (`app.import_prepare_row`): required fields, identifier format,
  duplicates within the file and against the register, category text → enum (Swedish/English labels and synonyms,
  model catalogue when the column is empty), org number format, encumbrance rules (end date for retention of title).
  The browser only shows the result. Maximum 5 000 rows per import.
- `import_commit` creates each valid row in its own subtransaction (`app.create_machine`, origin `import`, level 0),
  so one failing row never stops the rest; a row error is written back to `import_rows`. One `machine.registered`
  event per machine plus one `import.committed`.
- A financier import that registers encumbrances is signed **once for the whole batch** (`import_commit` signature,
  text "Jag importerar N maskiner … och registrerar M förbehåll …", bound to the counts). Signing thousands of rows
  one by one would make the feature unusable; the batch signature carries the same legal intent and is logged.
- Machines already in the register are not duplicated: for a financier they get the encumbrance
  (`encumber_existing`); for others the row is an error that names the existing registration number. If another
  financier registered an active encumbrance between validation and commit, the row fails and a
  `double_encumbrance` conflict is recorded with notifications and webhook, exactly as in `register_encumbrance`.

**Consequences.** No file storage or parsing service is needed for imports; the AI mapping only sees headers and five
sample rows. API partners import through the same RPCs.
