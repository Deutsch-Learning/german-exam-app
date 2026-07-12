const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const mammoth = require("mammoth");

const execFileAsync = promisify(execFile);

const MAX_PROMPT_CHARS = 12000;
const MAX_EXPLANATION_CHARS = 12000;
const IMPORT_ANALYZER_VERSION = "documentImport.v2";
const SECTION_LABELS = {
  read: "Compréhension écrite",
  listen: "Compréhension orale",
  write: "Expression écrite",
  speak: "Expression orale",
  sprach: "Sprachbausteine",
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const compactText = (value) =>
  normalizeText(value)
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();

const foldForSearch = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const stripPdfPageMarkers = (value) =>
  String(value ?? "").replace(/\n?\s*---\s*PAGE\s+\d+\s*\/\s*\d+\s*---\s*\n?/gi, "\n");

const slugify = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const hashBuffer = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const getFileExtension = (filename = "") => path.extname(filename).toLowerCase().replace(".", "");

const parseNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeDetectedProvider = (value) => {
  const normalized = slugify(
    String(value ?? "")
      .replace(/Ã¶|Ã–|ã¶|ã–/g, "o")
      .replace(/Ã¶sterreichisch|Ã–sterreichisch|ã¶sterreichisch|ã–sterreichisch/gi, "osterreichisch")
  );
  if (normalized.includes("goethe")) return "goethe";
  if (normalized.includes("osd") || normalized.includes("oesd")) return "osd";
  if (normalized.includes("testdaf")) return "testdaf";
  if (normalized.includes("telc")) return "telc";
  if (normalized.includes("ecl")) return "ecl";
  if (normalized.includes("dsh")) return "dsh";
  if (normalized.includes("delf")) return "delf";
  if (normalized.includes("dalf")) return "dalf";
  return normalized || "custom";
};

const detectProvider = (text) => {
  const rawHaystack = String(text ?? "").toLowerCase();
  const haystack = foldForSearch(text);
  const scores = [
    ["goethe", ["goethe-zertifikat", "goethe", "zertifikat b1"]],
    ["osd", ["osd", "oesd", "ösd", "österreichisches sprachdiplom", "osterreichisches sprachdiplom", "Ã¶sd"]],
    ["telc", ["telc deutsch", "format telc", "telc"]],
    ["ecl", ["ecl"]],
    ["testdaf", ["testdaf"]],
    ["dsh", ["dsh"]],
    ["delf", ["delf"]],
    ["dalf", ["dalf"]],
  ].map(([provider, tokens]) => ({
    provider,
    score: tokens.reduce((sum, token) => {
      const rawToken = String(token).toLowerCase();
      const foldedToken = foldForSearch(token);
      return sum + (haystack.includes(foldedToken) || rawHaystack.includes(rawToken) ? 1 : 0);
    }, 0),
  }));
  scores.sort((a, b) => b.score - a.score);
  return normalizeDetectedProvider(scores[0]?.score > 0 ? scores[0].provider : "custom");
};

const detectLevel = (text) => {
  const match =
    text.match(/\b(A1|A2|B1|B2|C1|C2)\b/i) ||
    text.match(/\bNiveau\s*[:|-]?\s*(A1|A2|B1|B2|C1|C2)\b/i);
  return match ? match[1].toUpperCase() : null;
};

const detectSectionType = (text) => {
  const haystack = foldForSearch(text);
  const scores = {
    read: 0,
    listen: 0,
    write: 0,
    speak: 0,
    sprach: 0,
  };

  [
    ["read", ["leseverstehen", "prufungsteil: lesen", "prüfungsteil: lesen", " lesen ", "richtig/falsch", "compréhension écrite", "comprehension ecrite"]],
    ["listen", ["horverstehen", "hörverstehen", "hoeren", "hören", "audio", "transkript"]],
    ["write", ["schreiben", "schriftlicher ausdruck", "schriftliche kommunikation", "expression écrite", "expression ecrite", "private e-mail", "diskussionsbeitrag", "musterloesung teil", "musterlösung teil"]],
    ["speak", ["sprechen", "mündlicher ausdruck", "muendlicher ausdruck", "mündliche kommunikation", "mundliche kommunikation", "mündliche prüfung", "mundliche pruefung", "gelenktes gespräch", "gelenktes gesprach", "selbständige äußerung", "selbstandige ausserung", "kandidat a", "gemeinsam planen"]],
    ["sprach", ["sprachbausteine", "sprachbaustein", "luecken", "lücken", "lueckentext", "lückentext", "aufgaben 1-10", "aufgaben 11-20"]],
  ].forEach(([section, tokens]) => {
    tokens.forEach((token) => {
      if (haystack.includes(foldForSearch(token))) scores[section] += 1;
    });
  });

  if (/(hören|hörverstehen|hoeren|hoerverstehen|audio script|scripts audio|transkription)/i.test(String(text ?? ""))) {
    scores.listen += 3;
  }

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    : "read";
};

const detectProviderFromFilename = (filename = "") => {
  const normalized = slugify(filename);
  if (normalized.includes("goethe")) return "goethe";
  if (normalized.includes("osd") || normalized.includes("oesd")) return "osd";
  if (normalized.includes("telc")) return "telc";
  if (normalized.includes("ecl")) return "ecl";
  return null;
};

const detectLevelFromFilename = (filename = "") => {
  const match = String(filename || "").match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
  return match ? match[1].toUpperCase() : null;
};

const normalizeListeningProvider = (value) => {
  const provider = normalizeDetectedProvider(value);
  if (["goethe", "telc", "ecl", "osd"].includes(provider)) return provider;
  return provider || "custom";
};

const detectSectionTypeFromFilename = (filename = "") => {
  const normalized = slugify(filename);
  if (normalized.includes("sprachbausteine") || normalized.includes("sprachbaustein")) return "sprach";
  if (normalized.includes("lese") || normalized.includes("lesen")) return "read";
  if (normalized.includes("schreiben") || normalized.includes("schriftlich")) return "write";
  if (normalized.includes("sprechen") || normalized.includes("mundlich") || normalized.includes("muendlich")) return "speak";
  if (normalized.includes("horen") || normalized.includes("hoeren") || normalized.includes("horverstehen")) return "listen";
  return null;
};

const detectExamType = (text, provider, level) => {
  const firstLines = compactText(text).split("\n").slice(0, 8).join(" ");
  if (provider === "goethe" && level) return `Goethe-Zertifikat ${level}`;
  if (provider === "osd" && level) return `ÖSD Zertifikat ${level}`;
  if (provider === "testdaf") return "TestDaF";
  if (provider === "telc" && level) return `telc Deutsch ${level}`;
  if (provider === "ecl" && level) return `ECL Deutsch ${level}`;
  if (provider === "dsh") return "DSH";
  return firstLines.slice(0, 120) || "Imported exam";
};

const splitByMatches = (text, regex) => {
  const matches = [...text.matchAll(regex)];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    return {
      match,
      start: match.index,
      end: next ? next.index : text.length,
      text: text.slice(match.index, next ? next.index : text.length).trim(),
    };
  });
};

const getBetweenMarkers = (text, startRegex, endRegexes = []) => {
  const start = text.search(startRegex);
  if (start < 0) return "";
  const rest = text.slice(start);
  const endCandidates = endRegexes
    .map((regex) => {
      const found = rest.slice(1).search(regex);
      return found >= 0 ? found + 1 : -1;
    })
    .filter((index) => index >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : rest.length;
  return rest.slice(0, end).trim();
};

const extractDurationMinutes = (value) => {
  const match = String(value ?? "").match(/(\d+)\s*Min/i);
  return match ? Number(match[1]) : null;
};

const extractPoints = (value) => {
  const match = String(value ?? "").match(/(\d+)\s*(?:Punkte|P\.|Pkt\.)/i);
  return match ? Number(match[1]) : null;
};

const trimForDb = (value, max = MAX_PROMPT_CHARS) => compactText(value).slice(0, max);

const countMarker = (text, marker) => {
  const regex = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  return [...String(text ?? "").matchAll(regex)].length;
};

const buildListeningImportFoundation = async ({ buffer, filename, mimetype, provider, level }) => {
  const raw = await mammoth.extractRawText({ buffer });
  const text = normalizeText(raw.value || "");
  const detectedProvider = normalizeListeningProvider(provider || detectProviderFromFilename(filename) || detectProvider(text));
  const detectedLevel = String(level || detectLevelFromFilename(filename) || detectLevel(text) || "").toUpperCase() || null;
  const validationWarnings = [];
  const markers = {
    adminOnlyTranscript: countMarker(text, "ADMIN_ONLY_TRANSCRIPT"),
    audioEngineSettings: countMarker(text, "AUDIO_ENGINE_SETTINGS"),
    studentVisibleQuestions: countMarker(text, "STUDENT_VISIBLE_QUESTIONS"),
    correctionVisibleAfterSubmit: countMarker(text, "CORRECTION_VISIBLE_AFTER_SUBMIT"),
  };

  if (!text) validationWarnings.push("The uploaded DOCX did not produce readable text.");
  if (!detectedProvider || detectedProvider === "custom") validationWarnings.push("Provider could not be confidently detected.");
  if (!detectedLevel) validationWarnings.push("Level could not be confidently detected.");
  if (!markers.adminOnlyTranscript) validationWarnings.push("ADMIN_ONLY_TRANSCRIPT marker was not detected.");
  if (!markers.audioEngineSettings) validationWarnings.push("AUDIO_ENGINE_SETTINGS marker was not detected.");
  if (!markers.studentVisibleQuestions) validationWarnings.push("STUDENT_VISIBLE_QUESTIONS marker was not detected.");
  if (!markers.correctionVisibleAfterSubmit) validationWarnings.push("CORRECTION_VISIBLE_AFTER_SUBMIT marker was not detected.");

  const teilMatches = [...text.matchAll(/\bTeil\s+(\d+)\b/gi)];
  const textMatches = [...text.matchAll(/\bText\s+(\d+)\b/gi)];
  const seriesMatches = [...text.matchAll(/\b(?:Sujet|Simulation|Modellpr.fung|Modellprüfung|Pr.fung|Prüfung)\s+(\d+)\b/gi)];
  const duplicateCheck = new Set();
  let duplicateIdentifiers = 0;
  [...teilMatches, ...textMatches, ...seriesMatches].forEach((match) => {
    const key = `${match[0].toLowerCase()}@${match.index}`;
    if (duplicateCheck.has(key)) duplicateIdentifiers += 1;
    duplicateCheck.add(key);
  });

  const draft = {
    type: "listening_import_foundation",
    parserVersion: `${IMPORT_ANALYZER_VERSION}.hoeren.foundation`,
    filename,
    mimetype,
    metadata: {
      provider: detectedProvider,
      examType: detectExamType(text, detectedProvider, detectedLevel),
      level: detectedLevel,
      sectionType: "listen",
      title: compactText(text).split("\n")[0] || filename,
      globalDurationMinutes: extractDurationMinutes(text),
    },
    hierarchy: {
      provider: detectedProvider,
      level: detectedLevel,
      seriesDetected: new Set(seriesMatches.map((match) => Number(match[1]))).size,
      teileDetected: new Set(teilMatches.map((match) => Number(match[1]))).size,
      audioTextBlocksDetected: new Set(textMatches.map((match) => Number(match[1]))).size,
    },
    markerCounts: markers,
    validation: {
      errors: [],
      warnings: [
        ...validationWarnings,
        ...(duplicateIdentifiers ? [`${duplicateIdentifiers} duplicate marker identifiers need review.`] : []),
      ],
    },
    rawTextPreview: text.slice(0, 1800),
    sourceDocument: {
      hash: hashBuffer(buffer),
      filename,
      sizeBytes: buffer.length,
      mimetype,
    },
    note: "STEP 1 draft only. Full marker parsing starts in STEP 2.",
  };

  return {
    documentHash: draft.sourceDocument.hash,
    filename,
    mimetype,
    sizeBytes: buffer.length,
    rawTextPreview: draft.rawTextPreview,
    metadata: draft.metadata,
    validation: draft.validation,
    draft,
  };
};

const buildFallbackQuestion = ({ sectionType, prompt, position, questionType = "compound" }) => ({
  questionType,
  prompt: trimForDb(prompt),
  options: [],
  correctAnswer: {},
  explanation: null,
  position,
  scoring: {},
  metadata: {},
  sectionType,
});

const getSolutionBlock = (solutionMap, number) => solutionMap.get(Number(number)) || "";

const parseSolutionParts = (solutionBlock) => {
  const parts = new Map();
  const markers = [...solutionBlock.matchAll(/Musterloesung\s+Teil\s+([123])\s*:/gi)];
  markers.forEach((match, index) => {
    const next = markers[index + 1];
    const body = solutionBlock.slice(match.index + match[0].length, next ? next.index : solutionBlock.length);
    parts.set(Number(match[1]), trimForDb(body, MAX_EXPLANATION_CHARS));
  });
  return parts;
};

const findWritingSolutionStart = (text) => {
  const primary = text.search(/\nMUSTERLOESUNGEN\b|\nMUSTERL.SUNGEN\b/i);
  if (primary >= 0) return primary;
  const firstSolution = text.search(/\nMusterloesung\s+--\s+Aufgabe\s+\d+/i);
  return firstSolution >= 0 ? firstSolution : -1;
};

const parseWritingSolutionMap = (text) => {
  const solutionStart = findWritingSolutionStart(text);
  if (solutionStart < 0) return new Map();
  const solutionText = text.slice(solutionStart);
  const blocks = splitByMatches(solutionText, /Musterloesung\s+--\s+Aufgabe\s+(\d+)\s*\/\s*\d+/gi);
  return new Map(blocks.map((block) => [Number(block.match[1]), block.text]));
};

const parseWritingSeries = (text, metadata) => {
  const solutionStart = findWritingSolutionStart(text);
  const taskText = solutionStart >= 0 ? text.slice(0, solutionStart) : text;
  const solutionMap = parseWritingSolutionMap(text);
  const taskBlocks = splitByMatches(taskText, /(?:^|\n)Aufgabe\s+(\d+)\s*\/\s*(\d+)/gi);

  return taskBlocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const solutionParts = parseSolutionParts(getSolutionBlock(solutionMap, seriesNumber));
    const partMatches = [...block.text.matchAll(/TEIL\s+([123])\s+[-–]{1,2}\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const header = match[2] || "";
      const partNumber = Number(match[1]);
      const points = extractPoints(header);
      const durationMinutes = extractDurationMinutes(header);
      const prompt = [match[0], body].join("\n");
      return {
        sectionType: "write",
        partNumber,
        title: `Teil ${partNumber}: ${header.split(/\d+\s*Min/i)[0].trim() || "Schreiben"}`,
        instructions: trimForDb(body, 3000),
        durationMinutes,
        points,
        scoring: { points },
        metadata: { sourceHeader: header },
        questions: [
          {
            questionType: partNumber === 2 ? "writing_forum_post" : "writing_email",
            prompt: trimForDb(prompt),
            options: [],
            correctAnswer: solutionParts.get(partNumber) ? { sampleAnswer: solutionParts.get(partNumber) } : {},
            explanation: solutionParts.get(partNumber) || null,
            position: partNumber,
            scoring: { points, durationMinutes },
            metadata: { wordTarget: partNumber === 3 ? 40 : 80 },
            sectionType: "write",
          },
        ],
      };
    });

    return {
      seriesNumber,
      title: `Aufgabe ${seriesNumber}`,
      sourceLabel: `Aufgabe ${seriesNumber} / ${block.match[2]}`,
      instructions: "Goethe B1 Schreiben: drei Schreibteile in 60 Minuten.",
      scoring: { totalPoints: 100, parts: { 1: 40, 2: 40, 3: 20 } },
      metadata: { ...metadata, detectedTotal: Number(block.match[2]) },
      sections: sections.length ? sections : [
        {
          sectionType: "write",
          partNumber: 1,
          title: "Schreiben",
          instructions: trimForDb(block.text, 3000),
          durationMinutes: 60,
          points: 100,
          scoring: { points: 100 },
          metadata: {},
          questions: [buildFallbackQuestion({ sectionType: "write", prompt: block.text, position: 1, questionType: "writing_compound" })],
        },
      ],
    };
  });
};

const parseSpeakingSeries = (text, metadata) => {
  const topicBlocks = splitByMatches(text, /(?:^|\n)Thema\s+(\d+)\s*:\s*([^\n]+)/gi);
  return topicBlocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = compactText(block.match[2]);
    const musterIndex = block.text.search(/MUSTERL.SUNG|Musterloesung|Musterlösung/i);
    const taskBody = musterIndex >= 0 ? block.text.slice(0, musterIndex) : block.text;
    const solutionBody = musterIndex >= 0 ? block.text.slice(musterIndex) : "";
    const partDefs = [
      { partNumber: 1, title: "Gemeinsam planen", type: "speaking_partner_planning", points: 28, durationMinutes: 3 },
      { partNumber: 2, title: "Ein Thema praesentieren", type: "speaking_presentation", points: 40, durationMinutes: 3 },
      { partNumber: 3, title: "Reagieren und diskutieren", type: "speaking_discussion", points: 16, durationMinutes: 2 },
    ];

    const sections = partDefs.map((def, index) => {
      const current = new RegExp(`TEIL\\s+${def.partNumber}\\b`, "i");
      const next = partDefs[index + 1] ? new RegExp(`TEIL\\s+${partDefs[index + 1].partNumber}\\b`, "i") : /$a/;
      const partText = getBetweenMarkers(taskBody, current, [next, /MUSTERL.SUNG|Musterloesung|Musterlösung/i]);
      const solutionText = getBetweenMarkers(solutionBody, new RegExp(`Teil\\s+${def.partNumber}|Teil\\s+${def.partNumber}A|Teil\\s+${def.partNumber}B`, "i"), [
        new RegExp(`Teil\\s+${def.partNumber + 1}`, "i"),
        /Thema\s+\d+\s*:/i,
      ]);
      const prompt = partText || `${def.title}\n${taskBody}`;
      return {
        sectionType: "speak",
        partNumber: def.partNumber,
        title: `Teil ${def.partNumber}: ${def.title}`,
        instructions: trimForDb(partText || taskBody, 3000),
        durationMinutes: def.durationMinutes,
        points: def.points,
        scoring: { points: def.points, durationMinutes: def.durationMinutes },
        metadata: {},
        questions: [
          {
            questionType: def.type,
            prompt: trimForDb(prompt),
            options: [],
            correctAnswer: solutionText ? { sampleAnswer: trimForDb(solutionText, MAX_EXPLANATION_CHARS) } : {},
            explanation: solutionText ? trimForDb(solutionText, MAX_EXPLANATION_CHARS) : null,
            position: def.partNumber,
            scoring: { points: def.points, durationMinutes: def.durationMinutes },
            metadata: {},
            sectionType: "speak",
          },
        ],
      };
    });

    return {
      seriesNumber,
      title,
      sourceLabel: `Thema ${seriesNumber}`,
      instructions: "Goethe B1 Sprechen: Paarpruefung mit Planen, Praesentation und Reaktion.",
      scoring: { totalPoints: 84, parts: { 1: 28, 2: 40, 3: 16 } },
      metadata,
      sections,
    };
  });
};

const parseAnswerKeyMap = (solutionText) => {
  const map = new Map();
  const blocks = splitByMatches(solutionText, /Pr.fungsheft\s+(\d+)\s+[–-]\s+Thema\s*:\s*([^\n]+)/gi);
  blocks.forEach((block) => {
    const answers = new Map();
    for (const match of block.text.matchAll(/\b(\d{1,2})\s+(Richtig|Falsch|Ja|Nein|[abc])\b/g)) {
      answers.set(Number(match[1]), match[2]);
    }
    map.set(Number(block.match[1]), {
      title: compactText(block.match[2]),
      answers,
    });
  });
  return map;
};

const extractMultipleChoiceQuestions = (partText, answerMap, startPosition) => {
  const questions = [];
  const regex = /Aufgabe\s+(\d{1,2})\s*:\s*([\s\S]*?)(?=\nAufgabe\s+\d{1,2}\s*:|\nTEIL\s+\d|\n--- PAGE|$)/gi;
  for (const match of partText.matchAll(regex)) {
    const number = Number(match[1]);
    const body = compactText(match[2]);
    const optionMatches = [...body.matchAll(/\bn\s+([abc])\)\s*([\s\S]*?)(?=\bn\s+[abc]\)|$)/gi)];
    const options = optionMatches.map((optionMatch) => ({
      value: optionMatch[1].toLowerCase(),
      label: compactText(optionMatch[2]),
    }));
    const promptOnly = body.replace(/\bn\s+[abc]\)\s*[\s\S]*$/i, "").trim();
    questions.push({
      questionType: "multiple_choice",
      prompt: trimForDb(promptOnly || body),
      options,
      correctAnswer: answerMap.get(number) ? { value: answerMap.get(number) } : {},
      explanation: null,
      position: number || startPosition + questions.length,
      scoring: { points: 1 },
      metadata: { sourceQuestionNumber: number },
      sectionType: "read",
    });
  }
  return questions;
};

