const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");

const normalizeWord = (value) => String(value || "").trim().replace(/[.,;:]+$/, "");
const fold = (value) => String(value || "").toLocaleLowerCase("de-DE").replace(/[^a-z0-9äöüß]+/g, "");

const main = async () => {
  const [pdfPath, docxPath, outputPath] = process.argv.slice(2);
  if (!pdfPath || !docxPath || !outputPath) {
    throw new Error("Usage: node build-osd-b2-reading-answers.js <source.pdf> <restructured.docx> <output.json>");
  }

  const pdf = new PDFParse({ data: fs.readFileSync(pdfPath) });
  const pdfResult = await pdf.getText({ lineEnforce: true, pageJoiner: "\n--- PAGE ---\n" });
  await pdf.destroy();
  const solutionMatches = [...pdfResult.text.matchAll(/Aufgabe\s+3\s*[–-]\s*Lösungen\s*\(20 Wörter\)/gi)];
  if (solutionMatches.length !== 20) throw new Error(`Expected 20 ÖSD Aufgabe 3 solution blocks, found ${solutionMatches.length}`);

  const docx = await mammoth.extractRawText({ buffer: fs.readFileSync(docxPath) });
  const docxFolded = fold(docx.value);
  const result = {};

  solutionMatches.forEach((match, index) => {
    const seriesNumber = index + 1;
    const rest = pdfResult.text.slice(match.index + match[0].length);
    const end = rest.search(/Aufgabe\s+4\s*[–-]\s*Lösungen/i);
    const block = end >= 0 ? rest.slice(0, end) : rest;
    const answers = {};
    for (const answer of block.matchAll(/(?:^|\s)(\d{1,2})\.\s+([\p{L}ßÄÖÜäöü-]+)/gu)) {
      answers[String(Number(answer[1]))] = normalizeWord(answer[2]);
    }
    if (Object.keys(answers).length !== 20) {
      throw new Error(`ÖSD series ${seriesNumber} has ${Object.keys(answers).length} Aufgabe 3 answers instead of 20`);
    }
    Object.values(answers).forEach((word) => {
      if (!docxFolded.includes(fold(word))) {
        throw new Error(`ÖSD series ${seriesNumber} answer is absent from the DOCX source: ${word}`);
      }
    });
    result[String(seriesNumber)] = answers;
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(result).length} verified ÖSD Aufgabe 3 answer sets to ${outputPath}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
