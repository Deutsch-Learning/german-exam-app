const { getGoetheB1AdvertisementBank } = require("../data/goetheB1LesenAdvertisements");

const PARSER_VERSION = "b1StructuredLesen.v2";

const normalizeLineBreaks = (value = "") =>
  String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const compactText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const paragraphs = (value = "") => {
  const normalized = normalizeLineBreaks(value);
  const separator = /\n\s*\n/.test(normalized) ? /\n\s*\n/ : /\n/;
  return normalized
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getMatches = (text, regex) => {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const pattern = new RegExp(regex.source, flags);
  return [...String(text || "").matchAll(pattern)];
};

const makeSlices = (text, matches) =>
  matches.map((match, index) => ({
    match,
    text: text.slice(match.index, matches[index + 1]?.index ?? text.length).trim(),
  }));

const lineSlice = (text, startPattern, endPatterns = []) => {
  const source = normalizeLineBreaks(text);
  const startRegex = new RegExp(startPattern.source, startPattern.flags.replace("g", ""));
  const startMatch = startRegex.exec(source);
  if (!startMatch) return "";
  const lineEnd = source.indexOf("\n", startMatch.index + startMatch[0].length);
  const start = lineEnd >= 0 ? lineEnd + 1 : startMatch.index + startMatch[0].length;
  let end = source.length;
  const remainder = source.slice(start);
  endPatterns.forEach((pattern) => {
    const regex = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    const match = regex.exec(remainder);
    if (match) end = Math.min(end, start + match.index);
  });
  return normalizeLineBreaks(source.slice(start, end));
};

const getInstruction = (partText) => {
  const cells = paragraphs(partText);
  const markerIndex = cells.findIndex((item) => /^INSTRUCTION ÉTUDIANT\b/i.test(item));
  return markerIndex >= 0 ? cells[markerIndex + 1] || "" : "";
};

const parseNumberedStatements = (raw, expectedCount) => {
  const cells = paragraphs(raw);
  const statements = [];
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (!/^\d{1,2}$/.test(cells[index])) continue;
    const number = Number(cells[index]);
    if (number < 1 || number > expectedCount || statements.some((item) => item.number === number)) continue;
    statements.push({ number, prompt: cells[index + 1] });
  }
  return statements.sort((a, b) => a.number - b.number);
};

const parseNumberedChoiceRows = (raw, expectedCount) => {
  const cells = paragraphs(raw);
  const rows = [];
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (!/^\d{1,2}$/.test(cells[index])) continue;
    const number = Number(cells[index]);
    if (number < 1 || number > expectedCount || rows.some((item) => item.number === number)) continue;
    const options = [];
    let cursor = index + 2;
    while (cursor < cells.length && !/^\d{1,2}$/.test(cells[cursor]) && options.length < 3) {
      const option = cells[cursor].match(/^☐\s*([abc])\)\s*(.+)$/i);
      if (option) options.push({ value: option[1].toLowerCase(), label: option[2] });
      cursor += 1;
    }
    rows.push({ number, prompt: cells[index + 1], options });
  }
  return rows.sort((a, b) => a.number - b.number);
};

const parseAlternatingAnswerPairs = (raw, allowedPattern) => {
  const cells = paragraphs(raw);
  const answers = new Map();
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (!/^\d{1,2}$/.test(cells[index])) continue;
    const answer = cells[index + 1];
    if (allowedPattern.test(answer)) answers.set(Number(cells[index]), answer);
    allowedPattern.lastIndex = 0;
  }
  return answers;
};

const buildQuestion = ({
  provider,
  seriesNumber,
  partNumber,
  partType,
  position,
  prompt,
  options,
  correct,
  points,
  metadata = {},
}) => ({
  questionType: partType === "situation_ad_match" || partType === "heading_text_match"
    ? "matching"
    : partType === "reading_true_false" ? "true_false" : "multiple_choice",
  prompt: String(prompt || "").trim(),
  options,
  correctAnswer: { value: correct },
  explanation: null,
  position,
  scoring: { points },
  metadata: {
    structuredB1Lesen: true,
    parserVersion: PARSER_VERSION,
    stableId: `${provider}-b1-series-${String(seriesNumber).padStart(2, "0")}-part-${partNumber}-item-${position}`,
    provider,
    seriesNumber,
    partNumber,
    partType,
    sourceQuestionNumber: position,
    ...metadata,
  },
  sectionType: "read",
});

const buildSection = ({
  provider,
  seriesNumber,
  partNumber,
  title,
  instruction,
  partType,
  durationMinutes,
  points,
  metadata = {},
  questions,
}) => ({
  sectionType: "read",
  partNumber,
  title,
  instructions: instruction,
  durationMinutes,
  points,
  scoring: { points, durationMinutes },
  metadata: {
    structuredB1Lesen: {
      parserVersion: PARSER_VERSION,
      provider,
      seriesNumber,
      partNumber,
      partType,
      instruction,
      ...metadata,
    },
  },
  questions,
});