const extractLineQuestions = ({ partText, answerMap, questionType, sectionType = "read" }) => {
  const questions = [];
  const lines = compactText(partText).split("\n");
  for (const line of lines) {
    const match = line.match(/^(\d{1,2})\s+(.+?)\s+(?:n\s+n|___)$/i);
    if (!match) continue;
    const number = Number(match[1]);
    questions.push({
      questionType,
      prompt: trimForDb(match[2]),
      options:
        questionType === "true_false"
          ? [{ value: "Richtig", label: "Richtig" }, { value: "Falsch", label: "Falsch" }]
          : questionType === "yes_no"
            ? [{ value: "Ja", label: "Ja" }, { value: "Nein", label: "Nein" }]
            : [],
      correctAnswer: answerMap.get(number) ? { value: answerMap.get(number) } : {},
      explanation: null,
      position: number,
      scoring: { points: 1 },
      metadata: { sourceQuestionNumber: number },
      sectionType,
    });
  }
  return questions;
};

const parseReadingPartQuestions = (partNumber, partText, answerMap) => {
  const expectedRanges = {
    1: [1, 6],
    2: [7, 12],
    3: [13, 19],
    4: [20, 26],
    5: [27, 30],
  };
  let questions = [];
  if (partNumber === 1) {
    questions = extractLineQuestions({ partText, answerMap, questionType: "true_false" });
  } else if (partNumber === 2 || partNumber === 5) {
    questions = extractMultipleChoiceQuestions(partText, answerMap, partNumber === 2 ? 7 : 27);
  } else if (partNumber === 3) {
    questions = extractLineQuestions({ partText, answerMap, questionType: "matching" }).map((question) => ({
      ...question,
      options: [],
      metadata: { ...question.metadata, matchingOptionsIncludedInSectionText: true },
    }));
  } else if (partNumber === 4) {
    questions = extractLineQuestions({ partText, answerMap, questionType: "yes_no" });
  }

  const range = expectedRanges[partNumber];
  if (range) {
    const existing = new Set(questions.map((question) => Number(question.position)));
    for (let number = range[0]; number <= range[1]; number += 1) {
      if (existing.has(number)) continue;
      questions.push({
        questionType:
          partNumber === 1
            ? "true_false"
            : partNumber === 4
              ? "yes_no"
              : partNumber === 3
                ? "matching"
                : "multiple_choice",
        prompt: `Aufgabe ${number}: see source section text.`,
        options:
          partNumber === 1
            ? [{ value: "Richtig", label: "Richtig" }, { value: "Falsch", label: "Falsch" }]
            : partNumber === 4
              ? [{ value: "Ja", label: "Ja" }, { value: "Nein", label: "Nein" }]
              : [],
        correctAnswer: answerMap.get(number) ? { value: answerMap.get(number) } : {},
        explanation: null,
        position: number,
        scoring: { points: 1 },
        metadata: { sourceQuestionNumber: number, extractedPromptIncomplete: true },
        sectionType: "read",
      });
    }
  }
  return questions.sort((a, b) => a.position - b.position);
};

const parseReadingSeries = (text, metadata) => {
  const solutionStart = text.search(/L.SUNGSSCHL.SSEL/i);
  const taskText = solutionStart >= 0 ? text.slice(0, solutionStart) : text;
  const solutionText = solutionStart >= 0 ? text.slice(solutionStart) : "";
  const answerKey = parseAnswerKeyMap(solutionText);
  const bookletBlocks = splitByMatches(taskText, /(?:^|\n)PR.FUNGSHEFT\s+(\d+)\s*\|\s*Thema\s*:\s*([^\n]+)/gi);

  return bookletBlocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = compactText(block.match[2]);
    const answers = answerKey.get(seriesNumber)?.answers || new Map();
    const partMatches = [...block.text.matchAll(/TEIL\s+([1-5])\s*\|\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = match[2] || "";
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const questions = parseReadingPartQuestions(partNumber, body, answers);
      return {
        sectionType: "read",
        partNumber,
        title: `Teil ${partNumber}`,
        instructions: trimForDb([match[0], body].join("\n"), 4000),
        durationMinutes: extractDurationMinutes(header),
        points: partNumber === 5 ? 4 : partNumber === 1 || partNumber === 2 ? 6 : 7,
        scoring: { points: partNumber === 5 ? 4 : partNumber === 1 || partNumber === 2 ? 6 : 7 },
        metadata: { sourceHeader: header },
        questions: questions.length
          ? questions
          : [buildFallbackQuestion({ sectionType: "read", prompt: [match[0], body].join("\n"), position: partNumber, questionType: "reading_compound" })],
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Pruefungsheft ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "Goethe B1 Lesen: 5 Teile, 65 Minuten, 30 Punkte.",
      scoring: { totalPoints: 30, parts: { 1: 6, 2: 6, 3: 7, 4: 7, 5: 4 } },
      metadata: {
        ...metadata,
        answerKeyDetected: answers.size > 0,
      },
      sections: sections.length ? sections : [
        {
          sectionType: "read",
          partNumber: 1,
          title: "Lesen",
          instructions: trimForDb(block.text, 4000),
          durationMinutes: 65,
          points: 30,
          scoring: { points: 30 },
          metadata: {},
          questions: [buildFallbackQuestion({ sectionType: "read", prompt: block.text, position: 1, questionType: "reading_compound" })],
        },
      ],
    };
  });
};

const extractOsdHeaderTitle = (header, marker = "") => {
  let title = compactText(header)
    .replace(/^SUJET\s+0?\d+\b/i, "")
    .trim();
  if (marker) {
    title = title.replace(new RegExp(`^.*?\\b${marker}\\b`, "i"), "").trim();
  }
  return title.replace(/^[\s|:;.,\-–—]+/g, "").trim();
};

const extractOsdPartHeader = (header) =>
  compactText(header)
    .replace(/^TEIL\s+\d+\b/i, "")
    .replace(/^[\s|:;.,\-–—]+/g, "")
    .trim();

const extractWordTarget = (value) => {
  const match = String(value ?? "").match(/ca\.\s*(\d+)\s*W\S*rter/i);
  return match ? Number(match[1]) : null;
};

const getOsdPartText = (text, partNumber) => {
  const endMarkers = partNumber < 5 ? [new RegExp(`TEIL\\s+${partNumber + 1}\\b`, "i")] : [];
  return getBetweenMarkers(text, new RegExp(`TEIL\\s+${partNumber}\\b`, "i"), endMarkers);
};

const normalizeOsdMcValue = (value) => String(value ?? "").trim().slice(0, 1).toLowerCase();

const parseOsdReadingAnswerMap = (solutionText) => {
  const answers = new Map();
  const part1 = compactText(getOsdPartText(solutionText, 1));
  part1.split("\n").forEach((line) => {
    const match = line.match(/^(\d{1,2})\s+.+\s+(Richtig|Falsch)$/i);
    if (match) answers.set(Number(match[1]), match[2]);
  });

  const part2 = getOsdPartText(solutionText, 2);
  for (const match of part2.matchAll(/\bQ\s*(\d{1,2})\s*:\s*([ABC])/gi)) {
    answers.set(6 + Number(match[1]), normalizeOsdMcValue(match[2]));
  }

  const part3 = getOsdPartText(solutionText, 3);
  for (const match of part3.matchAll(/\bSit\.\s*(\d{1,2})\s*:\s*([A-JX])/gi)) {
    answers.set(12 + Number(match[1]), normalizeOsdMcValue(match[2]));
  }

  const part4 = compactText(getOsdPartText(solutionText, 4));
  part4.split("\n").forEach((line) => {
    const match = line.match(/^(\d{1,2})\s+Brief\s+\d+\b.+\s+(Daf\S*r|Dagegen|Beides)$/i);
    if (match) answers.set(19 + Number(match[1]), compactText(match[2]));
  });

  const part5 = getOsdPartText(solutionText, 5);
  for (const match of part5.matchAll(/\bQ\s*(\d{1,2})\s*:\s*([ABC])/gi)) {
    answers.set(26 + Number(match[1]), normalizeOsdMcValue(match[2]));
  }

  return answers;
};

const extractOsdTrueFalseQuestions = (partText, answerMap) => {
  const questions = [];
  const body = compactText(stripPdfPageMarkers(partText));
  for (const match of body.matchAll(/(?:^|\n)\s*(\d{1,2})\s+(.+?)\s+n\s+n\s*(?=\n|$)/gi)) {
    const position = Number(match[1]);
    questions.push({
      questionType: "true_false",
      prompt: trimForDb(match[2]),
      options: [{ value: "Richtig", label: "Richtig" }, { value: "Falsch", label: "Falsch" }],
      correctAnswer: answerMap.get(position) ? { value: answerMap.get(position) } : {},
      explanation: null,
      position,
      scoring: { points: 1 },
      metadata: { sourceQuestionNumber: position, osdPart: 1 },
      sectionType: "read",
    });
  }
  return questions;
};

const extractOsdMultipleChoiceQuestions = (partText, answerMap, offset, osdPart) => {
  const questions = [];
  const body = compactText(stripPdfPageMarkers(partText));
  const questionRegex = /(?:^|\n)\s*(\d{1,2})\.\s*([^\n]+(?:\n(?!\s*(?:[abc]\)|\d{1,2}\.|TEIL\s+\d))[^\n]+)*)\n\s*a\)\s*([\s\S]*?)(?=\n\s*\d{1,2}\.\s|\n\s*TEIL\s+\d|$)/gi;
  for (const match of body.matchAll(questionRegex)) {
    const sourceNumber = Number(match[1]);
    const fullQuestion = match[0];
    const options = [...fullQuestion.matchAll(/(?:^|\n)\s*([abc])\)\s*([^\n]+(?:\n(?!\s*[abc]\)|\s*\d{1,2}\.)[^\n]+)*)/gi)].map(
      (optionMatch) => ({
        value: optionMatch[1].toLowerCase(),
        label: compactText(optionMatch[2]),
      })
    );
    if (options.length < 2) continue;
    const position = offset + sourceNumber;
    questions.push({
      questionType: "multiple_choice",
      prompt: trimForDb(compactText(match[2])),
      options,
      correctAnswer: answerMap.get(position) ? { value: answerMap.get(position) } : {},
      explanation: null,
      position,
      scoring: { points: 1 },
      metadata: { sourceQuestionNumber: sourceNumber, osdPart },
      sectionType: "read",
    });
  }
  return questions;
};

const extractOsdMatchingOptions = (partText) => {
  const clean = compactText(stripPdfPageMarkers(partText));
  const AnzeigenIndex = clean.search(/(?:^|\n)Anzeigen\s*\([A-J]/i);
  if (AnzeigenIndex < 0) return [];
  const optionText = clean.slice(AnzeigenIndex);
  return [...optionText.matchAll(/(?:^|\n)\s*([A-J])\s+([\s\S]*?)(?=\n\s*[A-J]\s+|\n\s*TEIL\s+\d|$)/g)].map((match) => ({
    value: match[1].toLowerCase(),
    label: `${match[1]} - ${compactText(match[2])}`,
  }));
};

const extractOsdMatchingQuestions = (partText, answerMap) => {
  const clean = compactText(stripPdfPageMarkers(partText));
  const AnzeigenIndex = clean.search(/(?:^|\n)Anzeigen\s*\([A-J]/i);
  const situationText = AnzeigenIndex >= 0 ? clean.slice(0, AnzeigenIndex) : clean;
  const options = extractOsdMatchingOptions(partText);
  const questions = [];
  for (const match of situationText.matchAll(/(?:^|\n)\s*(\d{1,2})\.\s*([\s\S]*?)\s*_{2,}/g)) {
    const sourceNumber = Number(match[1]);
    const position = 12 + sourceNumber;
    questions.push({
      questionType: "matching",
      prompt: trimForDb(compactText(match[2])),
      options,
      correctAnswer: answerMap.get(position) ? { value: answerMap.get(position) } : {},
      explanation: null,
      position,
      scoring: { points: 1 },
      metadata: { sourceQuestionNumber: sourceNumber, osdPart: 3, matchingOptionsIncludedInSectionText: true },
      sectionType: "read",
    });
  }
  return questions;
};

const extractOsdOpinionQuestions = (partText, answerMap) => {
  const questions = [];
  const clean = compactText(stripPdfPageMarkers(partText));
  const tableIndex = clean.search(/(?:^|\n)Nr\.\s+Leserbrief/i);
  const tableText = tableIndex >= 0 ? clean.slice(tableIndex) : clean;
  for (const match of tableText.matchAll(/(?:^|\n)\s*(\d{1,2})\s+(Brief\s+\d+\s+[^\n]+?)\s+n\s+n\s+n\s*(?=\n|$)/gi)) {
    const sourceNumber = Number(match[1]);
    const position = 19 + sourceNumber;
    questions.push({
      questionType: "multiple_choice",
      prompt: trimForDb(compactText(match[2])),
      options: [
        { value: "Dafür", label: "Dafür" },
        { value: "Dagegen", label: "Dagegen" },
        { value: "Beides", label: "Beides" },
      ],
      correctAnswer: answerMap.get(position) ? { value: answerMap.get(position) } : {},
      explanation: null,
      position,
      scoring: { points: 1 },
      metadata: { sourceQuestionNumber: sourceNumber, osdPart: 4 },
      sectionType: "read",
    });
  }
  return questions;
};

const parseOsdReadingPartQuestions = (partNumber, partText, answerMap) => {
  if (partNumber === 1) return extractOsdTrueFalseQuestions(partText, answerMap);
  if (partNumber === 2) return extractOsdMultipleChoiceQuestions(partText, answerMap, 6, 2);
  if (partNumber === 3) return extractOsdMatchingQuestions(partText, answerMap);
  if (partNumber === 4) return extractOsdOpinionQuestions(partText, answerMap);
  if (partNumber === 5) return extractOsdMultipleChoiceQuestions(partText, answerMap, 26, 5);
  return [];
};

const parseOsdReadingSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const blocks = splitByMatches(clean, /(?:^|\n)SUJET\s+0?(\d{1,2})\b[^\n]*\bLESEN\b[^\n]*/gi);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = extractOsdHeaderTitle(block.match[0], "LESEN") || `Sujet ${String(seriesNumber).padStart(2, "0")}`;
    const correctionIndex = block.text.search(/(?:^|\n)CORRECTION\s+COMPLETE\b/i);
    const taskText = correctionIndex >= 0 ? block.text.slice(0, correctionIndex) : block.text;
    const solutionText = correctionIndex >= 0 ? block.text.slice(correctionIndex) : "";
    const answers = parseOsdReadingAnswerMap(solutionText);
    const partMatches = [...taskText.matchAll(/(?:^|\n)TEIL\s+([1-5])\b[^\n]*/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = extractOsdPartHeader(match[0]);
      const body = taskText.slice(match.index + match[0].length, next ? next.index : taskText.length);
      const questions = parseOsdReadingPartQuestions(partNumber, body, answers);
      const points = partNumber === 5 ? 4 : partNumber === 1 || partNumber === 2 ? 6 : 7;
      return {
        sectionType: "read",
        partNumber,
        title: `Teil ${partNumber}: ${header.split(/[|—–-]/)[0].trim() || "Lesen"}`,
        instructions: trimForDb([compactText(match[0]), body].join("\n"), 8000),
        durationMinutes: null,
        points,
        scoring: { points },
        metadata: { sourceHeader: header, osdFormat: true },
        questions,
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ÖSD B1 Lesen: 5 Teile, 30 Aufgaben.",
      scoring: { totalPoints: 30, parts: { 1: 6, 2: 6, 3: 7, 4: 7, 5: 4 } },
      metadata: {
        ...metadata,
        osdFormat: true,
        answerKeyDetected: answers.size > 0,
      },
      sections,
    };
  });
};

const splitOsdCorrection = (partBody) => {
  const correctionMatch = partBody.match(/(?:^|\n)\s*4\s+Corrig\S*\s*(?:[\/\-–—]\s*)?(?:Erwartete\s+Leistungen|Bewertungshinweise)?\s*:/i);
  if (!correctionMatch) {
    return {
      prompt: compactText(partBody),
      expectedPerformance: "",
      sampleAnswer: "",
    };
  }
  const prompt = partBody.slice(0, correctionMatch.index).trim();
  const correction = partBody.slice(correctionMatch.index + correctionMatch[0].length).trim();
  const sampleMatch = correction.match(/(?:^|\n)\s*\.?\s*Musterantwort[\s\S]*?:\s*/i);
  const expectedPerformance = sampleMatch ? correction.slice(0, sampleMatch.index).trim() : correction;
  const sampleAnswer = sampleMatch ? correction.slice(sampleMatch.index + sampleMatch[0].length).trim() : "";
  return {
    prompt: compactText(prompt),
    expectedPerformance: compactText(expectedPerformance),
    sampleAnswer: compactText(sampleAnswer),
  };
};

const parseOsdWritingSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const blocks = splitByMatches(clean, /(?:^|\n)SUJET\s+0?(\d{1,2})\s*\|\s*([^\n]+)/gi);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = compactText(block.match[2]) || `Sujet ${String(seriesNumber).padStart(2, "0")}`;
    const partMatches = [...block.text.matchAll(/(?:^|\n)TEIL\s+([123])\b[^\n]*/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = extractOsdPartHeader(match[0]);
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const correction = splitOsdCorrection(body);
      const points = extractPoints(header) || (partNumber === 3 ? 20 : 40);
      const durationMinutes = extractDurationMinutes(header) || (partNumber === 3 ? 15 : partNumber === 2 ? 25 : 20);
      const wordTarget = extractWordTarget(header) || (partNumber === 3 ? 40 : 80);
      const correctAnswer = {};
      if (correction.sampleAnswer) correctAnswer.sampleAnswer = correction.sampleAnswer;
      if (correction.expectedPerformance) correctAnswer.expectedPerformance = correction.expectedPerformance;
      return {
        sectionType: "write",
        partNumber,
        title: `Teil ${partNumber}: ${header.split("|")[0].trim() || "Schreiben"}`,
        instructions: trimForDb(correction.prompt || body, 4000),
        durationMinutes,
        points,
        scoring: { points, durationMinutes },
        metadata: { sourceHeader: header, osdFormat: true },
        questions: [
          {
            questionType: partNumber === 2 ? "writing_forum_post" : "writing_email",
            prompt: trimForDb([compactText(match[0]), correction.prompt || body].join("\n")),
            options: [],
            correctAnswer,
            explanation: correction.expectedPerformance || correction.sampleAnswer || null,
            position: partNumber,
            scoring: { points, durationMinutes },
            metadata: { wordTarget, osdPart: partNumber },
            sectionType: "write",
          },
        ],
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ÖSD B1 Schreiben: drei Schreibaufgaben in 60 Minuten.",
      scoring: { totalPoints: 100, parts: { 1: 40, 2: 40, 3: 20 } },
      metadata: { ...metadata, osdFormat: true },
      sections,
    };
  });
};

const parseOsdSpeakingSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const blocks = splitByMatches(clean, /(?:^|\n)SUJET\s+0?(\d{1,2})\s*\|\s*([^\n]+)/gi);
  const partTypes = {
    1: "speaking_partner_planning",
    2: "speaking_presentation",
    3: "speaking_discussion",
  };
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = compactText(block.match[2]) || `Sujet ${String(seriesNumber).padStart(2, "0")}`;
    const partMatches = [...block.text.matchAll(/(?:^|\n)TEIL\s+([123])\b[^\n]*/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = extractOsdPartHeader(match[0]);
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const correction = splitOsdCorrection(body);
      const points = extractPoints(header) || (partNumber === 1 ? 28 : partNumber === 2 ? 40 : 16);
      const durationMinutes = extractDurationMinutes(header) || (partNumber === 1 || partNumber === 2 ? 3 : 2);
      const correctAnswer = {};
      if (correction.expectedPerformance) correctAnswer.expectedPerformance = correction.expectedPerformance;
      return {
        sectionType: "speak",
        partNumber,
        title: `Teil ${partNumber}: ${header.split("|")[0].trim() || "Sprechen"}`,
        instructions: trimForDb(correction.prompt || body, 4000),
        durationMinutes,
        points,
        scoring: { points, durationMinutes },
        metadata: { sourceHeader: header, osdFormat: true },
        questions: [
          {
            questionType: partTypes[partNumber] || "speaking_prompt",
            prompt: trimForDb([compactText(match[0]), correction.prompt || body].join("\n")),
            options: [],
            correctAnswer,
            explanation: correction.expectedPerformance || null,
            position: partNumber,
            scoring: { points, durationMinutes },
            metadata: { osdPart: partNumber },
            sectionType: "speak",
          },
        ],
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ÖSD B1 Sprechen: drei mündliche Aufgaben.",
      scoring: { totalPoints: 84, parts: { 1: 28, 2: 40, 3: 16 } },
      metadata: { ...metadata, osdFormat: true },
      sections,
    };
  });
};

const findEclCorrectionStart = (text) => {
  const index = String(text ?? "").search(/CORRIG\S*\s+(?:OFFICIEL|COMPLET)/i);
  if (index >= 0) return index;
  const fallback = String(text ?? "").search(/(?:^|\n)\s*n?\s*CORRECTIONS\s+[-\u2010-\u2015]\s+(?:ALLE|TOUS\s+LES)\s+20\s+SUJETS/i);
  return fallback >= 0 ? fallback : -1;
};

const normalizeEclSeriesTitle = (block, initialTitle) => {
  const continuationLines = block.text
    .slice(block.match[0].length)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const continuation = [];
  for (const line of continuationLines) {
    if (/^(Niveau|Durée|Dictionnaire|Points|Aufgabe|TEIL|Teil)\b/i.test(line)) break;
    continuation.push(line);
  }
  return compactText([initialTitle, ...continuation].join(" "));
};

