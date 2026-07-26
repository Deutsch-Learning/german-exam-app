const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const SERIES = [
  {
    number: 1,
    title: "Homeoffice und die Zukunft der Arbeit",
    instructions: "Sie hoeren nun ein Oe1-Interview mit Dr. Karin Froehlich, Arbeitsmarktexpertin der Arbeiterkammer Wien. Sie hoeren das Interview zweimal. Lesen Sie zuerst die Aufgaben. Sie haben 90 Sekunden Zeit.",
    questionPages: [4, 5],
    answerPages: [9, 10, 11],
  },
  {
    number: 2,
    title: "Energiewende - Chancen fuer die Alpenregion",
    instructions: "Sie hoeren ein SRF Wissen-Feature mit Prof. Thomas Maurer, Energieforscher an der ETH Zuerich. Lesen Sie die Aufgaben. 90 Sekunden.",
    questionPages: [12, 13],
    answerPages: [17, 18, 19],
  },
  {
    number: 3,
    title: "Pflegeberuf in der Schweiz - Attraktivitaet und Zukunft",
    instructions: "Sie hoeren ein SRF Ratgeber-Interview mit Markus Rueegg, Direktor des SBK in Bern. Lesen Sie die Aufgaben. 90 Sekunden.",
    questionPages: [20, 21],
    answerPages: [24, 25, 26],
  },
  {
    number: 4,
    title: "Digitale Schule - Chancen und Herausforderungen",
    instructions: "Sie hoeren ein Oe1-Gespraech mit Prof. Maria Huber, Bildungsforscherin an der Universitaet Wien. Lesen Sie die Aufgaben. 90 Sekunden.",
    questionPages: [27, 28],
    answerPages: [31, 32, 33],
  },
  {
    number: 5,
    title: "Nachhaltiger Tourismus - Bilanz und Ausblick",
    instructions: "Sie hoeren ein ORF Tirol Interview mit Dr. Susanne Kofler, Direktorin von Tirol Werbung. Lesen Sie die Aufgaben. 90 Sekunden.",
    questionPages: [34, 35],
    answerPages: [38, 39],
  },
  {
    number: 6,
    title: "Wiener Wohnungspolitik im Fokus",
    instructions: "Sie hoeren ein Oe1-Stadtgespraech mit Prof. Petra Weiss, Stadtsoziologin der TU Wien. 90 Sekunden Lesezeit.",
    questionPages: [40, 41],
    answerPages: [44, 45],
  },
  {
    number: 7,
    title: "Fachkraefte mit Migrationshintergrund in Oesterreich",
    instructions: "Sie hoeren ein Interview mit Dr. Ahmed Karim, Integrationsexperte der Uni Graz. Lesen Sie die Aufgaben. 90 Sekunden.",
    questionPages: [46, 47],
    answerPages: [50, 51],
  },
];

const EXTRACTION_REPAIRS = new Map([
  ["Mindestpersonalschluesse ln", "Mindestpersonalschluesseln"],
  ["Beschleunigung des Baug enehmigungsverfahrens", "Beschleunigung des Baugenehmigungsverfahrens"],
]);

const cleanCell = (value) => {
  let clean = String(value || "").replace(/\s+/g, " ").trim();
  for (const [from, to] of EXTRACTION_REPAIRS) clean = clean.replace(from, to);
  return clean;
};

const numericRows = (pages, pageNumbers) => pages
  .filter((page) => pageNumbers.includes(page.num))
  .flatMap((page) => page.tables || [])
  .flatMap((table) => table || [])
  .filter((row) => /^\d+$/.test(cleanCell(row?.[0])));

const buildSeries = (pages, definition) => {
  const promptRows = numericRows(pages, definition.questionPages)
    .filter((row) => row.length === 2);
  const answerRows = numericRows(pages, definition.answerPages)
    .filter((row) => row.length >= 3 && !/^[RF]$/i.test(cleanCell(row[2])));

  const prompts = new Map(promptRows.map((row) => [Number(cleanCell(row[0])), cleanCell(row[1])]));
  const answers = new Map(answerRows.map((row) => [Number(cleanCell(row[0])), {
    answer: cleanCell(row[2]),
    explanation: cleanCell(row[3]),
  }]));

  const items = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    const prompt = prompts.get(number);
    const correction = answers.get(number);
    if (!prompt || !correction?.answer) {
      throw new Error(`Serie ${definition.number}, Aufgabe 2, Item ${number} could not be extracted.`);
    }
    return { number, prompt, ...correction };
  });

  return {
    title: definition.title,
    instructions: definition.instructions,
    points: 10,
    listeningPasses: 2,
    preparationSeconds: 90,
    layout: "information-sheet",
    items,
  };
};

const main = async () => {
  const input = path.resolve(process.argv[2] || "OSD_B2_Hoeren_20_Modellpruefungen.pdf");
  const output = path.resolve(process.argv[3] || path.join(__dirname, "..", "data", "osdB2HoerenTeil2Fixes.json"));
  const parser = new PDFParse({ data: fs.readFileSync(input) });
  try {
    const tableResult = await parser.getTable({ partial: SERIES.flatMap((series) => [...series.questionPages, ...series.answerPages]) });
    const series = Object.fromEntries(SERIES.map((definition) => [
      String(definition.number),
      buildSeries(tableResult.pages, definition),
    ]));
    const payload = {
      source: "OSD_B2_Hoeren_20_Modellpruefungen.pdf",
      sourceCompleteness: "The PDF contains complete tasks and keys for series 1-7 only; series 8-20 are structural placeholders.",
      taskType: "Aufgabe 2 - Detailinformationen / Informationsblatt",
      series,
    };
    fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Wrote ${Object.keys(series).length} series and ${Object.values(series).reduce((sum, item) => sum + item.items.length, 0)} items to ${output}`);
  } finally {
    await parser.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