const parseTelcCorrection = (raw) => {
  const answers = { 1: new Map(), 2: new Map(), 3: new Map() };
  const partOne = String(raw || "").match(/(?:^|\n)Teil 1:\s*([^\n]+)/i)?.[1] || "";
  for (const match of partOne.matchAll(/Text\s+([1-5])\s*→\s*([A-G])/gi)) {
    answers[1].set(Number(match[1]), match[2].toUpperCase());
  }
  const partTwo = String(raw || "").match(/(?:^|\n)Teil 2:\s*([^\n]+)/i)?.[1] || "";
  for (const match of partTwo.matchAll(/F([1-5])\s*:\s*([ABC])/gi)) {
    answers[2].set(Number(match[1]), match[2].toLowerCase());
  }
  const partThree = String(raw || "").match(/(?:^|\n)Teil 3:\s*([^\n]+)/i)?.[1] || "";
  for (const match of partThree.matchAll(/\b(10|[1-9])\s*:\s*([A-T])\b/gi)) {
    answers[3].set(Number(match[1]), match[2].toUpperCase());
  }
  return answers;
};

const parseTelcHeadingBank = (partText) => {
  const raw = lineSlice(partText, /^BANQUE COMMUNE DE TITRES\b/im, [/^5 TEXTES COURTS\b/im]);
  const cells = paragraphs(raw).filter((item) => !/^(Code|Überschrift)$/i.test(item));
  const headings = [];
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (!/^[A-G]$/.test(cells[index])) continue;
    headings.push({ value: cells[index], label: cells[index + 1] });
    index += 1;
  }
  return headings;
};

const parseTelcShortTexts = (partText) => {
  const raw = lineSlice(partText, /^5 TEXTES COURTS\b/im);
  const matches = getMatches(raw, /^Text\s+([1-5])\s*$/gim);
  return makeSlices(raw, matches).map((block) => {
    const number = Number(block.match[1]);
    const answerMarker = new RegExp(`(?:^|\\n)Text\\s+${number}\\s*:\\s*___`, "i");
    const body = block.text.slice(block.match[0].trimStart().length).replace(answerMarker, "").trim();
    return { number, text: normalizeLineBreaks(body) };
  });
};