const stripEclResponseMarker = (value) =>
  String(value ?? "").replace(/\n?\s*Votre réponse\s+—\s+Aufgabe\s+\d+[^\n]*/gi, "\n");

const extractEclWordTarget = (value) => {
  const match = String(value ?? "").match(/(?:ca\.|environ)\s*(\d+)\s*W\S*rter/i);
  return match ? Number(match[1]) : null;
};

const parseEclReadingAnswerMap = (solutionText) => {
  const answers = new Map();
  const part1 = getBetweenMarkers(solutionText, /Aufgabe\s+1\b/i, [/Aufgabe\s+2\b/i]);
  for (const match of part1.matchAll(/\bItem\s+(\d{1,2})\s+(R|F|NT)\b/gi)) {
    answers.set(Number(match[1]), match[2].toUpperCase());
  }

  const part2 = getBetweenMarkers(solutionText, /Aufgabe\s+2\b/i, []);
  for (const match of part2.matchAll(/\bItem\s+(\d{1,2})\s+([abc])\b/gi)) {
    answers.set(10 + Number(match[1]), match[2].toLowerCase());
  }
  return answers;
};

const parseEclReadingAnswerKeys = (solutionText) => {
  const blocks = splitByMatches(solutionText, /(?:^|\n)Sujet\s+0?(\d{1,2})\s+[-–—]\s*([^\n]+)/gi);
  return new Map(
    blocks.map((block) => [
      Number(block.match[1]),
      {
        title: compactText(block.match[2]),
        answers: parseEclReadingAnswerMap(block.text),
      },
    ])
  );
};

const extractEclRfntQuestions = (partText, answerMap) => {
  const questions = [];
  const body = compactText(stripPdfPageMarkers(partText));
  for (const match of body.matchAll(/(?:^|\n)\s*(\d{1,2})\s+(.+?)\s*n\s+n\s+n\s*(?=\n|$)/gi)) {
    const position = Number(match[1]);
    questions.push({
      questionType: "multiple_choice",
      prompt: trimForDb(match[2]),
      options: [
        { value: "R", label: "Richtig" },
        { value: "F", label: "Falsch" },
        { value: "NT", label: "Steht nicht im Text" },
      ],
      correctAnswer: answerMap.get(position) ? { value: answerMap.get(position) } : {},
      explanation: null,
      position,
      scoring: { points: 1.25 },
      metadata: { sourceQuestionNumber: position, eclPart: 1 },
      sectionType: "read",
    });
  }
  return questions;
};

const extractEclMultipleChoiceQuestions = (partText, answerMap, offset, eclPart) => {
  const questions = [];
  const body = compactText(stripPdfPageMarkers(partText));
  const blocks = splitByMatches(body, /(?:^|\n)\s*(\d{1,2})\.\s+/g);
  for (const block of blocks) {
    const sourceNumber = Number(block.match[1]);
    const raw = block.text.replace(/^\s*\d{1,2}\.\s+/, "").trim();
    const optionStart = raw.search(/(?:^|\n)\s*n?\s*a\)/i);
    if (optionStart < 0) continue;
    const prompt = raw.slice(0, optionStart).trim();
    const optionsText = raw.slice(optionStart);
    const options = [...optionsText.matchAll(/(?:^|\n)\s*n?\s*([abc])\)\s*([\s\S]*?)(?=\n\s*n?\s*[abc]\)|$)/gi)]
      .map((optionMatch) => ({
        value: optionMatch[1].toLowerCase(),
        label: compactText(optionMatch[2]),
      }))
      .filter((option) => option.label);
    if (options.length < 2) continue;
    const position = offset + sourceNumber;
    questions.push({
      questionType: "multiple_choice",
      prompt: trimForDb(compactText(prompt)),
      options,
      correctAnswer: answerMap.get(position) ? { value: answerMap.get(position) } : {},
      explanation: null,
      position,
      scoring: { points: 1.25 },
      metadata: { sourceQuestionNumber: sourceNumber, eclPart },
      sectionType: "read",
    });
  }
  return questions;
};

const parseEclReadingSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const correctionStart = findEclCorrectionStart(clean);
  const taskText = correctionStart >= 0 ? clean.slice(0, correctionStart) : clean;
  const solutionText = correctionStart >= 0 ? clean.slice(correctionStart) : "";
  const answerKey = parseEclReadingAnswerKeys(solutionText);
  const blocks = splitByMatches(taskText, /(?:^|\n)Sujet\s+0?(\d{1,2})\s+[-–—]\s*([^\n]+)/gi);

  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = normalizeEclSeriesTitle(block, block.match[2]) || `Sujet ${String(seriesNumber).padStart(2, "0")}`;
    const answers = answerKey.get(seriesNumber)?.answers || new Map();
    const partMatches = [...block.text.matchAll(/(?:^|\n)Aufgabe\s+([12])\s+[-–—]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const questions =
        partNumber === 1
          ? extractEclRfntQuestions(body, answers)
          : extractEclMultipleChoiceQuestions(body, answers, 10, 2);
      return {
        sectionType: "read",
        partNumber,
        title: `Aufgabe ${partNumber}: ${compactText(match[2])}`,
        instructions: trimForDb([compactText(match[0]), body].join("\n"), 8000),
        durationMinutes: partNumber === 1 ? 18 : 17,
        points: partNumber === 1 ? 13 : 12,
        scoring: { points: partNumber === 1 ? 12.5 : 12.5, durationMinutes: partNumber === 1 ? 18 : 17 },
        metadata: { sourceHeader: compactText(match[2]), eclFormat: true },
        questions,
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ECL B1 Leseverstehen: zwei Leseteile, 35 Minuten, 25 Punkte.",
      scoring: { totalPoints: 25, parts: { 1: 12.5, 2: 12.5 } },
      metadata: { ...metadata, eclFormat: true, answerKeyDetected: answers.size > 0 },
      sections,
    };
  });
};

const findEclListeningCorrectionStart = (text) => {
  const index = String(text ?? "").search(/(?:^|\n)\s*n?\s*CORRECTIONS\s+[-–—]\s+ALLE\s+20\s+SUJETS/i);
  return index >= 0 ? index : -1;
};

const parseEclListeningAnswerKeys = (solutionText) => {
  const blocks = splitByMatches(solutionText, /(?:^|\n)SUJET\s+N[°º]?\s*0?(\d{1,2})\s*[-–—]\s*([^\n]+)/gi);
  const answerKeys = new Map();
  blocks.forEach((block) => {
    const seriesNumber = Number(block.match[1]);
    const parts = new Map();
    const partMatches = [...block.text.matchAll(/(?:^|\n)\s*TEIL\s+([12])\s*[-–—]\s*([^\n:]+)\s*:/gi)];
    const parsedPartMatches = partMatches.length
      ? partMatches
      : [...block.text.matchAll(/(?:^|\n)\s*TEIL\s+([12])\s*[-\u2010-\u2015]\s*([^\n:]+)\s*:/gi)];
    parsedPartMatches.forEach((match, index) => {
      const next = parsedPartMatches[index + 1];
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const answers = new Map();
      compactText(body).split("\n").forEach((line) => {
        const answerMatch = line.match(/^\s*(\d{1,2})\.\s+(.+?)\s*(?:→|->|=>)\s*(.+?)\s*$/);
        if (!answerMatch) return;
        answers.set(Number(answerMatch[1]), compactText(answerMatch[3]));
      });
      if (!answers.size) {
        compactText(body).split("\n").forEach((line) => {
          const answerMatch = line.match(/^\s*(\d{1,2})\.\s+(.+?)\s*→\s*(.+?)\s*$/);
          if (answerMatch) answers.set(Number(answerMatch[1]), compactText(answerMatch[3]));
        });
      }
      parts.set(Number(match[1]), answers);
    });
    answerKeys.set(seriesNumber, parts);
  });
  return answerKeys;
};

const getEclListeningPartBlocks = (taskText) =>
  splitByMatches(
    taskText,
    /(?:^|\n)SUJET\s+N[°º]?\s*0?(\d{1,2})\s*[-–—]\s*TEIL\s+([12])\s*:\s*([^\n]+)/gi
  ).filter((block) => {
    const seriesNumber = Number(block.match[1]);
    const partNumber = Number(block.match[2]);
    return seriesNumber >= 1 && seriesNumber <= 99 && [1, 2].includes(partNumber);
  });

const extractEclListeningHeader = (partText) => ({
  documentType: compactText(partText.match(/Type\s+de\s+document\s*:\s*([^\n]+)/i)?.[1] || ""),
  situation: compactText(partText.match(/Situation\s*:\s*([^\n]+)/i)?.[1] || ""),
});

const extractEclTranscript = (partText) => {
  const block = getBetweenMarkers(partText, /TRANSKRIPT\s+DES\s+AUDIODOKUMENTS/i, [
    /(?:^|\n)\s*Beispiel\s*\(0\)/i,
    /(?:^|\n)\s*AUFGABEN\b/i,
    /(?:^|\n)\s*n{1,2}\s*FICHE\s+AUDIO/i,
  ]);
  return trimForDb(
    block
      .replace(/^\s*n?\s*TRANSKRIPT\s+DES\s+AUDIODOKUMENTS\s*/i, "")
      .trim(),
    MAX_EXPLANATION_CHARS
  );
};

const extractEclTaskArea = (partText) =>
  getBetweenMarkers(partText, /(?:^|\n)\s*AUFGABEN\b/i, [
    /(?:^|\n)\s*n{1,2}\s*FICHE\s+AUDIO/i,
    /(?:^|\n)SUJET\s+N[°º]?\s*0?\d{1,2}\s*[-–—]\s*TEIL\s+[12]\s*:/i,
  ])
    .replace(/^\s*AUFGABEN\s*/i, "")
    .trim();

const normalizeChoiceValue = (value) => String(value ?? "").trim().slice(0, 1).toUpperCase();

const extractEclListeningQcmQuestions = ({ taskArea, answers, transcript, audio, seriesNumber, partNumber }) => {
  const questions = [];
  const blocks = splitByMatches(compactText(taskArea), /(?:^|\n)\s*(\d{1,2})\.\s+/g);
  for (const block of blocks) {
    const sourceNumber = Number(block.match[1]);
    const raw = block.text.replace(/^\s*\d{1,2}\.\s+/, "").trim();
    const optionStart = raw.search(/(?:^|\n)\s*A\//i);
    if (optionStart < 0) continue;
    const prompt = compactText(raw.slice(0, optionStart));
    const optionsText = raw.slice(optionStart);
    const options = [...optionsText.matchAll(/(?:^|\n)\s*([ABC])\/\s*([\s\S]*?)(?=\n\s*[ABC]\/|$)/gi)]
      .map((optionMatch) => ({
        value: optionMatch[1].toUpperCase(),
        label: compactText(optionMatch[2]),
      }))
      .filter((option) => option.label);
    const correct = normalizeChoiceValue(answers.get(sourceNumber));
    questions.push({
      questionType: "multiple_choice",
      prompt: trimForDb(prompt || raw),
      options,
      correctAnswer: correct ? { value: correct } : {},
      explanation: null,
      position: sourceNumber,
      transcript,
      audio,
      scoring: { points: 1.25 },
      metadata: {
        sourceQuestionNumber: sourceNumber,
        eclPart: partNumber,
        seriesNumber,
        listeningQuestionKind: "qcm",
      },
      sectionType: "listen",
    });
  }
  return questions;
};

const extractEclListeningShortAnswerQuestions = ({ taskArea, answers, transcript, audio, seriesNumber, partNumber }) => {
  const questions = [];
  const body = compactText(taskArea);
  const blocks = splitByMatches(body, /(?:^|\n)\s*(\d{1,2})\.\s+/g);
  for (const block of blocks) {
    const sourceNumber = Number(block.match[1]);
    const raw = block.text.replace(/^\s*\d{1,2}\.\s+/, "").trim();
    const prompt = compactText(raw.replace(/\n?\s*Antwort\s*:\s*_+\s*/gi, "\n").replace(/_+/g, " "));
    const answer = compactText(answers.get(sourceNumber) || "");
    questions.push({
      questionType: "short_answer",
      prompt: trimForDb(prompt || raw),
      options: [],
      correctAnswer: answer ? { value: answer, acceptedAnswers: [answer] } : {},
      explanation: answer || null,
      position: 10 + sourceNumber,
      transcript,
      audio,
      scoring: { points: 1.25 },
      metadata: {
        sourceQuestionNumber: sourceNumber,
        eclPart: partNumber,
        seriesNumber,
        listeningQuestionKind: "short_answer",
      },
      sectionType: "listen",
    });
  }
  return questions;
};

const inferListeningScene = ({ documentType = "", situation = "", sfx = "" }) => {
  const text = foldForSearch(`${documentType} ${situation} ${sfx}`);
  if (/u-bahn|metro|train|bahnhof|reise|zug/.test(text)) return "Public transport";
  if (/telefon|phone/.test(text)) return "Telephone call";
  if (/radio|magazin|interview|jingle/.test(text)) return "Radio studio";
  if (/arzt|gesund/.test(text)) return "Doctor or health setting";
  if (/restaurant|cafe|kaffee/.test(text)) return "Restaurant or cafe";
  if (/schule|universitat|bildung/.test(text)) return "School or university";
  if (/shop|einkauf|mode|kleidung/.test(text)) return "Shop";
  return "Listening scene";
};

const parseEclVoiceLine = (line) => {
  const match = String(line ?? "").match(/^Voix\s*:\s*([^|]+)\|\s*([^~,\n]+)\s*~?\s*(\d+)?\s*,?\s*([^(]*)(?:\(([^)]+)\))?/i);
  if (!match) return null;
  const genderRaw = compactText(match[2]).toLowerCase();
  const gender = /weib|female|frau/.test(genderRaw) ? "female" : /männ|mann|male/.test(genderRaw) ? "male" : "";
  const age = match[3] ? Number(match[3]) : null;
  const role = compactText(match[5] || match[1]);
  const style = compactText(match[4] || "");
  return {
    voiceName: compactText(match[1]),
    speaker: role,
    suggestedGender: gender,
    suggestedAge: age,
    style,
    emotion: style,
    speed: null,
    accent: "Standard German",
  };
};

const parseEclCastingRoleLine = (line) => {
  const match = String(line ?? "").match(/R[ôo]le\s*:\s*([^—-]+)[—-]\s*Genre\s*:\s*([^·\n]+)(?:·\s*[ÂA]ge\s+approximatif\s*:\s*([^·\n]+))?(?:·\s*Caract[èe]re\s+vocal\s*:\s*([^·\n]+))?(?:·\s*d[ée]bit\s*([^\n]+))?/i);
  if (!match) return null;
  const style = compactText([match[4], match[5] ? `débit ${match[5]}` : ""].filter(Boolean).join(", "));
  return {
    voiceName: compactText(match[1]),
    speaker: compactText(match[1]),
    suggestedGender: inferSpeakerGender(match[2]),
    suggestedAge: Number(String(match[3] || "").match(/\d{2}/)?.[0]) || null,
    style: style || "natural",
    emotion: style || "neutral",
    speed: /lent|posé/i.test(style) ? "0.94x" : /rapide/i.test(style) ? "1.05x" : "0.98x",
    accent: "Standard German",
  };
};

const extractEclAudioMetadata = ({ partText, transcript, header }) => {
  let fiche = getBetweenMarkers(partText, /FICHE\s+AUDIO\s+ELEVENLABS/i, [
    /(?:^|\n)SUJET\s+N[°º]?\s*0?\d{1,2}\s*[-–—]\s*TEIL\s+[12]\s*:/i,
  ]);
  if (!fiche) {
    fiche = getBetweenMarkers(partText, /FICHE\s+DE\s+CASTING/i, [
      /(?:^|\n)SUJET\s+N[°Â°Âº]?\s*0?\d{1,2}\s*[-\u2010-\u2015â€“â€”]\s*TEIL\s+[12]\s*:/i,
    ]);
  }
  const lines = fiche.split("\n").map((line) => line.trim()).filter(Boolean);
  const voices = [
    ...lines.map(parseEclVoiceLine).filter(Boolean),
    ...lines.map(parseEclCastingRoleLine).filter(Boolean),
  ];
  const voiceTable = new Map();
  lines.forEach((line) => {
    const match = line.match(/^([A-Za-zÀ-ÿ][\wÀ-ÿ-]*)\s+([0-9.]+x)\s+(\d+%)\s+(\d+%)\s+(\d+%)/);
    if (!match) return;
    voiceTable.set(match[1].toLowerCase(), {
      speed: match[2],
      stability: match[3],
      similarity: match[4],
      styleStrength: match[5],
    });
  });
  const speakerNames = [...new Set([...transcript.matchAll(/(?:^|\n)\s*([^:\n]{2,40})\s*:/g)].map((match) => compactText(match[1])))];
  const speakers = voices.length
    ? voices.map((voice, index) => ({
        id: `speaker-${index + 1}`,
        ...voice,
        ...(voiceTable.get(String(voice.voiceName).toLowerCase()) || {}),
      }))
    : speakerNames.map((name, index) => ({
        id: `speaker-${index + 1}`,
        speaker: name,
        voiceName: index % 2 === 0 ? "Thomas" : "Klara",
        suggestedGender: "",
        suggestedAge: null,
        style: "natural",
        emotion: "neutral",
        speed: "1.0x",
        accent: "Standard German",
      }));
  const prompt = compactText(fiche.match(/Prompt\s*\([^)]*\)\s*:\s*([^\n]+)/i)?.[1] || "");
  const sfx = compactText(
    fiche.match(/SFX\s*:\s*([^\n]+)/i)?.[1] ||
    fiche.match(/Bruitage\s+de\s+fond[^:]*:\s*([^\n]+)/i)?.[1] ||
    ""
  );
  const timing = compactText(
    fiche.match(/TIMING\s+SFX\s*:\s*([^\n]+)/i)?.[1] ||
    fiche.match(/Placement\s+et\s+dur[ée]e\s+du\s+bruitage\s*:\s*([^\n]+)/i)?.[1] ||
    ""
  );
  const speakerTurns = [...transcript.matchAll(/(?:^|\n)\s*([^:\n]{2,40})\s*:/g)].length;
  return {
    provider: "elevenlabs",
    documentType: header.documentType,
    listeningType: header.documentType,
    situation: header.situation,
    scene: inferListeningScene({ documentType: header.documentType, situation: header.situation, sfx }),
    ambience: sfx ? [{ name: sfx, volume: 0.35, timing }] : [],
    sfx,
    timing,
    prompt,
    speakers,
    speakerCount: speakers.length || speakerNames.length,
    speakerNames,
    conversation: {
      speakerTurns,
      questionMarks: (transcript.match(/\?/g) || []).length,
      hasInterruptions: /!|\.{3}|–/.test(transcript),
      pace: /radio|vortrag|magazin/i.test(header.documentType) ? "structured" : "natural",
      emotionalChanges: speakers.map((speaker) => speaker.emotion).filter(Boolean),
    },
  };
};

const parseEclListeningSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text)
    .replace(/ECL\s+B1\s+Hörverstehen\s+[-–—]\s+20\s+Sujets[^\n]*Page\s+\d+/gi, "\n")
    .replace(/ECL\s+B1\s+HÃ¶rverstehen\s+[-â€“â€”]\s+20\s+Sujets[^\n]*Page\s+\d+/gi, "\n");
  let correctionStart = findEclListeningCorrectionStart(clean);
  if (correctionStart < 0) {
    correctionStart = clean.search(/(?:^|\n)\s*n?\s*CORRECTIONS\s+[-\u2010-\u2015]\s+(?:ALLE|TOUS\s+LES)\s+20\s+SUJETS/i);
  }
  const taskText = correctionStart >= 0 ? clean.slice(0, correctionStart) : clean;
  const solutionText = correctionStart >= 0 ? clean.slice(correctionStart) : "";
  const answerKeys = parseEclListeningAnswerKeys(solutionText);
  const partBlocks = getEclListeningPartBlocks(taskText);
  const seriesMap = new Map();

  partBlocks.forEach((block) => {
    const seriesNumber = Number(block.match[1]);
    const partNumber = Number(block.match[2]);
    const title = compactText(block.match[3]) || `Sujet ${String(seriesNumber).padStart(2, "0")}`;
    const header = extractEclListeningHeader(block.text);
    const transcript = extractEclTranscript(block.text);
    const audio = extractEclAudioMetadata({ partText: block.text, transcript, header });
    const taskArea = extractEclTaskArea(block.text);
    const answers = answerKeys.get(seriesNumber)?.get(partNumber) || new Map();
    const questions = partNumber === 1
      ? extractEclListeningQcmQuestions({ taskArea, answers, transcript, audio, seriesNumber, partNumber })
      : extractEclListeningShortAnswerQuestions({ taskArea, answers, transcript, audio, seriesNumber, partNumber });
    const section = {
      sectionType: "listen",
      partNumber,
      title: `Teil ${partNumber}: ${title}`,
      instructions: trimForDb([
        header.documentType ? `Type de document : ${header.documentType}` : "",
        header.situation ? `Situation : ${header.situation}` : "",
        partNumber === 1
          ? "Sie hören das Gespräch zweimal. Kreuzen Sie die richtige Antwort (A, B oder C) an."
          : "Sie hören den Text zweimal. Beantworten Sie die Fragen in kurzen Stichwörtern.",
      ].filter(Boolean).join("\n"), 4000),
      durationMinutes: 15,
      points: 12.5,
      scoring: { points: 12.5, totalPoints: 25, listeningPasses: 2, readingTimeSeconds: 90 },
      metadata: {
        sourceHeader: title,
        eclFormat: true,
        documentType: header.documentType,
        situation: header.situation,
        transcript,
        audio,
        answerKeyDetected: answers.size > 0,
      },
      questions,
    };

    const existing = seriesMap.get(seriesNumber) || {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ECL B1 Hörverstehen: zwei Hörteile, 20 Aufgaben, 25 Punkte.",
      scoring: { totalPoints: 25, parts: { 1: 12.5, 2: 12.5 } },
      metadata: { ...metadata, eclFormat: true, answerKeyDetected: answerKeys.has(seriesNumber), listening: true },
      sections: [],
    };
    existing.sections.push(section);
    if (!existing.title || existing.title === existing.sourceLabel) existing.title = title;
    seriesMap.set(seriesNumber, existing);
  });

  return Array.from(seriesMap.values())
    .map((series) => ({
      ...series,
      sections: series.sections.sort((a, b) => a.partNumber - b.partNumber),
    }))
    .sort((a, b) => a.seriesNumber - b.seriesNumber);
};

