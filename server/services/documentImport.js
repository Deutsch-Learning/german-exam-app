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
  const haystack = text.toLowerCase();
  const scores = {
    read: 0,
    listen: 0,
    write: 0,
    speak: 0,
  };

  [
    ["read", ["leseverstehen", "prufungsteil: lesen", "prüfungsteil: lesen", " lesen ", "richtig/falsch", "compréhension écrite", "comprehension ecrite"]],
    ["listen", ["horverstehen", "hörverstehen", "hoeren", "hören", "audio", "transkript"]],
    ["write", ["schreiben", "schriftlicher ausdruck", "schriftliche kommunikation", "expression écrite", "expression ecrite", "private e-mail", "diskussionsbeitrag", "musterloesung teil", "musterlösung teil"]],
    ["speak", ["sprechen", "mündlicher ausdruck", "muendlicher ausdruck", "mündliche kommunikation", "mundliche kommunikation", "mündliche prüfung", "mundliche pruefung", "gelenktes gespräch", "gelenktes gesprach", "selbständige äußerung", "selbstandige ausserung", "kandidat a", "gemeinsam planen"]],
  ].forEach(([section, tokens]) => {
    tokens.forEach((token) => {
      if (haystack.includes(token)) scores[section] += 1;
    });
  });

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    : "read";
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
  return index >= 0 ? index : -1;
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
    const raw = block.text.slice(block.match[0].length).trim();
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
    partMatches.forEach((match, index) => {
      const next = partMatches[index + 1];
      const body = block.text.slice(match.index + match[0].length, next ? next.index : block.text.length);
      const answers = new Map();
      compactText(body).split("\n").forEach((line) => {
        const answerMatch = line.match(/^\s*(\d{1,2})\.\s+(.+?)\s*(?:→|->|=>)\s*(.+?)\s*$/);
        if (!answerMatch) return;
        answers.set(Number(answerMatch[1]), compactText(answerMatch[3]));
      });
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
    const raw = block.text.slice(block.match[0].length).trim();
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
    const raw = block.text.slice(block.match[0].length).trim();
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

const extractEclAudioMetadata = ({ partText, transcript, header }) => {
  const fiche = getBetweenMarkers(partText, /FICHE\s+AUDIO\s+ELEVENLABS/i, [
    /(?:^|\n)SUJET\s+N[°º]?\s*0?\d{1,2}\s*[-–—]\s*TEIL\s+[12]\s*:/i,
  ]);
  const lines = fiche.split("\n").map((line) => line.trim()).filter(Boolean);
  const voices = lines.map(parseEclVoiceLine).filter(Boolean);
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
  const sfx = compactText(fiche.match(/SFX\s*:\s*([^\n]+)/i)?.[1] || "");
  const timing = compactText(fiche.match(/TIMING\s+SFX\s*:\s*([^\n]+)/i)?.[1] || "");
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
  const clean = stripPdfPageMarkers(text);
  const correctionStart = findEclListeningCorrectionStart(clean);
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
  if (metadata.sectionType === "speak" && /Thema\s+\d+\s*:/i.test(text)) {
    return parseSpeakingSeries(text, metadata);
  }
  if (metadata.sectionType === "write" && /Aufgabe\s+\d+\s*\/\s*\d+/i.test(text)) {
    return parseWritingSeries(text, metadata);
  }
  if (metadata.sectionType === "read" && /PR.FUNGSHEFT\s+\d+\s*\|/i.test(text)) {
    return parseReadingSeries(text, metadata);
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
  let provider = detectProvider(text);
  if (provider === "custom" && /(?:^|\n)(?:SUJET|Sujet)\s+0?\d{1,2}\s*\/\s*20\b/i.test(text) && /\btelc\b/i.test(text)) {
    provider = "telc";
  }
  if (provider === "custom" && /(?:^|\n)SUJET\s+0?\d{1,2}\b/i.test(text)) provider = "osd";
  const level = detectLevel(text);
  const sectionType = detectSectionType(text);
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
  ensureDocumentImportSchema,
  getExamImportDraft,
  importParsedExamDocument,
  publishExamImportDraft,
  saveExamImportDraft,
  summarizeOutline,
  updateExamImportDraft,
  validateImportDraftContent,
};