const parseTelcAdvertisements = (partText) => {
  const raw = lineSlice(partText, /^BANQUE D[’']ANNONCES\b/im);
  const matches = getMatches(raw, /(?:^|\n)Anzeige\s+([A-T])\s*:\s*/gi);
  return makeSlices(raw, matches)
    .map((block) => ({
      value: block.match[1].toUpperCase(),
      label: compactText(block.text.slice(block.match[0].trimStart().length)),
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
};

const parseTelcSeries = (text, metadata) => {
  const clean = normalizeLineBreaks(text);
  const seriesMatches = getMatches(clean, /(?:^|\n)SUJET\s+(\d{2})\s*\/\s*20\s*·\s*Thème\s*:\s*([^\n]+)/gi);
  return makeSlices(clean, seriesMatches).map((seriesBlock) => {
    const seriesNumber = Number(seriesBlock.match[1]);
    const title = seriesBlock.match[2].trim();
    const correctionIndex = seriesBlock.text.search(/(?:^|\n)CORRIGÉ\s*-\s*Sujet\s+\d+/i);
    const taskText = correctionIndex >= 0 ? seriesBlock.text.slice(0, correctionIndex) : seriesBlock.text;
    const correction = correctionIndex >= 0 ? seriesBlock.text.slice(correctionIndex) : "";
    const answers = parseTelcCorrection(correction);
    const partMatches = getMatches(taskText, /(?:^|\n)Teil\s+([1-3])\s*[–-]\s*([^\n(]+?)\s*\((\d+(?:[.,]\d+)?)\s+Punkte\)/gi);
    const sections = makeSlices(taskText, partMatches).map((partBlock) => {
      const partNumber = Number(partBlock.match[1]);
      const partTitle = partBlock.match[2].trim();
      const points = Number(partBlock.match[3].replace(",", "."));
      const instruction = getInstruction(partBlock.text);
      if (partNumber === 1) {
        const headings = parseTelcHeadingBank(partBlock.text);
        const texts = parseTelcShortTexts(partBlock.text);
        const questions = texts.map((item) => buildQuestion({
          provider: "telc", seriesNumber, partNumber, partType: "heading_text_match",
          position: item.number, prompt: item.text, options: headings,
          correct: answers[1].get(item.number) || "", points: 5,
          metadata: { uniqueAnswers: true, itemLabel: `Text ${item.number}` },
        }));
        return buildSection({
          provider: "telc", seriesNumber, partNumber, title: `Teil 1: ${partTitle}`,
          instruction, partType: "heading_text_match", durationMinutes: null, points,
          metadata: { headings, uniqueAnswers: true }, questions,
        });
      }
      if (partNumber === 2) {
        const sourceText = lineSlice(partBlock.text, /^TEXTE\s*\/\s*MATÉRIEL À LIRE\b/im, [/^QUESTIONS ET OPTIONS\b/im]);
        const rows = parseNumberedChoiceRows(lineSlice(partBlock.text, /^QUESTIONS ET OPTIONS\b/im), 5);
        const questions = rows.map((item) => buildQuestion({
          provider: "telc", seriesNumber, partNumber, partType: "reading_mcq",
          position: item.number, prompt: item.prompt, options: item.options,
          correct: answers[2].get(item.number) || "", points: 5,
        }));
        return buildSection({
          provider: "telc", seriesNumber, partNumber, title: `Teil 2: ${partTitle}`,
          instruction, partType: "reading_mcq", durationMinutes: null, points,
          metadata: { sourceMaterials: [{ label: "Text", text: sourceText }] }, questions,
        });
      }
      const situations = parseNumberedStatements(
        lineSlice(partBlock.text, /^SITUATIONS\s*-\s*VISIBLES À L[’']ÉTUDIANT\b/im, [/^BANQUE D[’']ANNONCES\b/im]),
        10
      );
      const advertisements = parseTelcAdvertisements(partBlock.text);
      const questions = situations.map((item) => buildQuestion({
        provider: "telc", seriesNumber, partNumber, partType: "situation_ad_match",
        position: item.number, prompt: item.prompt, options: advertisements,
        correct: answers[3].get(item.number) || "", points: 2.5,
        metadata: { uniqueAnswers: true },
      }));
      return buildSection({
        provider: "telc", seriesNumber, partNumber, title: `Teil 3: ${partTitle}`,
        instruction, partType: "situation_ad_match", durationMinutes: null, points,
        metadata: { advertisements, uniqueAnswers: true }, questions,
      });
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `TELC B1 Lesen ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "telc Deutsch B1 Lesen: drei Leseteile in einer Sitzung.",
      scoring: { totalPoints: 75, globalDurationMinutes: 60, parts: { 1: 25, 2: 25, 3: 25 } },
      metadata: {
        ...metadata,
        parserVersion: PARSER_VERSION,
        globalDurationMinutes: 60,
        structuredB1Lesen: true,
        replacePublishedScope: true,
      },
      sections,
    };
  });
};

const parseEclCorrections = (raw) => {
  const partOne = lineSlice(raw, /^Aufgabe 1\s*-\s*Item/im, [/^Aufgabe 2\s*-\s*Item/im]);
  const partTwo = lineSlice(raw, /^Aufgabe 2\s*-\s*Item/im);
  return {
    1: parseAlternatingAnswerPairs(partOne, /^(R|F|NT)$/),
    2: parseAlternatingAnswerPairs(partTwo, /^[abc]$/),
  };
};

const parseEclSeries = (text, metadata) => {
  const clean = normalizeLineBreaks(text);
  const seriesMatches = getMatches(clean, /(?:^|\n)Sujet\s+(\d{2})\s+—\s+([^\n]+)/gi);
  return makeSlices(clean, seriesMatches).map((seriesBlock) => {
    const seriesNumber = Number(seriesBlock.match[1]);
    const title = seriesBlock.match[2].trim();
    const correctionIndex = seriesBlock.text.search(/(?:^|\n)CORRIGÉ\s*-\s*Sujet\s+\d+/i);
    const taskText = correctionIndex >= 0 ? seriesBlock.text.slice(0, correctionIndex) : seriesBlock.text;
    const correction = correctionIndex >= 0 ? seriesBlock.text.slice(correctionIndex) : "";
    const answers = parseEclCorrections(correction);
    const partMatches = getMatches(taskText, /(?:^|\n)Aufgabe\s+([12])\s+—\s+([^\n]+)/gi);
    const sections = makeSlices(taskText, partMatches).map((partBlock) => {
      const partNumber = Number(partBlock.match[1]);
      const partTitle = partBlock.match[2].trim();
      const instruction = getInstruction(partBlock.text);
      const sourceText = lineSlice(partBlock.text, /^TEXTE\s*\/\s*MATÉRIEL À LIRE\b/im, [
        /^AFFIRMATIONS ET CHOIX\b/im,
        /^QUESTIONS ET OPTIONS\b/im,
      ]);
      if (partNumber === 1) {
        const options = [
          { value: "R", label: "Richtig" },
          { value: "F", label: "Falsch" },
          { value: "NT", label: "Steht nicht im Text" },
        ];
        const statements = parseNumberedStatements(lineSlice(partBlock.text, /^AFFIRMATIONS ET CHOIX\b/im), 10);
        const questions = statements.map((item) => buildQuestion({
          provider: "ecl", seriesNumber, partNumber, partType: "reading_true_false_not_in_text",
          position: item.number, prompt: item.prompt, options,
          correct: answers[1].get(item.number) || "", points: 1.25,
        }));
        return buildSection({
          provider: "ecl", seriesNumber, partNumber, title: `Aufgabe 1: ${partTitle}`,
          instruction, partType: "reading_true_false_not_in_text", durationMinutes: 18, points: 12.5,
          metadata: { sourceMaterials: [{ label: "Text", text: sourceText }] }, questions,
        });
      }
      const rows = parseNumberedChoiceRows(lineSlice(partBlock.text, /^QUESTIONS ET OPTIONS\b/im), 5);
      const questions = rows.map((item) => buildQuestion({
        provider: "ecl", seriesNumber, partNumber, partType: "reading_mcq",
        position: item.number, prompt: item.prompt, options: item.options,
        correct: answers[2].get(item.number) || "", points: 1.25,
      }));
      return buildSection({
        provider: "ecl", seriesNumber, partNumber, title: `Aufgabe 2: ${partTitle}`,
        instruction, partType: "reading_mcq", durationMinutes: 17, points: 6.25,
        metadata: { sourceMaterials: [{ label: "Text", text: sourceText }] }, questions,
      });
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `ECL B1 Leseverstehen ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ECL B1 Leseverstehen: zwei Aufgaben in 35 Minuten.",
      scoring: {
        totalPoints: 18.75,
        sourceDeclaredPoints: 25,
        globalDurationMinutes: 35,
        parts: { 1: 12.5, 2: 6.25 },
      },
      metadata: {
        ...metadata,
        parserVersion: PARSER_VERSION,
        globalDurationMinutes: 35,
        structuredB1Lesen: true,
        sourceWarnings: [
          "The source overview declares 25 points at 1.25 points per item, while each series contains 15 supplied items. The 15 items and their keys are preserved unchanged.",
        ],
        replacePublishedScope: true,
      },
      sections,
    };
  });
};

const parseOsdSimpleAnswers = (raw, startPattern, endPatterns, allowedPattern) =>
  parseAlternatingAnswerPairs(lineSlice(raw, startPattern, endPatterns), allowedPattern);

const parseOsdPartOneAnswers = (raw) => {
  const cells = paragraphs(lineSlice(raw, /^Teil 1\s*-\s*Nr\./im, [/^Teil 2\s*-\s*Item/im]));
  const answers = new Map();
  for (let index = 0; index < cells.length; index += 1) {
    if (!/^\d{1,2}$/.test(cells[index])) continue;
    const number = Number(cells[index]);
    const answer = cells.slice(index + 1, index + 4).find((item) => /^(Richtig|Falsch)$/.test(item));
    if (answer) answers.set(number, answer);
  }
  return answers;
};

const parseOsdOpinionAnswers = (raw) => {
  const body = lineSlice(raw, /^Teil 4\s*-\s*Lösungen/im, [/^Teil 5\s*-\s*Item/im]);
  const answers = new Map();
  for (const match of body.matchAll(/\b([1-7])\.\s*[^|(]+\((dafür|dagegen)\)/gi)) {
    answers.set(Number(match[1]), match[2].toLocaleLowerCase("de-DE"));
  }
  return answers;
};

const parseOsdCorrections = (raw) => ({
  1: parseOsdPartOneAnswers(raw),
  2: parseOsdSimpleAnswers(raw, /^Teil 2\s*-\s*Item/im, [/^Teil 3\s*-\s*Item/im], /^[abc]$/),
  3: parseOsdSimpleAnswers(raw, /^Teil 3\s*-\s*Item/im, [/^Teil 4\s*-\s*Lösungen/im], /^[A-J]$/),
  4: parseOsdOpinionAnswers(raw),
  5: parseOsdSimpleAnswers(raw, /^Teil 5\s*-\s*Item/im, [], /^[abc]$/),
});

const parseOsdAdvertisementTable = (raw) => {
  const cells = paragraphs(raw).filter((item) => !/^(Anzeige|Text)$/i.test(item));
  const advertisements = [];
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (!/^[A-J]$/.test(cells[index])) continue;
    advertisements.push({ value: cells[index], label: cells[index + 1] });
    index += 1;
  }
  return advertisements;
};

const OSD_PART_TITLES = {
  1: "Richtig oder Falsch",
  2: "Zwei Texte und Multiple Choice",
  3: "Anzeigen den Situationen zuordnen",
  4: "Dafür oder Dagegen",
  5: "Regeln und Informationen",
};

const OSD_PART_POINTS = { 1: 6, 2: 6, 3: 7, 4: 7, 5: 4 };
const OSD_PART_DURATIONS = { 1: 10, 2: 20, 3: 10, 4: 15, 5: 10 };

const GOETHE_PART_TITLES = {
  1: "Richtig oder Falsch",
  2: "Zwei Artikel und Multiple Choice",
  3: "Anzeigen den Situationen zuordnen",
  4: "Lesermeinungen: Ja oder Nein",
  5: "Regeln und Informationen",
};

const GOETHE_PART_POINTS = { 1: 6, 2: 6, 3: 7, 4: 7, 5: 4 };
const GOETHE_PART_DURATIONS = { 1: 10, 2: 20, 3: 10, 4: 15, 5: 10 };

const parseGoetheAnswersInRange = (raw, partNumber, start, end, allowedPattern) => {
  const startMatch = new RegExp(`Teil\\s+${partNumber}\\s*\\(`, "i").exec(raw);
  if (!startMatch) return new Map();
  const remainder = raw.slice(startMatch.index);
  const nextMatch = partNumber < 5
    ? new RegExp(`Teil\\s+${partNumber + 1}\\s*\\(`, "i").exec(remainder.slice(startMatch[0].length))
    : null;
  const body = nextMatch
    ? remainder.slice(0, startMatch[0].length + nextMatch.index)
    : remainder;
  const answers = new Map();
  const pattern = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(${allowedPattern})(?=\\s|\\d|$)`, "gi");
  for (const match of body.matchAll(pattern)) {
    const number = Number(match[1]);
    if (number >= start && number <= end) answers.set(number, match[2]);
  }
  return answers;
};

const parseGoetheCorrections = (raw) => ({
  1: parseGoetheAnswersInRange(raw, 1, 1, 6, "Richtig|Falsch"),
  2: parseGoetheAnswersInRange(raw, 2, 7, 12, "[abc]"),
  3: parseGoetheAnswersInRange(raw, 3, 13, 19, "[a-j]|0"),
  4: parseGoetheAnswersInRange(raw, 4, 20, 26, "Ja|Nein"),
  5: parseGoetheAnswersInRange(raw, 5, 27, 30, "[abc]"),
});

const parseGoetheNumberedRows = (raw, start, end) => {
  const rows = [];
  const cells = paragraphs(raw).filter((cell) => !/^(Nr\.|Nr\s)/i.test(cell));
  cells.forEach((cell) => {
    const markers = [];
    for (let number = start; number <= end; number += 1) {
      const match = new RegExp(`${number}\\s+`).exec(cell);
      if (match) markers.push({ number, index: match.index, length: match[0].length });
    }
    markers.sort((a, b) => a.index - b.index).forEach((marker, markerIndex) => {
      const next = markers[markerIndex + 1];
      const before = markerIndex === 0 ? cell.slice(0, marker.index) : "";
      const after = cell.slice(marker.index + marker.length, next?.index ?? cell.length);
      const prompt = compactText(`${before} ${after}`.replace(/[_■]+/g, " "));
      if (prompt && !rows.some((row) => row.number === marker.number)) rows.push({ number: marker.number, prompt });
    });
  });
  return rows.sort((a, b) => a.number - b.number);
};

const parseGoetheChoiceCells = (raw, start, end) => {
  const rows = [];
  paragraphs(raw).forEach((cell) => {
    for (let number = start; number <= end; number += 1) {
      const marker = new RegExp(`Aufgabe\\s+${number}\\s*:\\s*`, "i");
      const markerMatch = marker.exec(cell);
      if (!markerMatch || rows.some((row) => row.number === number)) continue;
      const body = cell.slice(markerMatch.index + markerMatch[0].length);
      const match = body.match(/^([\s\S]*?)\s*■\s*a\)\s*([\s\S]*?)\s*■\s*b\)\s*([\s\S]*?)\s*■\s*c\)\s*([\s\S]*)$/i);
      if (!match) continue;
      rows.push({
        number,
        prompt: compactText(match[1]),
        options: [
          { value: "a", label: compactText(match[2]) },
          { value: "b", label: compactText(match[3]) },
          { value: "c", label: compactText(match[4]) },
        ],
      });
    }
  });
  return rows.sort((a, b) => a.number - b.number);
};

const getGoetheSourceBeforeQuestion = (raw, number) => {
  const cells = paragraphs(raw);
  const index = cells.findIndex((cell) => new RegExp(`Aufgabe\\s+${number}\\s*:`, "i").test(cell));
  if (index < 0) return "";
  const markerIndex = cells[index].search(new RegExp(`Aufgabe\\s+${number}\\s*:`, "i"));
  return normalizeLineBreaks([...cells.slice(0, index), cells[index].slice(0, markerIndex)].filter(Boolean).join("\n\n"));
};

const parseGoetheAdvertisements = (raw) => {
  const source = normalizeLineBreaks(raw.replace(/^Anzeigen\s*:\s*/i, ""));
  const matches = getMatches(source, /(?:^|\s)\(([a-j])\)\s*/gi);
  const advertisements = makeSlices(source, matches).map((block) => ({
    value: block.match[1].toLowerCase(),
    label: compactText(block.text.replace(block.match[0].trimStart(), "")),
  }));
  return [
    ...advertisements,
    { value: "0", label: "Keine passende Anzeige" },
  ];
};

const parseGoetheOpinions = (raw) => {
  const tableIndex = raw.search(/^Nr\.\s+Person/im);
  const visible = normalizeLineBreaks(tableIndex >= 0 ? raw.slice(0, tableIndex) : raw);
  const matches = getMatches(visible, /(?:^|\s)([A-ZÄÖÜ][\p{L}'’-]*(?:\s+[\p{L}'’-]+)*\s+[A-ZÄÖÜ]\.)\s*:/gu);
  const opinions = makeSlices(visible, matches).map((block) => ({
    name: `${block.match[1]}:`,
    text: normalizeLineBreaks(block.text.slice(block.match[0].length)),
  }));
  const theme = normalizeLineBreaks(visible.slice(0, matches[0]?.index ?? visible.length));
  return { theme, opinions };
};

const decodeBasicHtml = (value) => String(value || "")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, " ")
  .trim();

const getGoetheEmphasizedTitle = (metadata, seriesNumber, partNumber) => {
  const html = String(metadata.structuredSourceHtml || "");
  if (!html) return "";
  const seriesLabel = `PRÜFUNGSHEFT ${String(seriesNumber).padStart(2, "0")}`;
  const seriesStart = html.indexOf(seriesLabel);
  if (seriesStart < 0) return "";
  const nextSeries = html.indexOf(`PRÜFUNGSHEFT ${String(seriesNumber + 1).padStart(2, "0")}`, seriesStart + seriesLabel.length);
  const seriesHtml = html.slice(seriesStart, nextSeries >= 0 ? nextSeries : html.length);
  const partMarker = new RegExp(`>TEIL\\s+${partNumber}<`, "i").exec(seriesHtml);
  if (!partMarker) return "";
  const partStart = partMarker.index + partMarker[0].length;
  const nextPart = partNumber < 5 ? new RegExp(`>TEIL\\s+${partNumber + 1}<`, "i").exec(seriesHtml.slice(partStart)) : null;
  const partHtml = seriesHtml.slice(partStart, nextPart ? partStart + nextPart.index : seriesHtml.length);
  const studentStart = partHtml.indexOf("STUDENT-VISIBLE CONTENT");
  const visibleHtml = studentStart >= 0 ? partHtml.slice(studentStart + "STUDENT-VISIBLE CONTENT".length) : partHtml;
  return decodeBasicHtml(visibleHtml.match(/<em>([\s\S]*?)<\/em>/i)?.[1] || "");
};

const separateGoetheTitle = (text, title) => {
  const source = normalizeLineBreaks(text);
  if (!title || !source.startsWith(title) || source.startsWith(`${title}\n`)) return source;
  return normalizeLineBreaks(`${title}\n\n${source.slice(title.length)}`);
};

const parseGoetheSeries = (text, metadata) => {
  const clean = normalizeLineBreaks(text);
  const seriesMatches = getMatches(clean, /(?:^|\n)PRÜFUNGSHEFT\s+(\d{2})\s*\|\s*Thema\s*:\s*([^\n]+)/gi);
  return makeSlices(clean, seriesMatches).map((seriesBlock) => {
    const seriesNumber = Number(seriesBlock.match[1]);
    const title = seriesBlock.match[2].trim();
    const sourceLabel = `Goethe B1 Lesen ${String(seriesNumber).padStart(2, "0")}`;
    const correctionIndex = seriesBlock.text.search(/(?:^|\n)HIDDEN CORRECTION\s*-\s*PRÜFUNGSHEFT\s+\d+/i);
    const taskText = correctionIndex >= 0 ? seriesBlock.text.slice(0, correctionIndex) : seriesBlock.text;
    const correction = correctionIndex >= 0 ? seriesBlock.text.slice(correctionIndex) : "";
    const answers = parseGoetheCorrections(correction);
    const partMatches = getMatches(taskText, /(?:^|\n)TEIL\s+([1-5])\s*$/gim);
    const sections = makeSlices(taskText, partMatches).map((partBlock) => {
      const partNumber = Number(partBlock.match[1]);
      const instructionCells = paragraphs(partBlock.text);
      const studentMarker = instructionCells.findIndex((cell) => /^STUDENT-VISIBLE CONTENT$/i.test(cell));
      const instruction = studentMarker > 0 ? instructionCells[studentMarker - 1] : "";
      const visible = lineSlice(partBlock.text, /^STUDENT-VISIBLE CONTENT$/im);
      const points = GOETHE_PART_POINTS[partNumber];
      const durationMinutes = GOETHE_PART_DURATIONS[partNumber];

      if (partNumber === 1) {
        const statementMarker = visible.search(/^Nr\.\s+Aussage/im);
        const sourceText = separateGoetheTitle(
          visible.slice(0, statementMarker >= 0 ? statementMarker : visible.length),
          getGoetheEmphasizedTitle(metadata, seriesNumber, partNumber)
        );
        const statements = parseGoetheNumberedRows(lineSlice(visible, /^Nr\.\s+Aussage/im), 1, 6);
        const options = [
          { value: "Richtig", label: "Richtig" },
          { value: "Falsch", label: "Falsch" },
        ];
        const questions = statements.map((item) => buildQuestion({
          provider: "goethe", seriesNumber, partNumber, partType: "reading_true_false",
          position: item.number, prompt: item.prompt, options,
          correct: answers[1].get(item.number) || "", points: 1,
        }));
        return buildSection({
          provider: "goethe", seriesNumber, partNumber, title: `Teil 1: ${GOETHE_PART_TITLES[1]}`,
          instruction, partType: "reading_true_false", durationMinutes, points,
          metadata: { sourceMaterials: [{ label: "Text", text: sourceText }] }, questions,
        });
      }

      if (partNumber === 2) {
        const rows = parseGoetheChoiceCells(visible, 7, 12);
        const textA = getGoetheSourceBeforeQuestion(visible, 7);
        const afterQuestionNine = paragraphs(visible).slice(
          paragraphs(visible).findIndex((cell) => /Aufgabe\s+9\s*:/i.test(cell)) + 1
        ).join("\n\n");
        const textB = separateGoetheTitle(
          getGoetheSourceBeforeQuestion(afterQuestionNine, 10),
          getGoetheEmphasizedTitle(metadata, seriesNumber, partNumber)
        );
        const questions = rows.map((item) => buildQuestion({
          provider: "goethe", seriesNumber, partNumber, partType: "reading_mcq",
          position: item.number, prompt: item.prompt, options: item.options,
          correct: String(answers[2].get(item.number) || "").toLowerCase(), points: 1,
          metadata: { sourceMaterialIndex: item.number <= 9 ? 0 : 1 },
        }));
        return buildSection({
          provider: "goethe", seriesNumber, partNumber, title: `Teil 2: ${GOETHE_PART_TITLES[2]}`,
          instruction, partType: "reading_mcq", durationMinutes, points,
          metadata: { sourceMaterials: [{ label: "Artikel 1", text: textA }, { label: "Artikel 2", text: textB }] }, questions,
        });
      }

      if (partNumber === 3) {
        const advertisementsMarker = visible.search(/^Anzeigen\s*:/im);
        const situationText = advertisementsMarker >= 0 ? visible.slice(0, advertisementsMarker) : visible;
        const advertisementText = advertisementsMarker >= 0 ? visible.slice(advertisementsMarker) : "";
        const situations = parseGoetheNumberedRows(situationText, 13, 19);
        const parsedAdvertisements = parseGoetheAdvertisements(advertisementText);
        const advertisements = [
          ...getGoetheB1AdvertisementBank(seriesNumber),
          parsedAdvertisements.find((item) => item.value === "0") || { value: "0", label: "Keine passende Anzeige" },
        ];
        const questions = situations.map((item) => buildQuestion({
          provider: "goethe", seriesNumber, partNumber, partType: "situation_ad_match",
          position: item.number, prompt: item.prompt, options: advertisements,
          correct: String(answers[3].get(item.number) || "").toLowerCase(), points: 1,
          metadata: { uniqueAnswers: true, reusableAnswers: ["0"] },
        }));
        return buildSection({
          provider: "goethe", seriesNumber, partNumber, title: `Teil 3: ${GOETHE_PART_TITLES[3]}`,
          instruction, partType: "situation_ad_match", durationMinutes, points,
          metadata: { advertisements, uniqueAnswers: true, reusableAnswers: ["0"] }, questions,
        });
      }

      if (partNumber === 4) {
        const { theme, opinions } = parseGoetheOpinions(visible);
        const options = [{ value: "Ja", label: "Ja" }, { value: "Nein", label: "Nein" }];
        const questions = opinions.map((opinion, index) => {
          const number = 20 + index;
          return buildQuestion({
            provider: "goethe", seriesNumber, partNumber, partType: "opinion_yes_no",
            position: number, prompt: `${opinion.name}\n${opinion.text}`, options,
            correct: answers[4].get(number) || "", points: 1,
          });
        });
        return buildSection({
          provider: "goethe", seriesNumber, partNumber, title: `Teil 4: ${GOETHE_PART_TITLES[4]}`,
          instruction, partType: "opinion_yes_no", durationMinutes, points,
          metadata: { theme }, questions,
        });
      }

      const rows = parseGoetheChoiceCells(visible, 27, 30);
      const sourceText = separateGoetheTitle(
        getGoetheSourceBeforeQuestion(visible, 27),
        getGoetheEmphasizedTitle(metadata, seriesNumber, partNumber)
      );
      const questions = rows.map((item) => buildQuestion({
        provider: "goethe", seriesNumber, partNumber, partType: "reading_mcq",
        position: item.number, prompt: item.prompt, options: item.options,
        correct: String(answers[5].get(item.number) || "").toLowerCase(), points: 1,
      }));
      return buildSection({
        provider: "goethe", seriesNumber, partNumber, title: `Teil 5: ${GOETHE_PART_TITLES[5]}`,
        instruction, partType: "reading_mcq", durationMinutes, points,
        metadata: { sourceMaterials: [{ label: "Text", text: sourceText }] }, questions,
      });
    });

    return {
      seriesNumber,
      title,
      sourceLabel,
      instructions: "Goethe-Zertifikat B1 Lesen: fünf Teile in einer 60-minütigen Prüfung.",
      scoring: { totalPoints: 30, globalDurationMinutes: 60, parts: GOETHE_PART_POINTS },
      metadata: {
        ...metadata,
        title,
        theme: title,
        sourceLabel,
        parserVersion: PARSER_VERSION,
        globalDurationMinutes: 60,
        structuredB1Lesen: true,
        replacePublishedScope: true,
      },
      sections,
    };
  });
};

const parseOsdSeries = (text, metadata) => {
  const clean = normalizeLineBreaks(text);
  const seriesMatches = getMatches(clean, /(?:^|\n)MODELLSATZ\s+(\d{1,2})\s+—\s+Lesen\s*\(ÖSD B1\)/gi);
  return makeSlices(clean, seriesMatches).map((seriesBlock) => {
    const seriesNumber = Number(seriesBlock.match[1]);
    const correctionIndex = seriesBlock.text.search(/(?:^|\n)LÖSUNGEN\s*-\s*Modellsatz\s+\d+/i);
    const taskText = correctionIndex >= 0 ? seriesBlock.text.slice(0, correctionIndex) : seriesBlock.text;
    const correction = correctionIndex >= 0 ? seriesBlock.text.slice(correctionIndex) : "";
    const answers = parseOsdCorrections(correction);
    const partMatches = getMatches(taskText, /(?:^|\n)Teil\s+([1-5])\s*$/gim);
    const sections = makeSlices(taskText, partMatches).map((partBlock) => {
      const partNumber = Number(partBlock.match[1]);
      const instruction = getInstruction(partBlock.text);
      const points = OSD_PART_POINTS[partNumber];
      const durationMinutes = OSD_PART_DURATIONS[partNumber];
      if (partNumber === 1) {
        const sourceText = lineSlice(partBlock.text, /^TEXTE\s*\/\s*MATÉRIEL À LIRE\b/im, [/^AFFIRMATIONS ET CHOIX\b/im]);
        const options = [
          { value: "Richtig", label: "Richtig" },
          { value: "Falsch", label: "Falsch" },
        ];
        const statements = parseNumberedStatements(lineSlice(partBlock.text, /^AFFIRMATIONS ET CHOIX\b/im), 6);
        const questions = statements.map((item) => buildQuestion({
          provider: "osd", seriesNumber, partNumber, partType: "reading_true_false",
          position: item.number, prompt: item.prompt, options,
          correct: answers[1].get(item.number) || "", points: 1,
        }));
        return buildSection({
          provider: "osd", seriesNumber, partNumber, title: `Teil 1: ${OSD_PART_TITLES[1]}`,
          instruction, partType: "reading_true_false", durationMinutes, points,
          metadata: { sourceMaterials: [{ label: "Text", text: sourceText }] }, questions,
        });
      }
      if (partNumber === 2) {
        const textA = lineSlice(partBlock.text, /^TEXT A\s*-\s*VISIBLE À L[’']ÉTUDIANT\b/im, [/^TEXT B\s*-\s*VISIBLE À L[’']ÉTUDIANT\b/im]);
        const textB = lineSlice(partBlock.text, /^TEXT B\s*-\s*VISIBLE À L[’']ÉTUDIANT\b/im, [/^QUESTIONS ET OPTIONS\b/im]);
        const rows = parseNumberedChoiceRows(lineSlice(partBlock.text, /^QUESTIONS ET OPTIONS\b/im), 6);
        const questions = rows.map((item) => buildQuestion({
          provider: "osd", seriesNumber, partNumber, partType: "reading_mcq",
          position: item.number, prompt: item.prompt, options: item.options,
          correct: answers[2].get(item.number) || "", points: 1,
        }));
        return buildSection({
          provider: "osd", seriesNumber, partNumber, title: `Teil 2: ${OSD_PART_TITLES[2]}`,
          instruction, partType: "reading_mcq", durationMinutes, points,
          metadata: {
            sourceMaterials: [
              { label: "Text A", text: textA },
              { label: "Text B", text: textB },
            ],
          },
          questions,
        });
      }
      if (partNumber === 3) {
        const situations = parseNumberedStatements(
          lineSlice(partBlock.text, /^SITUATIONS\s*-\s*VISIBLES À L[’']ÉTUDIANT\b/im, [/^BANQUE D[’']ANNONCES\b/im]),
          7
        );
        const advertisements = parseOsdAdvertisementTable(lineSlice(partBlock.text, /^BANQUE D[’']ANNONCES\b/im));
        const questions = situations.map((item) => buildQuestion({
          provider: "osd", seriesNumber, partNumber, partType: "situation_ad_match",
          position: item.number, prompt: item.prompt, options: advertisements,
          correct: answers[3].get(item.number) || "", points: 1,
          metadata: { uniqueAnswers: true },
        }));
        return buildSection({
          provider: "osd", seriesNumber, partNumber, title: `Teil 3: ${OSD_PART_TITLES[3]}`,
          instruction, partType: "situation_ad_match", durationMinutes, points,
          metadata: { advertisements, uniqueAnswers: true }, questions,
        });
      }
      if (partNumber === 4) {
        const theme = lineSlice(partBlock.text, /^THÈME COMMUN\s*-\s*VISIBLE À L[’']ÉTUDIANT\b/im, [/^AFFIRMATIONS ET CHOIX\b/im]);
        const options = [
          { value: "dafür", label: "Dafür" },
          { value: "dagegen", label: "Dagegen" },
        ];
        const opinions = parseNumberedStatements(lineSlice(partBlock.text, /^AFFIRMATIONS ET CHOIX\b/im), 7);
        const questions = opinions.map((item) => buildQuestion({
          provider: "osd", seriesNumber, partNumber, partType: "opinion_for_against",
          position: item.number, prompt: item.prompt, options,
          correct: answers[4].get(item.number) || "", points: 1,
        }));
        return buildSection({
          provider: "osd", seriesNumber, partNumber, title: `Teil 4: ${OSD_PART_TITLES[4]}`,
          instruction, partType: "opinion_for_against", durationMinutes, points,
          metadata: { theme }, questions,
        });
      }
      const sourceText = lineSlice(partBlock.text, /^TEXTE\s*\/\s*MATÉRIEL À LIRE\b/im, [/^QUESTIONS ET OPTIONS\b/im]);
      const rows = parseNumberedChoiceRows(lineSlice(partBlock.text, /^QUESTIONS ET OPTIONS\b/im), 4);
      const questions = rows.map((item) => buildQuestion({
        provider: "osd", seriesNumber, partNumber, partType: "reading_mcq",
        position: item.number, prompt: item.prompt, options: item.options,
        correct: answers[5].get(item.number) || "", points: 1,
      }));
      return buildSection({
        provider: "osd", seriesNumber, partNumber, title: `Teil 5: ${OSD_PART_TITLES[5]}`,
        instruction, partType: "reading_mcq", durationMinutes, points,
        metadata: { sourceMaterials: [{ label: "Text", text: sourceText }] }, questions,
      });
    });
    return {
      seriesNumber,
      title: `Modellsatz ${String(seriesNumber).padStart(2, "0")}`,
      sourceLabel: `ÖSD B1 Lesen ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ÖSD Zertifikat B1 Lesen: fünf Teile in 65 Minuten.",
      scoring: { totalPoints: 30, globalDurationMinutes: 65, parts: OSD_PART_POINTS },
      metadata: {
        ...metadata,
        parserVersion: PARSER_VERSION,
        globalDurationMinutes: 65,
        structuredB1Lesen: true,
        replacePublishedScope: true,
      },
      sections,
    };
  });
};

const parseB1StructuredLesenSeries = (text, metadata = {}) => {
  const provider = String(metadata.provider || "").toLowerCase();
  if (provider === "goethe") return parseGoetheSeries(text, metadata);
  if (provider === "telc") return parseTelcSeries(text, metadata);
  if (provider === "ecl") return parseEclSeries(text, metadata);
  if (provider === "osd") return parseOsdSeries(text, metadata);
  return [];
};

module.exports = {
  PARSER_VERSION,
  parseB1StructuredLesenSeries,
};