const normalizeBooleanAnswer = (value) => /^(richtig|true|vrai|ja|yes|\+)$/i.test(compactText(value)) ? "true" : "false";

const buildTrueFalseListeningQuestion = ({ prompt, answer, position, transcript, audio, metadata = {}, points = 1 }) => ({
  questionType: "true_false",
  prompt: trimForDb(prompt),
  options: [
    { value: "true", label: "Richtig" },
    { value: "false", label: "Falsch" },
  ],
  correctAnswer: answer ? { value: normalizeBooleanAnswer(answer), label: compactText(answer) } : {},
  explanation: null,
  position,
  transcript,
  audio,
  scoring: { points },
  metadata,
  sectionType: "listen",
});

const buildMultipleChoiceListeningQuestion = ({ prompt, options, answer, position, transcript, audio, metadata = {}, points = 1 }) => ({
  questionType: "multiple_choice",
  prompt: trimForDb(prompt),
  options: (options || []).filter((option) => option.value && option.label),
  correctAnswer: answer ? { value: String(answer).trim().slice(0, 1).toUpperCase() } : {},
  explanation: null,
  position,
  transcript,
  audio,
  scoring: { points },
  metadata,
  sectionType: "listen",
});

const buildMatchingListeningQuestion = ({ prompt, options, answer, position, transcript, audio, metadata = {}, points = 1 }) => ({
  questionType: "matching",
  prompt: trimForDb(prompt),
  options: (options || []).filter((option) => option.value && option.label),
  correctAnswer: answer ? { value: String(answer).trim() } : {},
  explanation: null,
  position,
  transcript,
  audio,
  scoring: { points },
  metadata,
  sectionType: "listen",
});

const stripAudioDirections = (value) =>
  compactText(value)
    .replace(/\[[^\]]*(?:Pause|SFX|AUDIO SCRIPT|Zweite Wiedergabe)[^\]]*\]/gi, " ")
    .replace(/\[Pause\s*\d+s?\]/gi, " ")
    .replace(/(?:^|\n)\s*Sie hören nun Text \d+\.\s*/gi, "\n")
    .replace(/(?:^|\n)\s*Sie hören.*?(?:zweimal|einmal)\.?\s*/gi, "\n")
    .replace(/\s*[-—]\s*Zweite Wiedergabe\s*[-—]\s*/gi, "\n")
    .replace(/\s+/g, " ")
    .trim();

const extractSpeakerNamesFromTranscript = (transcript) =>
  [...new Set([...String(transcript || "").matchAll(/(?:^|\n)\s*([^:\n]{2,48})\s*:/g)].map((match) => compactText(match[1])))]
    .filter((name) => !/^(text|teil|aufgabe)$/i.test(name));

const inferSpeakerGender = (text = "") => {
  const folded = foldForSearch(text);
  if (/(femme|frau|weib|female|moderatorin|sprecherin|mutter|tochter|sara|anna|lena|miriam|petra)/i.test(folded)) return "female";
  if (/(homme|herr|mann|maenn|male|moderator|sprecher|vater|sohn|thomas|klaus|holmar|herr)/i.test(folded)) return "male";
  return "";
};

const parseListeningProductionSpeakers = (value, transcript = "") => {
  const lines = String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const speakers = [];
  lines.forEach((line) => {
    const voiceLine = line.match(/(?:VOIX|Sprecher|Rôle|Rolle)\s*(\d+|[A-Z])?(?:\s*\(([^)]+)\))?\s*:?\s*([^.\n]+)/i);
    if (!voiceLine) return;
    const role = compactText(voiceLine[2] || voiceLine[1] || `Sprecher ${speakers.length + 1}`);
    const details = compactText(voiceLine[3] || line);
    speakers.push({
      id: `speaker-${speakers.length + 1}`,
      speaker: role,
      voiceName: role,
      suggestedGender: inferSpeakerGender(details || role),
      suggestedAge: Number((details.match(/(?:~|environ|ca\.?)\s*(\d{2})/) || [])[1]) || null,
      style: details,
      emotion: details,
      speed: /lent|langsam|slow/i.test(details) ? "0.92x" : /rapide|schnell|fast/i.test(details) ? "1.05x" : "0.98x",
      accent: /suisse|schweiz|ch\b/i.test(details) ? "Swiss German light" : /autrich|österreich|austrian/i.test(details) ? "Austrian German light" : "Standard German",
    });
  });

  if (speakers.length) return speakers;
  const names = extractSpeakerNamesFromTranscript(transcript);
  if (names.length) {
    return names.map((name, index) => ({
      id: `speaker-${index + 1}`,
      speaker: name,
      voiceName: name,
      suggestedGender: inferSpeakerGender(name) || (index % 2 ? "female" : "male"),
      suggestedAge: null,
      style: "natural German exam voice",
      emotion: "neutral",
      speed: "0.98x",
      accent: "Standard German",
    }));
  }
  return [{
    id: "speaker-1",
    speaker: "Narrator",
    voiceName: "Narrator",
    suggestedGender: "",
    suggestedAge: null,
    style: "clear German exam voice",
    emotion: "neutral",
    speed: "0.98x",
    accent: "Standard German",
  }];
};

const extractSfxFromProduction = (value) => {
  const sfx = compactText(
    String(value || "").match(/(?:BRUITAGE|SFX)\s*:\s*([^\n]+)/i)?.[1] ||
    String(value || "").match(/SFX\s+contextuels?\s*:\s*([^\n]+)/i)?.[1] ||
    ""
  );
  return sfx;
};

const buildListeningAudioMetadata = ({ provider, documentType, situation, transcript, production = "", partNumber, title = "" }) => {
  const sfx = extractSfxFromProduction(production);
  const speakers = parseListeningProductionSpeakers(production, transcript);
  return {
    provider: "elevenlabs",
    documentType: documentType || title || "Hörverstehen",
    listeningType: documentType || title || "Hörverstehen",
    situation,
    scene: inferListeningScene({ documentType: documentType || title, situation, sfx }),
    ambience: sfx ? [{ name: sfx, volume: 0.25, timing: "intro or low background where appropriate" }] : [],
    sfx,
    timing: sfx ? "Follow the document production plan." : "",
    prompt: compactText(production).slice(0, 800),
    speakers,
    speakerCount: speakers.length,
    speakerNames: speakers.map((speaker) => speaker.speaker).filter(Boolean),
    conversation: {
      speakerTurns: [...String(transcript || "").matchAll(/(?:^|\n)\s*([^:\n]{2,48})\s*:/g)].length,
      questionMarks: (String(transcript || "").match(/\?/g) || []).length,
      hasInterruptions: /!|\.{3}|—/.test(transcript),
      pace: /radio|bericht|monolog|ansage/i.test(`${documentType} ${title}`) ? "structured" : "natural",
      partNumber,
      sourceProvider: provider,
    },
  };
};

const parseInlineTrueFalseAnswer = (line) => {
  const match = compactText(line).match(/^(\d{1,2})\.\s*(.+?)(?:\s*(?::|6)\s*(RICHTIG|FALSCH))\s*$/i);
  if (!match) return null;
  return {
    number: Number(match[1]),
    prompt: compactText(match[2]),
    answer: match[3],
  };
};

const parseTelcListeningSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const blocks = splitByMatches(clean, /(?:^|\n)SIMULATION\s+0?(\d{1,2})\s*[-—]\s*([^\n]+)/gi);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = compactText(block.match[2]);
    const partMatches = [...block.text.matchAll(/(?:^|\n)TEIL\s+([123])\s*[-—]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const partNumber = Number(match[1]);
      const next = partMatches[index + 1];
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const header = compactText(match[2]);
      let transcript = "";
      let production = "";
      let questions = [];

      if (partNumber === 1) {
        const textBlocks = splitByMatches(body, /(?:^|\n)\s*n?\s*Text\s+(\d+)\s*[-—]\s*Transkription\s*:/gi);
        const textTranscripts = [];
        textBlocks.forEach((textBlock) => {
          const textNumber = Number(textBlock.match[1]);
          const audioIndex = textBlock.text.search(/(?:^|\n)\s*n?\s*AUDIO\s*:/i);
          const taskIndex = textBlock.text.search(/(?:^|\n)\s*Aufgaben\s+1\s*[–-]\s*5/i);
          const rawTranscript = textBlock.text.slice(textBlock.match[0].length, audioIndex >= 0 ? audioIndex : textBlock.text.length);
          const audioLine = audioIndex >= 0 ? textBlock.text.slice(audioIndex, taskIndex >= 0 ? taskIndex : textBlock.text.length) : "";
          textTranscripts.push(`Text ${textNumber}: ${stripAudioDirections(rawTranscript)}`);
          production += `\nText ${textNumber}: ${audioLine}`;
        });
        transcript = textTranscripts.join("\n");
      } else {
        transcript = stripAudioDirections(getBetweenMarkers(body, /Transkription\s*:/i, [/(?:^|\n)\s*n?\s*AUDIO\s*:/i, /(?:^|\n)\s*Aufgaben\s+\d+\s*[–-]\s*\d+/i]));
        production = getBetweenMarkers(body, /(?:^|\n)\s*n?\s*AUDIO\s*:/i, [/(?:^|\n)\s*Aufgaben\s+\d+\s*[–-]\s*\d+/i]);
      }

      const audio = buildListeningAudioMetadata({
        provider: "telc",
        documentType: header,
        situation: title,
        transcript,
        production,
        partNumber,
        title: header,
      });
      const taskArea = getBetweenMarkers(body, /(?:^|\n)\s*Aufgaben\s+\d+\s*[–-]\s*\d+/i, [/(?:^|\n)TEIL\s+[123]\s*[-—]/i]) || body;
      questions = compactText(taskArea)
        .split("\n")
        .map(parseInlineTrueFalseAnswer)
        .filter(Boolean)
        .map((item) => buildTrueFalseListeningQuestion({
          prompt: item.prompt,
          answer: item.answer,
          position: item.number,
          transcript,
          audio,
          points: 1,
          metadata: { telcPart: partNumber, seriesNumber, sourceQuestionNumber: item.number },
        }));

      return {
        sectionType: "listen",
        partNumber,
        title: `Teil ${partNumber}: ${header}`,
        instructions: trimForDb([match[0], body.split(/(?:^|\n)\s*n?\s*Text\s+1|Transkription\s*:/i)[0]].join("\n"), 4000),
        durationMinutes: partNumber === 1 ? 8 : partNumber === 2 ? 14 : 8,
        points: partNumber === 2 ? 10 : 5,
        scoring: { points: partNumber === 2 ? 10 : 5, listeningPasses: partNumber === 1 ? 1 : 2 },
        metadata: { telcFormat: true, sourceHeader: header, transcript, audio, answerKeyDetected: questions.length > 0 },
        questions,
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Simulation ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "telc Deutsch B1 Hörverstehen: drei Teile, 20 Aufgaben, 20 Punkte.",
      scoring: { totalPoints: 20, parts: { 1: 5, 2: 10, 3: 5 } },
      metadata: { ...metadata, telcFormat: true, listening: true },
      sections,
    };
  });
};

const parseSolutionAnswerMap = (solutionText) => {
  const answers = new Map();
  compactText(solutionText).split("\n").forEach((line) => {
    const match = line.match(/^\s*(\d{1,2})\s+(Richtig|Falsch|[A-D]|M|A|K|E|B|L)(?:\s|$)/i);
    if (match && !answers.has(Number(match[1]))) answers.set(Number(match[1]), match[2]);
  });
  return answers;
};

const parseOsdListeningQuestions = ({ body, answers, transcript, audio, seriesNumber, partNumber }) => {
  const questionBlocks = splitByMatches(body, /(?:^|\n)\s*Aufgabe\s+(\d{1,2})(?:\s*\(([^)]+)\))?\s*:\s*/gi);
  if (!questionBlocks.length) {
    return compactText(body)
      .split("\n")
      .map((line) => {
        const match = line.match(/^\s*(\d{1,2})\s+(.+?)\s+n\s+([A-Z])(?:\s+n\s+([A-Z]))+/i);
        if (!match) return null;
        const sourceNumber = Number(match[1]);
        const choices = [...line.matchAll(/\bn\s+([A-Z])\b/g)].map((choice) => choice[1]);
        const options = choices.map((value) => ({ value, label: value }));
        return buildMatchingListeningQuestion({
          prompt: compactText(match[2]),
          options,
          answer: answers.get(sourceNumber) || "",
          position: sourceNumber,
          transcript,
          audio,
          points: 1,
          metadata: { osdPart: partNumber, seriesNumber, sourceQuestionNumber: sourceNumber },
        });
      })
      .filter(Boolean);
  }
  return questionBlocks.map((block) => {
    const sourceNumber = Number(block.match[1]);
    const kind = compactText(block.match[2] || "");
    const raw = block.text.slice(block.match[0].length);
    const nextMarker = raw.search(/(?:^|\n)\s*(?:Aufgabe\s+\d{1,2}\s*\(|Text\s+\d+:|TEIL\s+\d+)/i);
    const questionText = nextMarker >= 0 ? raw.slice(0, nextMarker) : raw;
    const answer = answers.get(sourceNumber) || "";
    if (/multiple/i.test(kind) || /(?:^|\n)\s*n?\s*A\)/i.test(questionText)) {
      const options = [...questionText.matchAll(/(?:^|\n)\s*n?\s*([A-D])\)\s*([^\n]+)/gi)].map((match) => ({
        value: match[1].toUpperCase(),
        label: compactText(match[2]),
      }));
      const prompt = compactText(questionText.replace(/(?:^|\n)\s*n?\s*[A-D]\)\s*[^\n]+/gi, ""));
      return buildMultipleChoiceListeningQuestion({
        prompt,
        options,
        answer,
        position: sourceNumber,
        transcript,
        audio,
        points: 1,
        metadata: { osdPart: partNumber, seriesNumber, sourceQuestionNumber: sourceNumber },
      });
    }
    if (/zuordnen|aussagen/i.test(kind) || /\bn\s+M\s+n\s+A\s+n\s+K/i.test(questionText)) {
      const options = [
        { value: "M", label: "Moderator/in" },
        { value: "A", label: "Andreas / Person A" },
        { value: "K", label: "Katrin / Person K" },
        { value: "E", label: "Experte / Person E" },
        { value: "B", label: "Beide" },
      ];
      const prompt = compactText(questionText.replace(/\bn\s+[MAKEB]\b/gi, ""));
      return buildMatchingListeningQuestion({
        prompt,
        options,
        answer,
        position: sourceNumber,
        transcript,
        audio,
        points: 1,
        metadata: { osdPart: partNumber, seriesNumber, sourceQuestionNumber: sourceNumber },
      });
    }
    return buildTrueFalseListeningQuestion({
      prompt: compactText(questionText.replace(/\bn\s+Richtig\s+n\s+Falsch/gi, "")),
      answer,
      position: sourceNumber,
      transcript,
      audio,
      points: 1,
      metadata: { osdPart: partNumber, seriesNumber, sourceQuestionNumber: sourceNumber },
    });
  }).filter((question) => question.prompt);
};

const parseOsdListeningSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const blocks = splitByMatches(clean, /(?:^|\n)(?:ÖSD|OeSD|Ã–SD)\s+Zertifikat\s+B1\s*[–-]\s*Hören\s+Prüfung\s+0?(\d{1,2})\s+Thema:\s*([^\n]+)/gi);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = compactText(block.match[2]);
    const solutionIndex = block.text.search(/(?:^|\n)\s*LÖSUNGSBLATT/i);
    const taskText = solutionIndex >= 0 ? block.text.slice(0, solutionIndex) : block.text;
    const solutionText = solutionIndex >= 0 ? block.text.slice(solutionIndex) : "";
    const answers = parseSolutionAnswerMap(solutionText);
    const partMatches = [...taskText.matchAll(/(?:^|\n)TEIL\s+([1-4])\s*[–-]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const partNumber = Number(match[1]);
      const next = partMatches[index + 1];
      const body = taskText.slice(match.index + match[0].length, next ? next.index : taskText.length);
      const header = compactText(match[2]);
      const scriptText = compactText(body.replace(/\[[^\]]*SFX[^\]]*\]/gi, "").split(/(?:^|\n)\s*Aufgabe\s+\d+/i)[0] || "");
      const transcript = stripAudioDirections(scriptText.replace(/Text\s+\d+:\s*[^\n]+/gi, ""));
      const production = [...body.matchAll(/\[SFX:\s*([^\]]+)\]/gi)].map((m) => `SFX: ${m[1]}`).join("\n");
      const audio = buildListeningAudioMetadata({
        provider: "osd",
        documentType: header,
        situation: title,
        transcript,
        production,
        partNumber,
        title: header,
      });
      const questions = parseOsdListeningQuestions({ body, answers, transcript, audio, seriesNumber, partNumber });
      return {
        sectionType: "listen",
        partNumber,
        title: `Teil ${partNumber}: ${header}`,
        instructions: trimForDb([match[0], body.split(/\[AUDIO SCRIPT/i)[0]].join("\n"), 4000),
        durationMinutes: partNumber === 1 ? 12 : partNumber === 4 ? 12 : 8,
        points: questions.length || null,
        scoring: { points: questions.length || null, totalPoints: 30, listeningPasses: partNumber === 1 || partNumber === 4 ? 2 : 1 },
        metadata: { osdFormat: true, sourceHeader: header, transcript, audio, answerKeyDetected: answers.size > 0 },
        questions,
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Prüfung ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ÖSD Zertifikat B1 Hören: vier Teile, 30 Aufgaben, 30 Punkte.",
      scoring: { totalPoints: 30, parts: { 1: 10, 2: 5, 3: 7, 4: 8 } },
      metadata: { ...metadata, osdFormat: true, listening: true },
      sections,
    };
  });
};

const parseGoetheCorrections = (solutionText) => {
  const partBlocks = splitByMatches(solutionText, /(?:^|\n)Teil\s+([1-4])\s*(?=\n)/gi);
  const answers = new Map();
  partBlocks.forEach((block) => {
    const part = Number(block.match[1]);
    const partAnswers = new Map();
    if (part === 1) {
      [...block.text.matchAll(/(?:^|\n)\s*(\d)\s+(Richtig|Falsch)[\s\S]{0,120}?MC:\s*([ABC])/gi)].forEach((match) => {
        const n = Number(match[1]);
        partAnswers.set(n, match[2]);
        partAnswers.set(n + 5, match[3]);
      });
    } else {
      compactText(block.text).split("\n").forEach((line) => {
        const match = line.match(/^\s*(\d{1,2})\s+(Richtig|Falsch|[ABC]|Herr\s+[^\s]+|Frau\s+[^\s]+|Dr\.\s+[^\s]+|Moderatorin?|Niemand)/i);
        if (match) partAnswers.set(Number(match[1]), compactText(match[2]));
      });
    }
    answers.set(part, partAnswers);
  });
  return answers;
};

