const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");

const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

const parseBank = (raw) => {
  const flat = String(raw || "").replace(/\r/g, "").replace(/\n+/g, " ").trim();
  const matches = [...flat.matchAll(/(?:^|\s)([A-M])\s+(?=\S)/g)];
  return matches.map((match, index) => ({
    value: match[1],
    label: normalize(flat.slice(match.index + match[0].length, matches[index + 1]?.index ?? flat.length)),
  }));
};

const getDocxPartOneBlocks = (text) => {
  const seriesMatches = [...text.matchAll(/(?:^|\n)SUJET\s+(\d{2})\s+-/g)];
  return seriesMatches.map((match, index) => {
    const block = text.slice(match.index, seriesMatches[index + 1]?.index ?? text.length);
    const start = block.search(/(?:^|\n)TEIL\s+1\s+-/i);
    const end = block.search(/(?:^|\n)TEIL\s+2\s+-/i);
    return { number: Number(match[1]), text: block.slice(start, end >= 0 ? end : block.length) };
  });
};

const assertSameFragments = (docxBlock, bank, seriesNumber) => {
  const answerSheet = docxBlock.search(/Antwortbogen\s+Teil\s+1\s*:/i);
  const beforeSheet = answerSheet >= 0 ? docxBlock.slice(0, answerSheet) : docxBlock;
  const finalGap = beforeSheet.lastIndexOf("[10]");
  const bankMatch = beforeSheet.slice(Math.max(0, finalGap)).match(/\n\n[A-M]\s+/);
  const bankStart = bankMatch ? Math.max(0, finalGap) + bankMatch.index : -1;
  const rawBank = bankStart >= 0 ? beforeSheet.slice(bankStart) : "";
  const tokenize = (value) => normalize(value)
    .replace(/(?:^|\s)[A-M](?=\s)/g, " ")
    .toLocaleLowerCase("de-DE")
    .match(/[a-z0-9äöüß]+/g)
    ?.sort() || [];
  const sourceWords = tokenize(rawBank);
  const normalizedWords = tokenize(bank.map((item) => item.label).join(" "));
  const sourceCounts = new Map();
  sourceWords.forEach((word) => sourceCounts.set(word, (sourceCounts.get(word) || 0) + 1));
  let matchingWords = 0;
  normalizedWords.forEach((word) => {
    const remaining = sourceCounts.get(word) || 0;
    if (remaining > 0) {
      matchingWords += 1;
      sourceCounts.set(word, remaining - 1);
    }
  });
  const overlap = matchingWords / Math.max(sourceWords.length, normalizedWords.length, 1);
  if (overlap < 0.97) {
    throw new Error(`ECL series ${seriesNumber} bank words differ between the PDF and DOCX sources (${Math.round(overlap * 100)}% overlap)`);
  }
};

const main = async () => {
  const [pdfPath, docxPath, outputPath] = process.argv.slice(2);
  if (!pdfPath || !docxPath || !outputPath) {
    throw new Error("Usage: node build-ecl-b2-reading-banks.js <source.pdf> <restructured.docx> <output.json>");
  }

  const pdf = new PDFParse({ data: fs.readFileSync(pdfPath) });
  const pdfText = await pdf.getText({ lineEnforce: true, pageJoiner: "\n--- PAGE ---\n" });
  await pdf.destroy();
  const partMatches = [...pdfText.text.matchAll(/LESEVERSTEHEN\s*[–-]\s*TEIL\s+1\s*\|/gi)];
  if (partMatches.length !== 20) throw new Error(`Expected 20 ECL Teil 1 blocks, found ${partMatches.length}`);

  const docx = await mammoth.extractRawText({ buffer: fs.readFileSync(docxPath) });
  const docxBlocks = new Map(getDocxPartOneBlocks(docx.value).map((item) => [item.number, item.text]));
  const result = {};

  partMatches.forEach((match, index) => {
    const seriesNumber = index + 1;
    const block = pdfText.text.slice(match.index, partMatches[index + 1]?.index ?? pdfText.text.length);
    const answerSheet = block.search(/Antwortbogen\s+Teil\s+1\s*:/i);
    const beforeSheet = answerSheet >= 0 ? block.slice(0, answerSheet) : block;
    const finalGap = beforeSheet.lastIndexOf("[10]");
    const bankMatch = beforeSheet.slice(Math.max(0, finalGap)).match(/\n[A-M]\s+/);
    const bankStart = bankMatch ? Math.max(0, finalGap) + bankMatch.index : -1;
    const bank = parseBank(bankStart >= 0 ? beforeSheet.slice(bankStart + 1) : "");
    const values = bank.map((item) => item.value);
    if (bank.length !== 13 || new Set(values).size !== 13) {
      throw new Error(`ECL series ${seriesNumber} bank is invalid: ${values.join(",")}`);
    }
    assertSameFragments(docxBlocks.get(seriesNumber) || "", bank, seriesNumber);
    result[String(seriesNumber)] = bank;
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(result).length} verified ECL answer banks to ${outputPath}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
