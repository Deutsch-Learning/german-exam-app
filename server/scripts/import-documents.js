require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const pool = require("../db");
const {
  analyzeExamDocument,
  ensureDocumentImportSchema,
  importParsedExamDocument,
  summarizeOutline,
} = require("../services/documentImport");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const files = args.filter((arg) => arg !== "--dry-run");

const guessMimeType = (file) => {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".txt") return "text/plain";
  if ([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"].includes(extension)) {
    return `image/${extension.replace(".", "").replace("jpg", "jpeg")}`;
  }
  return "application/octet-stream";
};

const main = async () => {
  if (!files.length) {
    console.error("Usage: node scripts/import-documents.js [--dry-run] <file...>");
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    await ensureDocumentImportSchema(pool);
  }

  for (const file of files) {
    const resolved = path.resolve(file);
    const buffer = await fs.promises.readFile(resolved);
    const parsed = await analyzeExamDocument({
      buffer,
      filename: path.basename(resolved),
      mimetype: guessMimeType(resolved),
    });
    const outline = summarizeOutline(parsed);
    console.log(`\n${path.basename(resolved)}`);
    console.log(
      JSON.stringify(
        {
          provider: parsed.metadata.provider,
          examType: parsed.metadata.examType,
          level: parsed.metadata.level,
          sectionType: parsed.metadata.sectionType,
          series: parsed.series.length,
          sections: parsed.validation.sectionCount,
          questions: parsed.validation.questionCount,
          warnings: parsed.validation.warnings,
          firstSeries: outline.series.slice(0, 3),
        },
        null,
        2
      )
    );

    if (!dryRun) {
      const imported = await importParsedExamDocument({ pool, parsed, adminId: null });
      console.log(
        JSON.stringify(
          {
            duplicate: imported.duplicate,
            importId: imported.import?.id,
            examIds: imported.exams.map((exam) => exam.id),
          },
          null,
          2
        )
      );
    }
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