const parseGoetheTaskQuestions = ({ taskBody, partNumber, answers, transcript, audio, seriesNumber }) => {
  if (partNumber === 1) {
    const blocks = splitByMatches(taskBody, /(?:^|\n)Text\s+(\d+)\s*(?=\n)/gi);
    const questions = [];
    blocks.forEach((block) => {
      const textNumber = Number(block.match[1]);
      const raw = block.text.slice(block.match[0].length);
      const rf = raw.match(/Richtig\/Falsch\s*:\s*([^\n]+)/i);
      const mc = raw.match(/Multiple Choice\s*:\s*([^\n]+)([\s\S]*)/i);
      if (rf) {
        questions.push(buildTrueFalseListeningQuestion({
          prompt: compactText(rf[1]),
          answer: answers.get(textNumber),
          position: textNumber,
          transcript,
          audio,
          metadata: { goethePart: partNumber, seriesNumber, sourceQuestionNumber: textNumber, textNumber },
        }));
      }
      if (mc) {
        const options = [...mc[2].matchAll(/(?:^|\n)\s*([ABC])\)\s*([^\n]+)/gi)].map((match) => ({
          value: match[1].toUpperCase(),
          label: compactText(match[2]),
        }));
        questions.push(buildMultipleChoiceListeningQuestion({
          prompt: compactText(mc[1]),
          options,
          answer: answers.get(textNumber + 5),
          position: textNumber + 5,
          transcript,
          audio,
          metadata: { goethePart: partNumber, seriesNumber, sourceQuestionNumber: textNumber + 5, textNumber },
        }));
      }
    });
    return questions;
  }

  const blocks = splitByMatches(taskBody, /(?:^|\n)\s*(\d{1,2})\.\s+/g);
  return blocks.map((block) => {
    const number = Number(block.match[1]);
    const raw = block.text.slice(block.match[0].length);
    if (partNumber === 2) {
      const optionStart = raw.search(/(?:^|\n)\s*A\)/i);
      const prompt = compactText(raw.slice(0, optionStart >= 0 ? optionStart : raw.length));
      const options = [...raw.matchAll(/(?:^|\n)\s*([ABC])\)\s*([^\n]+)/gi)].map((match) => ({
        value: match[1].toUpperCase(),
        label: compactText(match[2]),
      }));
      return buildMultipleChoiceListeningQuestion({
        prompt,
        options,
        answer: answers.get(number),
        position: number,
        transcript,
        audio,
        metadata: { goethePart: partNumber, seriesNumber, sourceQuestionNumber: number },
      });
    }
    if (partNumber === 3) {
      return buildTrueFalseListeningQuestion({
        prompt: compactText(raw),
        answer: answers.get(number),
        position: number,
        transcript,
        audio,
        metadata: { goethePart: partNumber, seriesNumber, sourceQuestionNumber: number },
      });
    }
    const options = [
      { value: "Moderator", label: "Moderator/in" },
      { value: "Herr Brandt", label: "Herr Brandt / Sprecher 1" },
      { value: "Frau Ngo", label: "Frau Ngo / Sprecherin" },
      { value: "Niemand", label: "Niemand" },
    ];
    return buildMatchingListeningQuestion({
      prompt: compactText(raw),
      options,
      answer: answers.get(number),
      position: number,
      transcript,
      audio,
      metadata: { goethePart: partNumber, seriesNumber, sourceQuestionNumber: number },
    });
  }).filter((question) => question.prompt);
};

const extractGoetheScriptPart = (scriptText, partNumber) => {
  const markers = {
    1: /Teil\s+1\s*[—-]\s*Scripts/i,
    2: /Teil\s+2\s*[—-]\s*Script/i,
    3: /Teil\s+3\s*[—-]\s*Script/i,
    4: /Teil\s+4\s*[—-]\s*Script/i,
  };
  const nextMarkers = Object.entries(markers)
    .filter(([number]) => Number(number) > partNumber)
    .map(([, regex]) => regex);
  return getBetweenMarkers(scriptText, markers[partNumber], [...nextMarkers, /B\.\s*Plan\s+de\s+Production/i]).replace(markers[partNumber], "").trim();
};

const parseGoetheProductionPart = (productionText, partNumber) =>
  getBetweenMarkers(productionText, new RegExp(`Teil\\s+${partNumber}\\b`, "i"), [
    new RegExp(`Teil\\s+${partNumber + 1}\\b`, "i"),
    /Tableau\s+Param/i,
  ]);

const parseGoetheListeningSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const blocks = splitByMatches(clean, /(?:^|\n)SUJET\s+0?(\d{1,2})\s*[—-]\s*[„"“]([^\n"”]+)/gi);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = compactText(block.match[2]).replace(/[„"“]+/g, "");
    const scriptStart = block.text.search(/Scripts\s+Audio\s*&\s*Plan\s+de\s+Production/i);
    const correctionStart = block.text.search(/Corrections\s*&\s*Justifications/i);
    const taskText = scriptStart >= 0 ? block.text.slice(0, scriptStart) : block.text;
    const scriptText = scriptStart >= 0 ? block.text.slice(scriptStart, correctionStart >= 0 ? correctionStart : block.text.length) : "";
    const productionText = getBetweenMarkers(scriptText, /B\.\s*Plan\s+de\s+Production\s+Audio/i, [/Tableau\s+Param/i]);
    const corrections = correctionStart >= 0 ? block.text.slice(correctionStart) : "";
    const answerMap = parseGoetheCorrections(corrections);
    const partMatches = [...taskText.matchAll(/(?:^|\n)Teil\s+([1-4])\s*[—-]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const partNumber = Number(match[1]);
      const next = partMatches[index + 1];
      const body = taskText.slice(match.index + match[0].length, next ? next.index : taskText.length);
      const header = compactText(match[2]);
      const transcript = stripAudioDirections(extractGoetheScriptPart(scriptText, partNumber));
      const production = parseGoetheProductionPart(productionText, partNumber);
      const audio = buildListeningAudioMetadata({
        provider: "goethe",
        documentType: header,
        situation: title,
        transcript,
        production,
        partNumber,
        title: header,
      });
      const questions = parseGoetheTaskQuestions({
        taskBody: body,
        partNumber,
        answers: answerMap.get(partNumber) || new Map(),
        transcript,
        audio,
        seriesNumber,
      });
      return {
        sectionType: "listen",
        partNumber,
        title: `Teil ${partNumber}: ${header}`,
        instructions: trimForDb([match[0], body.split(/(?:^|\n)Text\s+1|(?:^|\n)\s*1\.\s+/i)[0]].join("\n"), 4000),
        durationMinutes: partNumber === 1 ? 10 : partNumber === 4 ? 12 : 8,
        points: questions.length || null,
        scoring: { points: questions.length || null, totalPoints: 30, listeningPasses: partNumber === 1 || partNumber === 4 ? 2 : 1 },
        metadata: { goetheFormat: true, sourceHeader: header, transcript, audio, answerKeyDetected: questions.some((q) => Object.keys(q.correctAnswer || {}).length) },
        questions,
      };
    }).filter((section) => section.questions.length || section.metadata.transcript);
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "Goethe-Zertifikat B1 Hören: vier Teile, 30 Aufgaben, ca. 40 Minuten.",
      scoring: { totalPoints: 30, parts: { 1: 10, 2: 5, 3: 7, 4: 8 } },
      metadata: { ...metadata, goetheFormat: true, listening: true },
      sections,
    };
  });
};

const parseEclWritingSolutionBody = (body) => {
  const clean = compactText(body);
  const criteriaIndex = clean.search(/(?:^|\n)\s*3\s+/);
  const sampleAnswer = criteriaIndex >= 0 ? clean.slice(0, criteriaIndex).trim() : clean;
  const criteria = criteriaIndex >= 0 ? clean.slice(criteriaIndex).replace(/(?:^|\n)\s*3\s+/g, "\n- ").trim() : "";
  return {
    sampleAnswer,
    criteria,
  };
};

const parseEclWritingSolutions = (solutionText) => {
  const seriesBlocks = splitByMatches(solutionText, /(?:^|\n)Sujet\s+0?(\d{1,2})\s+[-–—]\s*([^\n]+)/gi);
  return new Map(
    seriesBlocks.map((seriesBlock) => {
      const parts = new Map();
      const partBlocks = splitByMatches(seriesBlock.text, /(?:^|\n)Aufgabe\s+([12])\s+[-–—]\s*([^\n]+)/gi);
      partBlocks.forEach((partBlock) => {
        const body = partBlock.text.slice(partBlock.match[0].length);
        parts.set(Number(partBlock.match[1]), {
          title: compactText(partBlock.match[2]),
          ...parseEclWritingSolutionBody(body),
        });
      });
      return [Number(seriesBlock.match[1]), parts];
    })
  );
};

const getEclWritingQuestionType = (title) =>
  /forum|blog|leserbrief|kommentar|beitrag|artikel|bewertung/i.test(title) ? "writing_forum_post" : "writing_email";

const parseEclWritingSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const correctionStart = findEclCorrectionStart(clean);
  const taskText = correctionStart >= 0 ? clean.slice(0, correctionStart) : clean;
  const solutionText = correctionStart >= 0 ? clean.slice(correctionStart) : "";
  const solutionMap = parseEclWritingSolutions(solutionText);
  const blocks = splitByMatches(taskText, /(?:^|\n)Sujet\s+0?(\d{1,2})\s+[-–—]\s*([^\n]+)/gi);

  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = normalizeEclSeriesTitle(block, block.match[2]) || `Sujet ${String(seriesNumber).padStart(2, "0")}`;
    const solutions = solutionMap.get(seriesNumber) || new Map();
    const partMatches = [...block.text.matchAll(/(?:^|\n)Aufgabe\s+([12])\s+[-–—]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = compactText(match[2]);
      const body = stripEclResponseMarker(block.text.slice(match.index + match[0].length, next ? next.index : block.text.length));
      const solution = solutions.get(partNumber) || {};
      const durationMinutes = 20;
      const correctAnswer = {};
      if (solution.sampleAnswer) correctAnswer.sampleAnswer = solution.sampleAnswer;
      if (solution.criteria) correctAnswer.expectedPerformance = solution.criteria;
      return {
        sectionType: "write",
        partNumber,
        title: `Aufgabe ${partNumber}: ${header}`,
        instructions: trimForDb(body, 4000),
        durationMinutes,
        points: null,
        scoring: { durationMinutes, totalPoints: 25 },
        metadata: { sourceHeader: header, eclFormat: true },
        questions: [
          {
            questionType: getEclWritingQuestionType(header),
            prompt: trimForDb([compactText(match[0]), body].join("\n")),
            options: [],
            correctAnswer,
            explanation: solution.criteria || solution.sampleAnswer || null,
            position: partNumber,
            scoring: { durationMinutes, totalPoints: 25 },
            metadata: { wordTarget: extractEclWordTarget(body) || 100, eclPart: partNumber },
            sectionType: "write",
          },
        ],
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ECL B1 Schriftliche Kommunikation: zwei Schreibaufgaben, 40 Minuten, 25 Punkte.",
      scoring: { totalPoints: 25, parts: { 1: null, 2: null } },
      metadata: { ...metadata, eclFormat: true },
      sections,
    };
  });
};

const parseEclSpeakingSolutions = (solutionText) => {
  const seriesBlocks = splitByMatches(solutionText, /(?:^|\n)Kombination\s+0?(\d{1,2})\s+[-–—]\s*([^\n]+)/gi);
  return new Map(
    seriesBlocks.map((seriesBlock) => {
      const parts = new Map();
      const part2 = getBetweenMarkers(seriesBlock.text, /Teil\s+2\b/i, [/Teil\s+3\b/i]);
      const part3 = getBetweenMarkers(seriesBlock.text, /Teil\s+3\b/i, []);
      if (part2) parts.set(2, compactText(part2.replace(/^Teil\s+2[^\n]*\n?/i, "")));
      if (part3) parts.set(3, compactText(part3.replace(/^Teil\s+3[^\n]*\n?/i, "")));
      return [Number(seriesBlock.match[1]), parts];
    })
  );
};

const parseEclSpeakingSeries = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const correctionStart = findEclCorrectionStart(clean);
  const taskText = correctionStart >= 0 ? clean.slice(0, correctionStart) : clean;
  const solutionText = correctionStart >= 0 ? clean.slice(correctionStart) : "";
  const solutionMap = parseEclSpeakingSolutions(solutionText);
  const blocks = splitByMatches(taskText, /(?:^|\n)Kombination\s+0?(\d{1,2})\s+[-–—]\s*([^\n]+)/gi);
  const questionTypes = {
    1: "speaking_intro",
    2: "speaking_guided_conversation",
    3: "speaking_monologue",
  };

  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = normalizeEclSeriesTitle(block, block.match[2]) || `Kombination ${String(seriesNumber).padStart(2, "0")}`;
    const solutions = solutionMap.get(seriesNumber) || new Map();
    const partMatches = [...block.text.matchAll(/(?:^|\n)TEIL\s+([123])\s+[-–—]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = compactText(match[2]);
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const durationMinutes = extractDurationMinutes(header) || (partNumber === 1 ? 2 : 8);
      const solution = solutions.get(partNumber) || "";
      const correctAnswer = solution ? { expectedPerformance: solution } : {};
      return {
        sectionType: "speak",
        partNumber,
        title: `Teil ${partNumber}: ${header.split("·")[0].trim() || "Sprechen"}`,
        instructions: trimForDb(body, 5000),
        durationMinutes,
        points: null,
        scoring: { durationMinutes, totalPoints: 25 },
        metadata: { sourceHeader: header, eclFormat: true, evaluated: partNumber > 1 },
        questions: [
          {
            questionType: questionTypes[partNumber] || "speaking_prompt",
            prompt: trimForDb([compactText(match[0]), body].join("\n")),
            options: [],
            correctAnswer,
            explanation: solution || null,
            position: partNumber,
            scoring: { durationMinutes, totalPoints: 25 },
            metadata: { eclPart: partNumber, evaluated: partNumber > 1 },
            sectionType: "speak",
          },
        ],
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Kombination ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ECL B1 Mündliche Kommunikation: Vorstellung, gelenktes Gespräch und selbständige Äußerung.",
      scoring: { totalPoints: 25, parts: { 1: null, 2: null, 3: null } },
      metadata: { ...metadata, eclFormat: true },
      sections,
    };
  });
};

const stripTelcPageDecorations = (value) =>
  stripPdfPageMarkers(value)
    .replace(/(?:^|\n)\s*telc Deutsch B1\s*\|[^\n]*/gi, "\n")
    .replace(/(?:^|\n)\s*Seite\s+\d+\s*\|[^\n]*/gi, "\n");

const normalizeTelcText = (value) => compactText(stripTelcPageDecorations(value));

const splitTelcSujetBlocks = (text) =>
  splitByMatches(
    text,
    /(?:^|\n)(?:SUJET|Sujet)\s+0?(\d{1,2})\s*\/\s*20\s*(?:(?:[·\u00b7]|\s*[-\u2010-\u2015]\s*)\s*(?:Th[eè]me\s*:\s*)?([^\n]*))?/gi
  ).filter((block) => {
    const number = Number(block.match[1]);
    return number >= 1 && number <= 20;
  });

const sliceAfterBlockMatch = (block) => {
  const marker = compactText(block.match?.[0] || "");
  if (!marker) return block.text;
  const offset = block.text.indexOf(marker);
  if (offset >= 0) return block.text.slice(offset + marker.length);
  return block.text.slice(block.match?.[0]?.length || 0);
};

const extractTelcSujetTitle = (block, fallback = "") => {
  const inlineTitle = compactText(block.match?.[2] || fallback).replace(/^Th[eè]me\s*:\s*/i, "");
  if (inlineTitle) return inlineTitle;

  const lines = stripTelcPageDecorations(sliceAfterBlockMatch(block))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^(Situation|Muendliche|Mundliche|Pruefung|TEIL|Teil|Aufgabe|An:|Von:|Betreff:|Hinweise|Ihr Text|Dauer|Ziel)\b/i.test(line)) {
      break;
    }
    return compactText(line);
  }
  return `Sujet ${String(Number(block.match?.[1]) || 1).padStart(2, "0")}`;
};

const findTelcModelSolutionStart = (text) => {
  const sectionStart = String(text ?? "").search(/(?:^|\n)\s*TEIL\s+II\s*[-\u2010-\u2015]\s*MUSTERLOESUNGEN/i);
  if (sectionStart >= 0) return sectionStart;
  const firstSolution = String(text ?? "").search(/(?:^|\n)\s*Musterloesung[^\n]*Sujet\s+0?1\s*:/i);
  return firstSolution >= 0 ? firstSolution : -1;
};

const splitTelcTaskAndSolution = (text) => {
  const clean = stripTelcPageDecorations(text);
  const solutionStart = findTelcModelSolutionStart(clean);
  return {
    taskText: solutionStart >= 0 ? clean.slice(0, solutionStart) : clean,
    solutionText: solutionStart >= 0 ? clean.slice(solutionStart) : "",
  };
};

const parseTelcSolutionSampleAndTips = (body) => {
  const clean = normalizeTelcText(body);
  const tipsIndex = clean.search(/(?:^|\n)\s*(?:Tipps\s*&\s*)?(?:Sprachliche\s+Hinweise|Sprachliche\s+Tipps)\s*:/i);
  return {
    sampleAnswer: tipsIndex >= 0 ? clean.slice(0, tipsIndex).trim() : clean,
    tips: tipsIndex >= 0 ? clean.slice(tipsIndex).trim() : "",
  };
};

const parseTelcWritingSolutions = (solutionText) => {
  const blocks = splitByMatches(solutionText, /(?:^|\n)\s*Musterloesung[^\n]*Sujet\s+0?(\d{1,2})\s*:\s*([^\n]+)/gi);
  return new Map(
    blocks.map((block) => {
      const body = sliceAfterBlockMatch(block);
      return [
        Number(block.match[1]),
        {
          title: compactText(block.match[2]),
          ...parseTelcSolutionSampleAndTips(body),
        },
      ];
    })
  );
};

const parseTelcSpeakingSolutions = (solutionText) => {
  const seriesBlocks = splitByMatches(solutionText, /(?:^|\n)\s*Musterloesung[^\n]*Sujet\s+0?(\d{1,2})\s*:\s*([^\n]+)/gi);
  return new Map(
    seriesBlocks.map((seriesBlock) => {
      const parts = new Map();
      const partBlocks = splitByMatches(seriesBlock.text, /(?:^|\n)\s*TEIL\s+([123])\s*[-\u2010-\u2015]\s*(Musterantwort|Musterdialog)/gi);
      partBlocks.forEach((partBlock) => {
        const body = sliceAfterBlockMatch(partBlock);
        parts.set(Number(partBlock.match[1]), parseTelcSolutionSampleAndTips(body));
      });
      return [
        Number(seriesBlock.match[1]),
        {
          title: compactText(seriesBlock.match[2]),
          parts,
        },
      ];
    })
  );
};

const findTelcReadingCorrectionStart = (text) => {
  const index = String(text ?? "").search(/(?:^|\n)\s*\d+\s+CORRIG\S*\s*[-\u2010-\u2015]\s*Sujet/i);
  return index >= 0 ? index : -1;
};

const parseTelcReadingAnswerMap = (correctionText) => {
  const answers = new Map();
  const clean = normalizeTelcText(correctionText);
  const part1 = getBetweenMarkers(clean, /Teil\s+1\s*:/i, [/Teil\s+2\s*:/i]);
  for (const match of part1.matchAll(/Text\s+([1-5])\s*(?:→|->|=>|>)\s*([A-G])/gi)) {
    answers.set(Number(match[1]), match[2].toLowerCase());
  }

  const part2 = getBetweenMarkers(clean, /Teil\s+2\s*:/i, [/Teil\s+3\s*:/i]);
  for (const match of part2.matchAll(/\bF\s*([1-5])\s*:\s*([ABC])\b/gi)) {
    answers.set(5 + Number(match[1]), match[2].toLowerCase());
  }

  const part3 = getBetweenMarkers(clean, /Teil\s+3\s*:/i, []);
  for (const match of part3.matchAll(/\b(10|[1-9])\s*:\s*([A-T])\b/gi)) {
    answers.set(10 + Number(match[1]), match[2].toLowerCase());
  }
  return answers;
};

const extractTelcHeadingOptions = (partText) =>
  [...normalizeTelcText(partText).matchAll(/(?:^|\n)\s*([A-G])\s*[-\u2010-\u2015]\s*([^\n]+)/g)]
    .map((match) => ({
      value: match[1].toLowerCase(),
      label: `${match[1].toUpperCase()} - ${compactText(match[2])}`,
    }))
    .filter((option) => option.label);

const extractTelcReadingPart1Questions = (partText, answerMap) => {
  const clean = stripTelcPageDecorations(partText);
  const options = extractTelcHeadingOptions(clean);
  const blocks = splitByMatches(clean, /(?:^|\n)\s*Text\s+([1-5])\b/gi);
  return blocks.map((block) => {
    const sourceNumber = Number(block.match[1]);
    const body = sliceAfterBlockMatch(block).replace(/\n?\s*L[oö]sung\s+Text[\s\S]*$/i, "");
    const correct = answerMap.get(sourceNumber);
    return {
      questionType: "matching",
      prompt: trimForDb(`Text ${sourceNumber}\n${body}`),
      options,
      correctAnswer: correct ? { value: correct } : {},
      explanation: null,
      position: sourceNumber,
      scoring: { points: 5 },
      metadata: {
        sourceQuestionNumber: sourceNumber,
        telcPart: 1,
        matchingPrompt: "Wählen Sie die passende Überschrift.",
      },
      sectionType: "read",
    };
  });
};

const extractTelcReadingPart2Questions = (partText, answerMap) => {
  const clean = stripTelcPageDecorations(partText);
  const blocks = splitByMatches(clean, /(?:^|\n)\s*Frage\s+([1-5])\s*:\s*/gi);
  return blocks
    .map((block) => {
      const sourceNumber = Number(block.match[1]);
      const raw = stripTelcPageDecorations(sliceAfterBlockMatch(block));
      const optionStart = raw.search(/\b[abc]\)/i);
      if (optionStart < 0) return null;
      const prompt = raw.slice(0, optionStart);
      const optionArea = raw.slice(optionStart).replace(/\s+/g, " ").trim();
      const options = [...optionArea.matchAll(/\b([abc])\)\s*([\s\S]*?)(?=\s+\b[abc]\)|$)/gi)]
        .map((match) => ({
          value: match[1].toLowerCase(),
          label: compactText(match[2]),
        }))
        .filter((option) => option.label);
      const position = 5 + sourceNumber;
      const correct = answerMap.get(position);
      return {
        questionType: "multiple_choice",
        prompt: trimForDb(`Frage ${sourceNumber}: ${prompt}`),
        options,
        correctAnswer: correct ? { value: correct } : {},
        explanation: null,
        position,
        scoring: { points: 5 },
        metadata: { sourceQuestionNumber: sourceNumber, telcPart: 2 },
        sectionType: "read",
      };
    })
    .filter(Boolean);
};

const extractTelcAdOptions = (adsArea) =>
  [...stripTelcPageDecorations(adsArea).matchAll(/(?:^|\n)\s*Anzeige\s+([A-T])\s*:\s*([\s\S]*?)(?=(?:^|\n)\s*Anzeige\s+[A-T]\s*:|(?:^|\n)\s*(?:1:\s*___|\d+\s+CORRIG|Teil\s+[123]\s*:|SUJET\s+\d|$))/gim)]
    .map((match) => ({
      value: match[1].toLowerCase(),
      label: `${match[1].toUpperCase()} - ${compactText(match[2])}`,
    }))
    .filter((option) => option.label);

const extractTelcReadingPart3Questions = (partText, answerMap) => {
  const clean = stripTelcPageDecorations(partText);
  const situationsIndex = clean.search(/(?:^|\n)\s*Situationen\s*(?:\n|$)/i);
  const adsMatch = /(?:^|\n)\s*Anzeigen\s*(?:\n|$)/i.exec(clean);
  if (situationsIndex < 0 || !adsMatch) return [];

  const situationsArea = clean.slice(situationsIndex, adsMatch.index);
  const adsArea = clean.slice(adsMatch.index);
  const options = extractTelcAdOptions(adsArea);
  return [...situationsArea.matchAll(/(?:^|\n)\s*(10|[1-9])\.\s*([\s\S]*?)(?=\n\s*(?:10|[1-9])\.|$)/g)]
    .map((match) => {
      const sourceNumber = Number(match[1]);
      const position = 10 + sourceNumber;
      const correct = answerMap.get(position);
      return {
        questionType: "matching",
        prompt: trimForDb(`Situation ${sourceNumber}: ${match[2]}`),
        options,
        correctAnswer: correct ? { value: correct } : {},
        explanation: null,
        position,
        scoring: { points: 2.5 },
        metadata: {
          sourceQuestionNumber: sourceNumber,
          telcPart: 3,
          matchingPrompt: "Wählen Sie die passende Anzeige.",
        },
        sectionType: "read",
      };
    })
    .filter((question) => question.prompt);
};

const parseTelcReadingPartQuestions = (partNumber, partText, answerMap) => {
  if (partNumber === 1) return extractTelcReadingPart1Questions(partText, answerMap);
  if (partNumber === 2) return extractTelcReadingPart2Questions(partText, answerMap);
  if (partNumber === 3) return extractTelcReadingPart3Questions(partText, answerMap);
  return [];
};

const findTelcSprachSolutionStart = (text) => {
  const index = String(text ?? "").search(/(?:^|\n)\s*L(?:O|\u00d6|OE|.)SUNGEN\b/i);
  return index >= 0 ? index : -1;
};

const splitTelcSprachTaskAndSolution = (text) => {
  const clean = stripTelcPageDecorations(text);
  const solutionStart = findTelcSprachSolutionStart(clean);
  return {
    taskText: solutionStart >= 0 ? clean.slice(0, solutionStart) : clean,
    solutionText: solutionStart >= 0 ? clean.slice(solutionStart) : "",
  };
};

const splitTelcSprachBlocks = (text) =>
  splitByMatches(
    text,
    /(?:^|\n)\s*(?:(?:\u00dcBUNGSSATZ|UEBUNGSSATZ|UBUNGSSATZ)\s+|AUFGABE\s+)0?(\d{1,2})\b[^\n]*/gi
  ).filter((block) => {
    const number = Number(block.match[1]);
    return number >= 1 && number <= 20;
  });

const extractTelcSprachTitle = (block) => {
  const header = compactText(block.match?.[0] || "");
  const inline = header
    .replace(/^(?:\u00dcBUNGSSATZ|UEBUNGSSATZ|UBUNGSSATZ|AUFGABE)\s+0?\d{1,2}\b/i, "")
    .replace(/^[\s|.\-:]+/, "")
    .trim();
  if (inline && !/^SPRACHBAUSTEINE$/i.test(inline)) return inline;
  return `Sprachbausteine ${String(Number(block.match?.[1]) || 1).padStart(2, "0")}`;
};

const parseTelcSprachAnswerMap = (solutionText) => {
  const seriesMap = new Map();
  const blocks = splitTelcSprachBlocks(solutionText);
  blocks.forEach((block) => {
    const answers = new Map();
    const lines = stripTelcPageDecorations(block.text)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    lines.forEach((line, index) => {
      for (const match of line.matchAll(/\b(1[0-9]|20|[1-9])\s*[\.)]?\s*([a-o])\b/gi)) {
        answers.set(Number(match[1]), match[2].toLowerCase());
      }

      const numbers = [...line.matchAll(/\b(1[0-9]|20|[1-9])\b/g)].map((match) => Number(match[1]));
      const nextLetters = [...(lines[index + 1] || "").matchAll(/\b([a-o])\b/gi)].map((match) => match[1].toLowerCase());
      if (numbers.length >= 2 && numbers.length === nextLetters.length) {
        numbers.forEach((number, offset) => answers.set(number, nextLetters[offset]));
      }
    });

    if (answers.size) seriesMap.set(Number(block.match[1]), answers);
  });
  return seriesMap;
};

const extractTelcSprachInlineOptions = (partText, partNumber, answerMap) => {
  const questions = [];
  const clean = stripTelcPageDecorations(partText);
  const optionPattern = /\b(1[0-9]|20|[1-9])\.\s*a\)\s*([\s\S]*?)\s+b\)\s*([\s\S]*?)\s+c\)\s*([\s\S]*?)(?=\s+\d{1,2}\.\s*a\)|(?:^|\n)\s*Teil\s+2\b|(?:^|\n)\s*Wortliste\b|$)/gim;
  for (const match of clean.matchAll(optionPattern)) {
    const number = Number(match[1]);
    const options = ["a", "b", "c"].map((value, index) => ({
      value,
      label: trimForDb(match[index + 2], 180),
    })).filter((option) => option.label);
    if (options.length < 2) continue;
    const correct = answerMap.get(number);
    questions.push({
      questionType: "multiple_choice",
      prompt: `Luecke ${number}: Waehlen Sie die passende Loesung.`,
      options,
      correctAnswer: correct ? { value: correct } : {},
      explanation: null,
      position: number,
      scoring: { points: 1 },
      metadata: { telcPart: partNumber, sourceQuestionNumber: number, sprachbausteine: true },
      sectionType: "sprach",
    });
  }
  return questions;
};

const extractTelcSprachWordListOptions = (partText) => {
  const wordListStart = String(partText ?? "").search(/(?:^|\n)\s*(?:Wortliste|Wortkasten|Auswahl)\s*:?\s*(?:\n|$)/i);
  const source = wordListStart >= 0 ? partText.slice(wordListStart) : partText;
  const options = [];
  const seen = new Set();
  for (const match of source.matchAll(/\b([a-o])\)\s*([\s\S]*?)(?=\s+[a-o]\)|(?:^|\n)\s*(?:Teil\s+\d|AUFGABE|\u00dcBUNGSSATZ|UEBUNGSSATZ|L(?:O|\u00d6|OE|.)SUNGEN)\b|$)/gim)) {
    const value = match[1].toLowerCase();
    const previousChar = source[Math.max(0, match.index - 1)] || "";
    if (/[-\u2010-\u2015]/.test(previousChar)) continue;
    if (seen.has(value)) continue;
    const label = trimForDb(match[2], 180);
    if (!label || /^\d{1,2}\./.test(label)) continue;
    seen.add(value);
    options.push({ value, label });
  }
  return options;
};

const parseTelcSprachPartQuestions = (partNumber, partText, answerMap) => {
  const inlineQuestions = extractTelcSprachInlineOptions(partText, partNumber, answerMap);
  const expectedNumbers = partNumber === 1
    ? Array.from({ length: 10 }, (_, index) => index + 1)
    : Array.from({ length: 10 }, (_, index) => index + 11);
  const inlineNumbers = new Set(inlineQuestions.map((question) => question.position));
  const missingNumbers = expectedNumbers.filter((number) => !inlineNumbers.has(number));
  if (partNumber !== 2 || !missingNumbers.length) return inlineQuestions;

  const wordListOptions = extractTelcSprachWordListOptions(partText);
  if (wordListOptions.length < 2) return inlineQuestions;
  const wordListQuestions = missingNumbers.map((number) => {
    const correct = answerMap.get(number);
    return {
      questionType: "multiple_choice",
      prompt: `Luecke ${number}: Waehlen Sie den passenden Sprachbaustein.`,
      options: wordListOptions,
      correctAnswer: correct ? { value: correct } : {},
      explanation: null,
      position: number,
      scoring: { points: 1 },
      metadata: { telcPart: partNumber, sourceQuestionNumber: number, sprachbausteine: true, wordList: true },
      sectionType: "sprach",
    };
  });
  return [...inlineQuestions, ...wordListQuestions].sort((a, b) => a.position - b.position);
};

const parseTelcSprachbausteineSeries = (text, metadata) => {
  const { taskText, solutionText } = splitTelcSprachTaskAndSolution(text);
  const answerMap = parseTelcSprachAnswerMap(solutionText);
  const blocks = splitTelcSprachBlocks(taskText);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = extractTelcSprachTitle(block);
    const answers = answerMap.get(seriesNumber) || new Map();
    const partMatches = [...block.text.matchAll(/(?:^|\n)\s*Teil\s+([12])\s*[:.\-\u2010-\u2015]?\s*([^\n]*)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = compactText(match[2]) || "Sprachbausteine";
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const questions = parseTelcSprachPartQuestions(partNumber, body, answers);
      return {
        sectionType: "sprach",
        partNumber,
        title: `Teil ${partNumber}: ${header}`,
        instructions: trimForDb([compactText(match[0]), body].join("\n"), 8000),
        durationMinutes: partNumber === 1 ? 15 : 15,
        points: 10,
        scoring: { points: 10 },
        metadata: { sourceHeader: header, telcFormat: true, sprachbausteine: true },
        questions,
      };
    });

    const fallbackSections = sections.length ? sections : [
      {
        sectionType: "sprach",
        partNumber: 1,
        title: "Sprachbausteine",
        instructions: trimForDb(block.text, 8000),
        durationMinutes: 30,
        points: 20,
        scoring: { points: 20 },
        metadata: { telcFormat: true, sprachbausteine: true, fallback: true },
        questions: [buildFallbackQuestion({ sectionType: "sprach", prompt: block.text, position: 1, questionType: "compound" })],
      },
    ];

    return {
      seriesNumber,
      title,
      sourceLabel: `Sprachbausteine ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "telc Deutsch Sprachbausteine: zwei Teile mit insgesamt 20 Luecken.",
      scoring: { totalPoints: 20, parts: { 1: 10, 2: 10 } },
      metadata: { ...metadata, telcFormat: true, sprachbausteine: true, answerKeyDetected: answers.size > 0 },
      sections: fallbackSections,
    };
  });
};

const parseTelcReadingSeries = (text, metadata) => {
  const clean = stripTelcPageDecorations(text);
  const blocks = splitTelcSujetBlocks(clean);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = extractTelcSujetTitle(block);
    const correctionStart = findTelcReadingCorrectionStart(block.text);
    const taskText = correctionStart >= 0 ? block.text.slice(0, correctionStart) : block.text;
    const correctionText = correctionStart >= 0 ? block.text.slice(correctionStart) : "";
    const answers = parseTelcReadingAnswerMap(correctionText);
    const partMatches = [...taskText.matchAll(/(?:^|\n)\s*Teil\s+([123])\s*[-\u2010-\u2015]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = compactText(match[2]);
      const body = taskText.slice(match.index + match[0].length, next ? next.index : taskText.length);
      const questions = parseTelcReadingPartQuestions(partNumber, body, answers);
      return {
        sectionType: "read",
        partNumber,
        title: `Teil ${partNumber}: ${header}`,
        instructions: trimForDb([match[0], body].join("\n"), 8000),
        durationMinutes: partNumber === 1 ? 15 : partNumber === 2 ? 25 : 20,
        points: 25,
        scoring: { points: 25 },
        metadata: { sourceHeader: header, telcFormat: true },
        questions,
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "telc Deutsch B1 Lesen: drei Leseteile, 60 Minuten, 75 Punkte.",
      scoring: { totalPoints: 75, parts: { 1: 25, 2: 25, 3: 25 } },
      metadata: { ...metadata, telcFormat: true, answerKeyDetected: answers.size > 0 },
      sections,
    };
  });
};

const parseTelcWritingSeries = (text, metadata) => {
  const { taskText, solutionText } = splitTelcTaskAndSolution(text);
  const solutionMap = parseTelcWritingSolutions(solutionText);
  const blocks = splitTelcSujetBlocks(taskText);
  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = extractTelcSujetTitle(block);
    const body = stripTelcPageDecorations(sliceAfterBlockMatch(block)).replace(/\n?\s*Ihr Text:\s*$/i, "");
    const solution = solutionMap.get(seriesNumber) || {};
    const correctAnswer = {};
    if (solution.sampleAnswer) correctAnswer.sampleAnswer = solution.sampleAnswer;
    if (solution.tips) correctAnswer.expectedPerformance = solution.tips;
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "telc Deutsch B1 Schreiben: eine E-Mail oder ein Brief mit vier Inhaltspunkten.",
      scoring: { totalPoints: 45, parts: { 1: 45 } },
      metadata: { ...metadata, telcFormat: true },
      sections: [
        {
          sectionType: "write",
          partNumber: 1,
          title: `Schreiben: ${title}`,
          instructions: trimForDb(body, 5000),
          durationMinutes: 30,
          points: 45,
          scoring: { points: 45, durationMinutes: 30 },
          metadata: { sourceHeader: title, telcFormat: true },
          questions: [
            {
              questionType: "writing_email",
              prompt: trimForDb([`Sujet ${String(seriesNumber).padStart(2, "0")}: ${title}`, body].join("\n")),
              options: [],
              correctAnswer,
              explanation: solution.tips || solution.sampleAnswer || null,
              position: 1,
              scoring: { points: 45, durationMinutes: 30 },
              metadata: { wordTarget: extractEclWordTarget(body) || 100, telcPart: 1 },
              sectionType: "write",
            },
          ],
        },
      ],
    };
  });
};

const parseTelcSpeakingSeries = (text, metadata) => {
  const { taskText, solutionText } = splitTelcTaskAndSolution(text);
  const solutionMap = parseTelcSpeakingSolutions(solutionText);
  const blocks = splitTelcSujetBlocks(taskText);
  const questionTypes = {
    1: "speaking_intro",
    2: "speaking_topic_discussion",
    3: "speaking_partner_planning",
  };
  const fallbackDurations = { 1: 4, 2: 5, 3: 6 };

  return blocks.map((block) => {
    const seriesNumber = Number(block.match[1]);
    const title = extractTelcSujetTitle(block);
    const solutions = solutionMap.get(seriesNumber)?.parts || new Map();
    const partMatches = [...block.text.matchAll(/(?:^|\n)\s*TEIL\s+([123])\s*[-\u2010-\u2015]\s*([^\n]+)/gi)];
    const sections = partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const partNumber = Number(match[1]);
      const header = compactText(match[2]);
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const durationMinutes = extractDurationMinutes([header, body].join(" ")) || fallbackDurations[partNumber] || null;
      const solution = solutions.get(partNumber) || {};
      const correctAnswer = {};
      if (solution.sampleAnswer) correctAnswer.sampleAnswer = solution.sampleAnswer;
      if (solution.tips) correctAnswer.expectedPerformance = solution.tips;
      return {
        sectionType: "speak",
        partNumber,
        title: `Teil ${partNumber}: ${header}`,
        instructions: trimForDb(body, 5000),
        durationMinutes,
        points: 25,
        scoring: { points: 25, durationMinutes },
        metadata: { sourceHeader: header, telcFormat: true },
        questions: [
          {
            questionType: questionTypes[partNumber] || "speaking_prompt",
            prompt: trimForDb([compactText(match[0]), body].join("\n")),
            options: [],
            correctAnswer,
            explanation: solution.tips || solution.sampleAnswer || null,
            position: partNumber,
            scoring: { points: 25, durationMinutes },
            metadata: { telcPart: partNumber },
            sectionType: "speak",
          },
        ],
      };
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `Sujet ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "telc Deutsch B1 Sprechen: drei mündliche Teile in einer Paarprüfung.",
      scoring: { totalPoints: 75, parts: { 1: 25, 2: 25, 3: 25 } },
      metadata: { ...metadata, telcFormat: true },
      sections,
    };
  });
};

const getB2SeriesPatterns = (metadata) => {
  const provider = normalizeDetectedProvider(metadata.provider);
  const sectionType = metadata.sectionType;
  const patterns = [];

  if (sectionType === "listen") {
    if (provider === "ecl") {
      patterns.push(/(?:^|\n)\s*S(?:\u00c9|E)RIE\s+0?(\d{1,2})\s*[-\u2010-\u2015]\s*([^\n]+)/gi);
    }
    if (provider === "telc") {
      patterns.push(/(?:^|\n)\s*SUJET\s+0?(\d{1,2})\s*[-\u2010-\u2015]\s*([^\n]+)/gi);
    }
    if (provider === "osd") {
      patterns.push(/(?:^|\n)\s*N\s+0?(\d{1,2})\s+([^\n]+)/gi);
    }
    if (provider === "goethe") {
      patterns.push(/(?:^|\n)\s*(?:Pr(?:\u00fc|ue)fung|PR(?:\u00dc|UE)FUNG)\s+0?(\d{1,2})\s*(?:\||[-\u2010-\u2015]|Thema:)\s*([^\n]+)/gi);
    }
  }

  if (provider === "telc" && sectionType === "read") {
    patterns.push(/(?:^|\n)\s*(?:\u00dcBUNGSHEFT|UEBUNGSHEFT|UBUNGSHEFT)\s+0?(\d{1,2})\b(?:[^\n]*\n\s*Thema:\s*([^\n]+))?/gi);
  }
  if (provider === "ecl" && sectionType === "speak") {
    patterns.push(/(?:^|\n)\s*SUJET\s+0?(\d{1,2})\s*[-\u2010-\u2015]\s*([^\n]+)/gi);
  }
  if (provider === "ecl" && sectionType === "read") {
    patterns.push(/(?:^|\n)\s*Sujet\s+0?(\d{1,2})\s*(?=\n)/gi);
  }
  if (provider === "goethe" && sectionType === "speak") {
    patterns.push(/(?:^|\n)\s*0?(\d{1,2})\s+([^\n]+?)\s+15\s+Min\b[^\n]*/gi);
    patterns.push(/(?:^|\n)\s*0?(\d{1,2})\s+([^\n]+?)\s+CORRIG/gi);
  }
  if (provider === "goethe" && sectionType === "write") {
    patterns.push(/(?:^|\n)\s*(\d{1,2})\s+([^\n]+?\s+[-\u2010-\u2015]\s+[^\n]+)/gi);
  }
  if (provider === "osd" && sectionType === "write") {
    patterns.push(/(?:^|\n)\s*OSD\s+B2\s+SCHREIBEN\s*[-\u2010-\u2015]\s*PR(?:\u00dc|UE)FUNG\s+0?(\d{1,2})\s*\/\s*20[^\n]*/gi);
  }

  patterns.push(/(?:^|\n)\s*(?:Pr(?:\u00fc|ue)fung|PR(?:\u00dc|UE)FUNG)\s+0?(\d{1,2})(?:\s*\/\s*20)?(?:\s*(?:\||[-\u2010-\u2015]|Thema:)\s*([^\n]+))?/gi);
  patterns.push(/(?:^|\n)\s*0?(\d{1,2})\s+([A-Z\u00c4\u00d6\u00dc][^\n]{12,})/gi);

  return patterns;
};

const splitB2NumberedBlocks = (text, metadata) => {
  const clean = stripPdfPageMarkers(text);
  const minBlocks = metadata.sectionType === "listen" ? 5 : 10;
  const candidates = getB2SeriesPatterns(metadata)
    .map((pattern, priority) => ({
      priority,
      blocks: splitByMatches(clean, pattern)
        .map((block) => {
          let seriesNumber = Number(block.match[1]);
          let title = compactText(block.match[2] || "");
          const splitNumberTitle = title.match(/^(\d)\s+(.+)/);
          if (splitNumberTitle && (seriesNumber === 1 || seriesNumber === 2)) {
            const combinedNumber = Number(`${seriesNumber}${splitNumberTitle[1]}`);
            if (combinedNumber >= 10 && combinedNumber <= 20) {
              seriesNumber = combinedNumber;
              title = splitNumberTitle[2];
            }
          }
          return {
            ...block,
            seriesNumber,
            title,
            bodyLength: compactText(block.text).length,
          };
        })
        .filter((block) => block.seriesNumber >= 1 && block.seriesNumber <= 20 && block.bodyLength >= 450),
    }))
    .filter((candidate) => candidate.blocks.length >= minBlocks);

  if (!candidates.length) return [];
  candidates.sort((a, b) => {
    const aUnique = new Set(a.blocks.map((block) => block.seriesNumber)).size;
    const bUnique = new Set(b.blocks.map((block) => block.seriesNumber)).size;
    if (bUnique !== aUnique) return bUnique - aUnique;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.blocks.length - a.blocks.length;
  });
  return candidates[0].blocks;
};

const getB2QuestionType = (sectionType, partNumber) => {
  if (sectionType === "write") return partNumber === 2 ? "writing_forum_post" : "writing_email";
  if (sectionType === "speak") return partNumber === 1 ? "speaking_prompt" : "speaking_discussion";
  return "compound";
};

const cleanB2ListeningText = (value) =>
  normalizeText(value)
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^(?:[-\u2010-\u2015]\s*)?(?:zweite wiedergabe|pause|playback|audio script)\b/i.test(line))
    .join("\n")
    .trim();

const trimB2ListeningBlock = (value, max = 9000) => cleanB2ListeningText(value).slice(0, max);

const extractB2ListeningProduction = (body) => {
  const markers = [
    /(?:^|\n)\s*(?:\p{Extended_Pictographic}\s*)?FICHE\s+DE\s+PRODUCTION\s+AUDIO\b[^\n]*/iu,
    /(?:^|\n)\s*PLAN\s+DE\s+PRODUCTION\s+AUDIO\b[^\n]*/iu,
    /(?:^|\n)\s*PROFILS?\s+DE\s+VOIX\b[^\n]*/iu,
    /(?:^|\n)\s*BRUITAGES?\b[^\n]*/iu,
    /(?:^|\n)\s*SFX\b[^\n]*/iu,
  ];
  const endMarkers = [
    /(?:^|\n)\s*(?:QUESTIONS|AUFGABEN|Aufgaben)\b/i,
    /(?:^|\n)\s*(?:Corrig|L(?:o|\u00f6|oe)sungen|L(?:o|\u00f6|oe)sungsschl(?:u|\u00fc|ue)ssel)\b/i,
    /(?:^|\n)\s*(?:TEIL|Teil|AUFGABE|Aufgabe|Texte?|TEXTE?)\s+[1-5]\b/i,
  ];
  for (const marker of markers) {
    const production = getBetweenMarkers(body, marker, endMarkers);
    if (production) return trimB2ListeningBlock(production, 3000);
  }
  return "";
};

const extractB2ListeningTranscript = (body) => {
  const markers = [
    /(?:^|\n)\s*(?:TRANSCRIPTION\s+AUDIO|Transcription\s+audio)\s*:/i,
    /(?:^|\n)\s*Transkription\s*:/i,
    /(?:^|\n)\s*Skript\s*:/i,
    /(?:^|\n)\s*SCRIPT\s+AUDIO[^\n]*/i,
    /(?:^|\n)\s*Transcription\s+du\s+document\s+sonore[^\n]*/i,
  ];
  const endMarkers = [
    /(?:^|\n)\s*(?:QUESTIONS\s*\/\s*T(?:A|Â)CHES|QUESTIONS|AUFGABEN|Aufgaben)\b/i,
    /(?:^|\n)\s*Aufgabe\s+\d{1,2}\s*:/i,
    /(?:^|\n)\s*(?:PLAN\s+DE\s+PRODUCTION|FICHE\s+DE\s+PRODUCTION|Corrig|L(?:o|\u00f6|oe)sungen|L(?:o|\u00f6|oe)sungsschl(?:u|\u00fc|ue)ssel)\b/i,
  ];
  for (const marker of markers) {
    const raw = getBetweenMarkers(body, marker, endMarkers);
    if (!raw) continue;
    const transcript = trimB2ListeningBlock(raw.replace(marker, ""), 12000);
    if (transcript.length > 30) return transcript;
  }

  const beforeQuestions = body.split(/(?:^|\n)\s*(?:QUESTIONS|AUFGABEN|Aufgaben)\b/i)[0] || body;
  const lines = cleanB2ListeningText(beforeQuestions)
    .split("\n")
    .filter((line) => /:\s*\S/.test(line) || line.split(/\s+/).length >= 6);
  return trimB2ListeningBlock(lines.join("\n"), 12000);
};

const buildB2ListeningAudioForSection = ({ provider, title, body, header, partNumber, seriesTitle }) => {
  const transcript = extractB2ListeningTranscript(body);
  const production = extractB2ListeningProduction(body);
  const audio = buildListeningAudioMetadata({
    provider,
    documentType: title || header || "H\u00f6rverstehen",
    situation: seriesTitle || header || title || "",
    transcript,
    production,
    partNumber,
    title,
  });
  return { transcript, production, audio };
};

const buildB2FallbackSections = ({ block, metadata, occurrenceIndex = 0 }) => {
  const sectionType = metadata.sectionType;
  const provider = normalizeDetectedProvider(metadata.provider);
  const labelPattern = sectionType === "listen" && provider === "ecl"
    ? "(TEIL|Teil|AUFGABE|Aufgabe|TEXTE|Texte|Text)"
    : "(TEIL|Teil|AUFGABE|Aufgabe)";
  const partRegex = new RegExp(`(?:^|\\n)\\s*(?:[n■•]\\s*)?(?:(?:LESEVERSTEHEN|SCHREIBEN|SPRECHEN|H(?:\\u00d6|OE|O)RVERSTEHEN)\\s*[-\\u2010-\\u2015]\\s*)?${labelPattern}\\s+([1-5])\\s*[-\\u2010-\\u2015:|.]?\\s*([^\\n]*)`, "gi");
  const partMatches = [...block.text.matchAll(partRegex)]
    .filter((match) => {
      const partNumber = Number(match[2]);
      const header = compactText(match[0]);
      const titleFragment = compactText(match[3]);
      const answerKeyCount = (header.match(/\b\d{1,2}\s*:\s*[A-ZRFN]\b/gi) || []).length;
      if (partNumber < 1 || partNumber > 5) return false;
      if (sectionType === "listen" && /^\d{1,2}\s*:/.test(titleFragment)) return false;
      if (/L(?:o|\u00f6|oe)sungen|L(?:o|\u00f6|oe)sungsschl(?:u|\u00fc|ue)ssel|Musterl(?:o|\u00f6|oe)sung|Kriterien|Bewertungsraster/i.test(header)) return false;
      if (answerKeyCount >= 2) return false;
      if (/Gesamtpunktzahl|Pkt\.\s*Niveau|Meinung\s*\/\s*15/i.test(header)) return false;
      return true;
    });

  const makeSection = ({ partNumber, title, body, header }) => {
    const prompt = trimForDb([header, body].filter(Boolean).join("\n"), 9000);
    const points = sectionType === "write" ? (partNumber === 2 ? 40 : 60) : sectionType === "speak" ? null : null;
    const durationMinutes = sectionType === "write" ? (partNumber === 2 ? 25 : 50) : sectionType === "speak" ? 5 : sectionType === "listen" ? 10 : null;
    const listening = sectionType === "listen"
      ? buildB2ListeningAudioForSection({ provider, title, body, header, partNumber, seriesTitle: block.title })
      : null;
    const sectionMetadata = {
      b2Fallback: true,
      sourceHeader: header || title || "",
      ...(listening ? {
        listening: true,
        transcript: listening.transcript,
        audio: listening.audio,
        production: listening.production,
      } : {}),
    };
    const questionMetadata = { b2Fallback: true, sourceSeriesNumber: block.seriesNumber };
    return {
      sectionType,
      partNumber,
      title: title || `${SECTION_LABELS[sectionType] || "Teil"} ${partNumber}`,
      instructions: trimForDb(body, 9000),
      durationMinutes,
      points,
      scoring: { points, durationMinutes, ...(sectionType === "listen" ? { listeningPasses: 2 } : {}) },
      metadata: sectionMetadata,
      questions: [
        {
          questionType: getB2QuestionType(sectionType, partNumber),
          prompt,
          options: [],
          correctAnswer: {},
          explanation: null,
          position: partNumber,
          scoring: { points, durationMinutes },
          metadata: questionMetadata,
          ...(listening ? { transcript: listening.transcript, audio: listening.audio } : {}),
          sectionType,
        },
      ],
    };
  };

  if (partMatches.length) {
    return partMatches.map((match, index) => {
      const next = partMatches[index + 1];
      const label = match[1];
      const partNumber = Number(match[2]);
      const header = compactText(match[0]);
      const displayLabel = /aufgabe/i.test(label) ? "Aufgabe" : /text/i.test(label) ? "Text" : "Teil";
      const title = `${displayLabel} ${partNumber}: ${compactText(match[3]) || SECTION_LABELS[sectionType] || "Aufgabe"}`;
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      return makeSection({ partNumber, title, body, header });
    });
  }

  const partNumber = occurrenceIndex + 1;
  return [
    makeSection({
      partNumber,
      title: block.title || `${SECTION_LABELS[sectionType] || "Aufgabe"} ${partNumber}`,
      body: block.text.slice(block.match[0].length || 0),
      header: compactText(block.match[0]),
    }),
  ];
};

const parseB2NumberedSeries = (text, metadata) => {
  const blocks = splitB2NumberedBlocks(text, metadata);
  if (!blocks.length) return [];

  const groups = new Map();
  blocks.forEach((block) => {
    if (!groups.has(block.seriesNumber)) groups.set(block.seriesNumber, []);
    groups.get(block.seriesNumber).push(block);
  });

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .slice(0, 20)
    .map(([seriesNumber, seriesBlocks]) => {
      const title = seriesBlocks.find((block) => block.title)?.title || `${metadata.examType || "B2"} ${seriesNumber}`;
      let sections = seriesBlocks.flatMap((block, occurrenceIndex) =>
        buildB2FallbackSections({ block, metadata, occurrenceIndex })
      );
      if (metadata.sectionType === "write" || metadata.sectionType === "listen") {
        const seenParts = new Set();
        sections = sections.filter((section) => {
          const partKey = Number(section.partNumber) || section.title;
          if (seenParts.has(partKey)) return false;
          seenParts.add(partKey);
          return true;
        });
      }
      return {
        seriesNumber,
        title,
        sourceLabel: `${metadata.examType || "B2"} ${String(seriesNumber).padStart(2, "0")}`,
        instructions: `${metadata.examType || "B2"} ${SECTION_LABELS[metadata.sectionType] || metadata.sectionType}: importierter Pruefungssatz.`,
        scoring: metadata.sectionType === "write" ? { totalPoints: 100 } : {},
        metadata: { ...metadata, b2Fallback: true },
        sections,
      };
    });
};

const parseGenericSeries = (text, metadata) => [
  {
    seriesNumber: 1,
    title: metadata.title || "Imported document",
    sourceLabel: "Document",
    instructions: "Document imported with generic fallback parser.",
    scoring: {},
    metadata,
    sections: [
      {
        sectionType: metadata.sectionType,
        partNumber: 1,
        title: SECTION_LABELS[metadata.sectionType] || "Exercise",
        instructions: trimForDb(text, 4000),
        durationMinutes: null,
        points: null,
        scoring: {},
        metadata: { fallback: true },
        questions: [buildFallbackQuestion({ sectionType: metadata.sectionType, prompt: text, position: 1 })],
      },
    ],
  },
];

const parseStructuredContent = (text, metadata) => {
  const provider = normalizeDetectedProvider(metadata.provider);
  const hasOsdSujets = /(?:^|\n)SUJET\s+0?\d{1,2}\b/i.test(text);
  const hasTelcSujets = /(?:^|\n)(?:SUJET|Sujet)\s+0?\d{1,2}\s*\/\s*20\b/i.test(text);
  const hasEclSujets = /(?:^|\n)Sujet\s+0?\d{1,2}\s+[-–—]/i.test(text);
  const hasEclCombinations = /(?:^|\n)Kombination\s+0?\d{1,2}\s+[-–—]/i.test(text);
  if ((provider === "telc" || /Sprachbausteine/i.test(text)) && metadata.sectionType === "sprach") {
    const series = parseTelcSprachbausteineSeries(text, metadata);
    if (series.length) return series;
  }
  if (metadata.level === "B2" && metadata.sectionType === "listen") {
    const series = parseB2NumberedSeries(text, metadata);
    if (series.length > 1) return series;
  }
  if (provider === "telc" && metadata.level === "B2" && metadata.sectionType === "read") {
    const series = parseB2NumberedSeries(text, metadata);
    if (series.length > 1) return series;
  }
  if ((provider === "telc" || hasTelcSujets) && metadata.sectionType === "read") {
    const series = parseTelcReadingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "telc" || hasTelcSujets) && metadata.sectionType === "write") {
    const series = parseTelcWritingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "telc" || hasTelcSujets) && metadata.sectionType === "speak") {
    const series = parseTelcSpeakingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "telc" || /(?:^|\n)SIMULATION\s+0?\d{1,2}\s*[—-]/i.test(text)) && metadata.sectionType === "listen") {
    const series = parseTelcListeningSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "ecl" || hasEclSujets) && metadata.sectionType === "read") {
    const series = parseEclReadingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "ecl" || hasEclSujets) && metadata.sectionType === "write") {
    const series = parseEclWritingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "ecl" || hasEclSujets) && metadata.sectionType === "listen") {
    const series = parseEclListeningSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "ecl" || hasEclCombinations) && metadata.sectionType === "speak") {
    const series = parseEclSpeakingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "osd" || hasOsdSujets) && metadata.sectionType === "read") {
    const series = parseOsdReadingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "osd" || hasOsdSujets) && metadata.sectionType === "write") {
    const series = parseOsdWritingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "osd" || hasOsdSujets) && metadata.sectionType === "speak") {
    const series = parseOsdSpeakingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "osd" || /Zertifikat\s+B1\s*[–-]\s*Hören\s+Prüfung/i.test(text)) && metadata.sectionType === "listen") {
    const series = parseOsdListeningSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "goethe" || /Zertifikat\s+B1\s+Hören/i.test(text)) && metadata.sectionType === "listen") {
    const series = parseGoetheListeningSeries(text, metadata);
    if (series.length) return series;
  }
  if (metadata.sectionType === "speak" && /Thema\s+\d+\s*:/i.test(text)) {
    return parseSpeakingSeries(text, metadata);
  }
  if (metadata.sectionType === "write" && /Aufgabe\s+\d+\s*\/\s*\d+/i.test(text)) {
    return parseWritingSeries(text, metadata);
  }
  if (metadata.sectionType === "read" && /PR.FUNGSHEFT\s+\d+\s*\|/i.test(text)) {
    return parseReadingSeries(text, metadata);
  }
  if (metadata.level === "B2") {
    const series = parseB2NumberedSeries(text, metadata);
    if (series.length > 1) return series;
  }
  return parseGenericSeries(text, metadata);
};

const runImageOcr = async (buffer, extension) => {
  const tempName = `exam-import-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension || "png"}`;
  const tempPath = path.join(os.tmpdir(), tempName);
  await fs.promises.writeFile(tempPath, buffer);
  try {
    const result = await execFileAsync("tesseract", [tempPath, "stdout", "-l", "deu+eng"], {
      timeout: 90000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return result.stdout;
  } finally {
    fs.promises.unlink(tempPath).catch(() => undefined);
  }
};

const extractDocumentText = async ({ buffer, filename, mimetype }) => {
  const extension = getFileExtension(filename);
  const warnings = [];
  const mime = String(mimetype || "").toLowerCase();
  let text = "";
  let method = "text";
  let pageCount = null;

  if (extension === "docx" || mime.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
    method = "docx:mammoth";
    if (result.messages?.length) {
      warnings.push(...result.messages.map((message) => String(message.message || message)));
    }
  } else if (extension === "pdf" || mime.includes("pdf")) {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText({
        lineEnforce: true,
        pageJoiner: "\n--- PAGE page_number/total_number ---",
      });
      text = result.text;
      pageCount = result.total || result.pages?.length || null;
      method = "pdf:pdf-parse";
    } finally {
      await parser.destroy();
    }
    if (text.replace(/\s+/g, "").length < 80) {
      warnings.push("Very little text was extracted. This PDF may be scanned and require OCR.");
    }
  } else if (["txt", "md", "csv"].includes(extension) || mime.startsWith("text/")) {
    text = buffer.toString("utf8");
    method = "text:utf8";
  } else if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "tif", "tiff"].includes(extension)) {
    try {
      text = await runImageOcr(buffer, extension);
      method = "image:tesseract";
    } catch (err) {
      warnings.push(`OCR failed or tesseract is not installed: ${err.message}`);
      text = "";
      method = "image:ocr-unavailable";
    }
  } else {
    throw new Error("Unsupported document type. Upload PDF, DOCX, TXT, or an image.");
  }

  return {
    text: normalizeText(text),
    extraction: {
      method,
      pageCount,
      charCount: text.length,
      warnings,
    },
  };
};

const validateParsedDocument = (parsed) => {
  const warnings = [...(parsed.extraction?.warnings || [])];
  if (!parsed.series.length) warnings.push("No exam series could be detected; fallback parser created one generic series.");
  const questionCount = parsed.series.reduce(
    (sum, series) => sum + series.sections.reduce((sectionSum, section) => sectionSum + section.questions.length, 0),
    0
  );
  if (!questionCount) warnings.push("No questions were detected.");
  if (parsed.metadata.provider === "custom") warnings.push("Exam provider could not be detected confidently.");
  if (!parsed.metadata.level) warnings.push("Exam level could not be detected.");
  return {
    warnings,
    questionCount,
    sectionCount: parsed.series.reduce((sum, series) => sum + series.sections.length, 0),
  };
};

const getParsedCounts = (parsed) => ({
  seriesCount: (Array.isArray(parsed?.series) ? parsed.series : []).length,
  sectionCount: (Array.isArray(parsed?.series) ? parsed.series : []).reduce((sum, series) => sum + (series.sections || []).length, 0),
  questionCount: (Array.isArray(parsed?.series) ? parsed.series : []).reduce(
    (sum, series) => sum + (series.sections || []).reduce((sectionSum, section) => sectionSum + (section.questions || []).length, 0),
    0
  ),
  transcriptCount: (Array.isArray(parsed?.series) ? parsed.series : []).reduce(
    (sum, series) =>
      sum + (series.sections || []).reduce(
        (sectionSum, section) =>
          sectionSum + ((section.metadata?.transcript || (section.questions || []).some((question) => question.transcript)) ? 1 : 0),
        0
      ),
    0
  ),
});

const buildImportConfidence = (parsed) => {
  const counts = getParsedCounts(parsed);
  const provider = parsed.metadata.provider && parsed.metadata.provider !== "custom" ? 0.95 : 0.35;
  const level = parsed.metadata.level ? 0.95 : 0.35;
  const series = counts.seriesCount > 1 ? 0.94 : counts.seriesCount === 1 ? 0.55 : 0.1;
  const sections = counts.sectionCount >= counts.seriesCount ? 0.9 : 0.45;
  const questions = counts.questionCount >= counts.seriesCount * 5 ? 0.92 : counts.questionCount > 0 ? 0.55 : 0.1;
  const transcripts = parsed.metadata.sectionType === "listen"
    ? counts.transcriptCount >= counts.seriesCount ? 0.9 : counts.transcriptCount > 0 ? 0.55 : 0.1
    : 1;
  const answersDetected = parsed.series.reduce(
    (sum, series) =>
      sum + series.sections.reduce(
        (sectionSum, section) =>
          sectionSum + section.questions.filter((question) => Object.keys(question.correctAnswer || {}).length > 0).length,
        0
      ),
    0
  );
  const answers = counts.questionCount ? Math.min(0.95, Math.max(0.2, answersDetected / counts.questionCount)) : 0.1;
  const values = { provider, level, series, sections, questions, transcripts, answers };
  const overall = Object.values(values).reduce((sum, value) => sum + value, 0) / Object.values(values).length;
  return {
    overall: Math.round(overall * 100),
    provider: Math.round(provider * 100),
    level: Math.round(level * 100),
    series: Math.round(series * 100),
    sections: Math.round(sections * 100),
    questions: Math.round(questions * 100),
    transcripts: Math.round(transcripts * 100),
    answers: Math.round(answers * 100),
  };
};

const validateImportDraftContent = (parsed) => {
  const warnings = [...(parsed.validation?.warnings || [])];
  const errors = [];
  const seenCodes = new Set();
  const seenPrompts = new Set();

  if (!parsed.series?.length) errors.push("No series were detected.");
  parsed.series?.forEach((series) => {
    const seriesKey = Number(series.seriesNumber);
    if (seenCodes.has(seriesKey)) errors.push(`Series ${series.seriesNumber} is duplicated.`);
    seenCodes.add(seriesKey);
    if (!series.sections?.length) errors.push(`${series.sourceLabel || `Series ${series.seriesNumber}`} has no sections.`);
    series.sections?.forEach((section) => {
      if (!section.questions?.length) errors.push(`${series.sourceLabel || "Series"} ${section.title || "section"} has no questions.`);
      if (section.sectionType === "listen") {
        const hasTranscript = Boolean(section.metadata?.transcript) || section.questions.some((question) => question.transcript);
        if (!hasTranscript) errors.push(`${series.sourceLabel || "Series"} ${section.title || "listening section"} has no transcript.`);
      }
      section.questions?.forEach((question) => {
        const promptKey = compactText(question.prompt).toLowerCase();
        if (!promptKey) errors.push(`${series.sourceLabel || "Series"} ${section.title || "section"} has an empty question prompt.`);
        if (promptKey && seenPrompts.has(`${series.seriesNumber}:${promptKey}`)) {
          warnings.push(`${series.sourceLabel || "Series"} has a duplicated question prompt.`);
        }
        seenPrompts.add(`${series.seriesNumber}:${promptKey}`);
        if (["multiple_choice", "true_false", "yes_no", "matching"].includes(question.questionType) && !question.options?.length) {
          errors.push(`${series.sourceLabel || "Series"} question ${question.position} has no answer options.`);
        }
        if (!Object.keys(question.correctAnswer || {}).length) {
          warnings.push(`${series.sourceLabel || "Series"} question ${question.position} has no detected correct answer.`);
        }
      });
    });
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    counts: getParsedCounts(parsed),
  };
};

const analyzeExamDocument = async ({ buffer, filename, mimetype }) => {
  if (!buffer?.length) throw new Error("Document buffer is empty");
  const { text, extraction } = await extractDocumentText({ buffer, filename, mimetype });
  const filenameProvider = detectProviderFromFilename(filename);
  const filenameLevel = detectLevelFromFilename(filename);
  const filenameSectionType = detectSectionTypeFromFilename(filename);
  let provider = filenameProvider || detectProvider(text);
  if (provider === "custom" && /(?:^|\n)(?:SUJET|Sujet)\s+0?\d{1,2}\s*\/\s*20\b/i.test(text) && /\btelc\b/i.test(text)) {
    provider = "telc";
  }
  if (provider === "custom" && /(?:^|\n)SUJET\s+0?\d{1,2}\b/i.test(text)) provider = "osd";
  const level = filenameLevel || detectLevel(text);
  const sectionType = filenameSectionType || detectSectionType(text);
  const examType = detectExamType(text, provider, level);
  const title = compactText(text).split("\n").slice(0, 3).join(" - ").slice(0, 180);
  const metadata = {
    provider,
    level,
    sectionType,
    sectionLabel: SECTION_LABELS[sectionType],
    examType,
    title,
    language: "de",
  };
  const series = parseStructuredContent(text, metadata).map((item, index) => ({
    ...item,
    seriesNumber: Number.isFinite(item.seriesNumber) ? item.seriesNumber : index + 1,
  }));
  const parsed = {
    documentHash: hashBuffer(buffer),
    filename,
    mimetype,
    sizeBytes: buffer.length,
    extraction,
    metadata,
    series,
    rawTextPreview: compactText(text).slice(0, 2000),
  };
  const validation = validateParsedDocument(parsed);
  return {
    ...parsed,
    validation,
    confidence: buildImportConfidence({ ...parsed, validation }),
    analyzerVersion: IMPORT_ANALYZER_VERSION,
  };
};

const ensureDocumentImportSchema = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_document_imports (
      id SERIAL PRIMARY KEY,
      document_hash TEXT UNIQUE NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      provider TEXT,
      exam_type TEXT,
      level TEXT,
      section_type TEXT,
      total_series INTEGER NOT NULL DEFAULT 0,
      total_sections INTEGER NOT NULL DEFAULT 0,
      total_questions INTEGER NOT NULL DEFAULT 0,
      extraction_method TEXT,
      parse_status TEXT NOT NULL DEFAULT 'imported',
      validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_outline JSONB NOT NULL DEFAULT '{}'::jsonb,
      draft_content JSONB NOT NULL DEFAULT '{}'::jsonb,
      confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_exam_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );
  `);
  await pool.query(`ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS draft_content JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS confidence JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS error_message TEXT;`);
  await pool.query(`ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE exam_document_imports ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_document_imports_created_idx
      ON exam_document_imports(created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_document_imports_status_idx
      ON exam_document_imports(parse_status, updated_at DESC);
  `);
  await pool.query(`ALTER TABLE exam_document_imports ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_import_preferences (
      id SERIAL PRIMARY KEY,
      provider TEXT,
      section_type TEXT,
      preference_type TEXT NOT NULL,
      source_key TEXT,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_import_preferences_lookup_idx
      ON exam_import_preferences(provider, section_type, preference_type, updated_at DESC);
  `);
  await pool.query(`ALTER TABLE exam_import_preferences ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS provider TEXT;`);
  await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS section_type TEXT;`);
  await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS series_number INTEGER;`);
  await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS source_import_id INTEGER;`);
  await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exams_source_import_idx
      ON exams(source_import_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_sections (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      section_type TEXT NOT NULL,
      part_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      instructions TEXT,
      duration_minutes INTEGER,
      points NUMERIC(8,2),
      scoring JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_sections_exam_position_idx
      ON exam_sections(exam_id, position, id);
  `);
  await pool.query(`ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS points NUMERIC(8,2);`);
  await pool.query(`ALTER TABLE exam_sections ALTER COLUMN points TYPE NUMERIC(8,2) USING points::numeric;`);
  await pool.query(`ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES exam_sections(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_type TEXT;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS transcript TEXT;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS audio JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS scoring JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS global_duration_minutes INTEGER;`);
  await pool.query(`ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS listening_count INTEGER;`);
  await pool.query(`ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS audio_generation_status TEXT NOT NULL DEFAULT 'draft';`);
  await pool.query(`ALTER TABLE exam_sections ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_listening_audio_items (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES exam_sections(id) ON DELETE CASCADE,
      source_import_id INTEGER REFERENCES exam_document_imports(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      level TEXT,
      series_number INTEGER,
      part_number INTEGER NOT NULL DEFAULT 1,
      item_number INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      instructions TEXT,
      admin_transcript TEXT,
      audio_engine_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      listening_count INTEGER,
      duration_seconds NUMERIC(10,2),
      generated_audio_url TEXT,
      generated_audio_asset_id INTEGER,
      audio_generation_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (audio_generation_status IN ('draft', 'queued', 'generating', 'generated', 'approved', 'published', 'failed')),
      validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE exam_listening_audio_items ADD COLUMN IF NOT EXISTS source_import_id INTEGER REFERENCES exam_document_imports(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE exam_listening_audio_items ADD COLUMN IF NOT EXISTS generated_audio_asset_id INTEGER;`);
  await pool.query(`ALTER TABLE exam_listening_audio_items ADD COLUMN IF NOT EXISTS validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE exam_listening_audio_items ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_listening_audio_items_lookup_idx
      ON exam_listening_audio_items(exam_id, part_number, position, item_number);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_listening_audio_items_status_idx
      ON exam_listening_audio_items(audio_generation_status, updated_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_listening_audio_items_import_idx
      ON exam_listening_audio_items(source_import_id);
  `);
};

const summarizeOutline = (parsed = {}) => ({
  title: parsed.metadata?.title || parsed.filename || "Imported document",
  rawTextPreview: parsed.rawTextPreview || "",
  series: (Array.isArray(parsed.series) ? parsed.series : []).map((series) => ({
    seriesNumber: series.seriesNumber,
    title: series.title,
    sourceLabel: series.sourceLabel,
    sectionCount: (series.sections || []).length,
    questionCount: (series.sections || []).reduce((sum, section) => sum + (section.questions || []).length, 0),
    sections: (series.sections || []).map((section) => ({
      partNumber: section.partNumber,
      title: section.title,
      sectionType: section.sectionType,
      questionCount: (section.questions || []).length,
      durationMinutes: section.durationMinutes,
      points: section.points,
    })),
  })),
});

const insertParsedExamsForImport = async ({ client, parsed, importRow, adminId = null, isActive = true }) => {
  const importedExams = [];
  for (const series of parsed.series) {
      const codeParts = [
        parsed.metadata.provider,
        parsed.metadata.level || "level",
        parsed.metadata.sectionType,
        `series-${String(series.seriesNumber).padStart(2, "0")}`,
        parsed.documentHash.slice(0, 8),
      ];
      const code = codeParts.map(slugify).filter(Boolean).join("-");
      const name = `${parsed.metadata.examType} - ${SECTION_LABELS[parsed.metadata.sectionType] || parsed.metadata.sectionType} - ${series.sourceLabel || `Serie ${series.seriesNumber}`}`;
      const exam = await client.query(
        `INSERT INTO exams (
           code, name, exam_type, level, is_active, created_by, provider, section_type,
           series_number, source_import_id, metadata
         )
         VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING *`,
        [
          code.slice(0, 80),
          name.slice(0, 160),
          parsed.metadata.examType.slice(0, 80),
          parsed.metadata.level,
          adminId,
          parsed.metadata.provider,
          parsed.metadata.sectionType,
          series.seriesNumber,
          importRow.id,
          JSON.stringify({
            sourceLabel: series.sourceLabel,
            title: series.title,
            instructions: series.instructions,
            scoring: series.scoring,
            documentHash: parsed.documentHash,
            parser: parsed.analyzerVersion || IMPORT_ANALYZER_VERSION,
          }),
        ]
      );
      const examRow = exam.rows[0];
      importedExams.push(examRow);

      for (const [sectionIndex, section] of series.sections.entries()) {
        const insertedSection = await client.query(
          `INSERT INTO exam_sections (
             exam_id, section_type, part_number, title, instructions, duration_minutes,
             points, scoring, metadata, position
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
           RETURNING *`,
          [
            examRow.id,
            section.sectionType || parsed.metadata.sectionType,
            section.partNumber || sectionIndex + 1,
            String(section.title || `Teil ${sectionIndex + 1}`).slice(0, 160),
            section.instructions ? trimForDb(section.instructions, MAX_EXPLANATION_CHARS) : null,
            parseNumber(section.durationMinutes),
            parseNumber(section.points),
            JSON.stringify(section.scoring || {}),
            JSON.stringify(section.metadata || {}),
            sectionIndex + 1,
          ]
        );
        const sectionRow = insertedSection.rows[0];
        const questionValues = [];
        const questionPlaceholders = [];
        for (const [questionIndex, question] of (section.questions || []).entries()) {
          const base = questionValues.length;
          questionPlaceholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}::jsonb, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}::jsonb, $${base + 12}::jsonb, $${base + 13}::jsonb)`
          );
          questionValues.push(
            examRow.id,
            sectionRow.id,
            question.sectionType || section.sectionType || parsed.metadata.sectionType,
            trimForDb(question.prompt || section.instructions || series.instructions || series.title),
            JSON.stringify(Array.isArray(question.options) ? question.options : []),
            JSON.stringify(question.correctAnswer || {}),
            question.explanation ? trimForDb(question.explanation, MAX_EXPLANATION_CHARS) : null,
            Number.isInteger(question.position) ? question.position : questionIndex + 1,
            question.questionType || "compound",
            question.transcript || null,
            JSON.stringify(question.audio || {}),
            JSON.stringify(question.scoring || {}),
            JSON.stringify({
              ...(question.metadata || {}),
              sourceLabel: series.sourceLabel,
              partNumber: section.partNumber,
              documentImportId: importRow.id,
            })
          );
        }
        if (questionPlaceholders.length) {
          await client.query(
            `INSERT INTO exam_questions (
               exam_id, section_id, module_id, prompt, options, correct_answer, explanation,
               position, question_type, transcript, audio, scoring, source_metadata
             )
             VALUES ${questionPlaceholders.join(", ")}`,
            questionValues
          );
        }
      }
    }
  return importedExams;
};

const saveExamImportDraft = async ({ pool, parsed, adminId = null }) => {
  await ensureDocumentImportSchema(pool);
  const validation = validateImportDraftContent(parsed);
  const outline = summarizeOutline(parsed);
  const confidence = parsed.confidence || buildImportConfidence(parsed);
  const existing = await pool.query(`SELECT * FROM exam_document_imports WHERE document_hash = $1 LIMIT 1`, [parsed.documentHash]);
  const existingRow = existing.rows[0];
  if (existingRow && Array.isArray(existingRow.imported_exam_ids) && existingRow.imported_exam_ids.length) {
    return {
      duplicate: true,
      import: existingRow,
      parsed: existingRow.draft_content && Object.keys(existingRow.draft_content).length ? existingRow.draft_content : parsed,
      validation,
    };
  }

  const params = [
    parsed.documentHash,
    parsed.filename,
    parsed.mimetype || null,
    parsed.sizeBytes,
    parsed.metadata.provider,
    parsed.metadata.examType,
    parsed.metadata.level,
    parsed.metadata.sectionType,
    parsed.series.length,
    validation.counts.sectionCount,
    validation.counts.questionCount,
    parsed.extraction?.method || null,
    JSON.stringify(validation.warnings),
    JSON.stringify(outline),
    JSON.stringify(parsed),
    JSON.stringify(confidence),
    adminId,
  ];

  const result = existingRow
    ? await pool.query(
        `UPDATE exam_document_imports
         SET filename = $2,
             mime_type = $3,
             size_bytes = $4,
             provider = $5,
             exam_type = $6,
             level = $7,
             section_type = $8,
             total_series = $9,
             total_sections = $10,
             total_questions = $11,
             extraction_method = $12,
             parse_status = 'draft',
             validation_warnings = $13::jsonb,
             raw_outline = $14::jsonb,
             draft_content = $15::jsonb,
             confidence = $16::jsonb,
             error_message = NULL,
             updated_at = NOW()
         WHERE document_hash = $1
         RETURNING *`,
        params.slice(0, 16)
      )
    : await pool.query(
        `INSERT INTO exam_document_imports (
           document_hash, filename, mime_type, size_bytes, provider, exam_type, level, section_type,
           total_series, total_sections, total_questions, extraction_method, parse_status,
           validation_warnings, raw_outline, draft_content, confidence, created_by, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, NOW())
         RETURNING *`,
        params
      );

  return {
    duplicate: false,
    import: result.rows[0],
    parsed,
    validation,
  };
};

const saveListeningImportFoundationDraft = async ({ pool, foundation, adminId = null }) => {
  await ensureDocumentImportSchema(pool);
  const existing = await pool.query(`SELECT * FROM exam_document_imports WHERE document_hash = $1 LIMIT 1`, [
    foundation.documentHash,
  ]);
  const existingRow = existing.rows[0];
  if (existingRow && existingRow.section_type === "listen") {
    return {
      duplicate: true,
      import: existingRow,
      draft: existingRow.draft_content && Object.keys(existingRow.draft_content).length
        ? existingRow.draft_content
        : foundation.draft,
    };
  }

  const params = [
    foundation.documentHash,
    foundation.filename,
    foundation.mimetype || null,
    foundation.sizeBytes,
    foundation.metadata.provider,
    foundation.metadata.examType,
    foundation.metadata.level,
    foundation.draft.hierarchy.seriesDetected || 0,
    foundation.draft.hierarchy.teileDetected || 0,
    JSON.stringify(foundation.validation.warnings || []),
    JSON.stringify({
      title: foundation.metadata.title,
      hierarchy: foundation.draft.hierarchy,
      markerCounts: foundation.draft.markerCounts,
    }),
    JSON.stringify(foundation.draft),
    JSON.stringify({
      providerDetected: foundation.metadata.provider !== "custom",
      levelDetected: Boolean(foundation.metadata.level),
      requiredMarkersDetected: foundation.draft.markerCounts,
    }),
    adminId,
  ];

  const result = existingRow
    ? await pool.query(
        `UPDATE exam_document_imports
         SET filename = $2,
             mime_type = $3,
             size_bytes = $4,
             provider = $5,
             exam_type = $6,
             level = $7,
             section_type = 'listen',
             total_series = $8,
             total_sections = $9,
             total_questions = 0,
             extraction_method = 'docx-marker-foundation',
             parse_status = 'draft',
             validation_warnings = $10::jsonb,
             raw_outline = $11::jsonb,
             draft_content = $12::jsonb,
             confidence = $13::jsonb,
             error_message = NULL,
             updated_at = NOW()
         WHERE document_hash = $1
         RETURNING *`,
        params.slice(0, 13)
      )
    : await pool.query(
        `INSERT INTO exam_document_imports (
           document_hash, filename, mime_type, size_bytes, provider, exam_type, level,
           section_type, total_series, total_sections, total_questions, extraction_method,
           parse_status, validation_warnings, raw_outline, draft_content, confidence, created_by, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'listen', $8, $9, 0, 'docx-marker-foundation',
           'draft', $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, NOW())
         RETURNING *`,
        params
      );

  return {
    duplicate: false,
    import: result.rows[0],
    draft: foundation.draft,
  };
};

const getExamImportDraft = async ({ pool, importId }) => {
  await ensureDocumentImportSchema(pool);
  const result = await pool.query(`SELECT * FROM exam_document_imports WHERE id = $1`, [importId]);
  return result.rows[0] || null;
};

const updateExamImportDraft = async ({ pool, importId, draftContent }) => {
  await ensureDocumentImportSchema(pool);
  const parsed = {
    ...draftContent,
    validation: draftContent.validation || validateParsedDocument(draftContent),
  };
  const validation = validateImportDraftContent(parsed);
  parsed.validation = {
    ...(parsed.validation || {}),
    warnings: validation.warnings,
    questionCount: validation.counts.questionCount,
    sectionCount: validation.counts.sectionCount,
  };
  parsed.confidence = parsed.confidence || buildImportConfidence(parsed);
  const result = await pool.query(
    `UPDATE exam_document_imports
     SET provider = $2,
         exam_type = $3,
         level = $4,
         section_type = $5,
         total_series = $6,
         total_sections = $7,
         total_questions = $8,
         validation_warnings = $9::jsonb,
         raw_outline = $10::jsonb,
         draft_content = $11::jsonb,
         confidence = $12::jsonb,
         parse_status = CASE WHEN parse_status = 'published' THEN parse_status ELSE 'draft' END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      importId,
      parsed.metadata?.provider || null,
      parsed.metadata?.examType || null,
      parsed.metadata?.level || null,
      parsed.metadata?.sectionType || null,
      parsed.series?.length || 0,
      validation.counts.sectionCount,
      validation.counts.questionCount,
      JSON.stringify(validation.warnings),
      JSON.stringify(summarizeOutline(parsed)),
      JSON.stringify(parsed),
      JSON.stringify(parsed.confidence || {}),
    ]
  );
  return {
    import: result.rows[0] || null,
    parsed,
    validation,
  };
};

const publishExamImportDraft = async ({ pool, importId, adminId = null }) => {
  await ensureDocumentImportSchema(pool);
  const rowResult = await pool.query(`SELECT * FROM exam_document_imports WHERE id = $1`, [importId]);
  const importRow = rowResult.rows[0];
  if (!importRow) throw new Error("Import draft not found");
  if (Array.isArray(importRow.imported_exam_ids) && importRow.imported_exam_ids.length) {
    return {
      duplicate: true,
      import: importRow,
      exams: [],
      parsed: importRow.draft_content,
      validation: validateImportDraftContent(importRow.draft_content),
    };
  }
  const parsed = importRow.draft_content && Object.keys(importRow.draft_content).length ? importRow.draft_content : importRow.raw_outline;
  const validation = validateImportDraftContent(parsed);
  if (!validation.ok) {
    await pool.query(
      `UPDATE exam_document_imports SET parse_status = 'validation_failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [importId, validation.errors.join("\n")]
    );
    const err = new Error("Import draft has validation errors. Fix them before publishing.");
    err.validation = validation;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const importedExams = await insertParsedExamsForImport({ client, parsed, importRow, adminId, isActive: true });
    const updated = await client.query(
      `UPDATE exam_document_imports
       SET imported_exam_ids = $2::jsonb,
           parse_status = 'published',
           published_at = NOW(),
           updated_at = NOW(),
           error_message = NULL
       WHERE id = $1
       RETURNING *`,
      [importId, JSON.stringify(importedExams.map((exam) => exam.id))]
    );
    await client.query(
      `INSERT INTO exam_import_preferences (provider, section_type, preference_type, source_key, value, created_by)
       VALUES ($1, $2, 'last_published_import', $3, $4::jsonb, $5)`,
      [
        parsed.metadata?.provider || null,
        parsed.metadata?.sectionType || null,
        parsed.documentHash,
        JSON.stringify({
          analyzerVersion: parsed.analyzerVersion || IMPORT_ANALYZER_VERSION,
          confidence: parsed.confidence || {},
          seriesCount: parsed.series?.length || 0,
          questionCount: validation.counts.questionCount,
        }),
        adminId,
      ]
    );
    await client.query("COMMIT");
    return {
      duplicate: false,
      import: updated.rows[0],
      exams: importedExams,
      parsed,
      validation,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const importParsedExamDocument = async ({ pool, parsed, adminId = null }) => {
  const draft = await saveExamImportDraft({ pool, parsed, adminId });
  if (draft.duplicate) {
    return {
      duplicate: true,
      import: draft.import,
      exams: [],
      parsed: draft.parsed,
    };
  }
  return publishExamImportDraft({ pool, importId: draft.import.id, adminId });
};

module.exports = {
  analyzeExamDocument,
  buildListeningImportFoundation,
  ensureDocumentImportSchema,
  getExamImportDraft,
  importParsedExamDocument,
  publishExamImportDraft,
  saveExamImportDraft,
  saveListeningImportFoundationDraft,
  summarizeOutline,
  updateExamImportDraft,
  validateImportDraftContent,
};
