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
    ["telc", ["telc"]],
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
    ["write", ["schreiben", "schriftliche kommunikation", "expression écrite", "expression ecrite", "private e-mail", "diskussionsbeitrag", "musterloesung teil", "musterlösung teil"]],
    ["speak", ["sprechen", "mündliche kommunikation", "mundliche kommunikation", "mündliche prüfung", "mundliche pruefung", "gelenktes gespräch", "gelenktes gesprach", "selbständige äußerung", "selbstandige ausserung", "kandidat a", "gemeinsam planen"]],
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
  const hasEclSujets = /(?:^|\n)Sujet\s+0?\d{1,2}\s+[-–—]/i.test(text);
  const hasEclCombinations = /(?:^|\n)Kombination\s+0?\d{1,2}\s+[-–—]/i.test(text);
  if ((provider === "ecl" || hasEclSujets) && metadata.sectionType === "read") {
    const series = parseEclReadingSeries(text, metadata);
    if (series.length) return series;
  }
  if ((provider === "ecl" || hasEclSujets) && metadata.sectionType === "write") {
    const series = parseEclWritingSeries(text, metadata);
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

const analyzeExamDocument = async ({ buffer, filename, mimetype }) => {
  if (!buffer?.length) throw new Error("Document buffer is empty");
  const { text, extraction } = await extractDocumentText({ buffer, filename, mimetype });
  let provider = detectProvider(text);
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
      imported_exam_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_document_imports_created_idx
      ON exam_document_imports(created_at DESC);
  `);
  await pool.query(`ALTER TABLE exam_document_imports ENABLE ROW LEVEL SECURITY;`);
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
      points INTEGER,
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
  await pool.query(`ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES exam_sections(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_type TEXT;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS transcript TEXT;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS audio JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS scoring JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
};

const summarizeOutline = (parsed) => ({
  title: parsed.metadata.title,
  rawTextPreview: parsed.rawTextPreview,
  series: parsed.series.map((series) => ({
    seriesNumber: series.seriesNumber,
    title: series.title,
    sourceLabel: series.sourceLabel,
    sectionCount: series.sections.length,
    questionCount: series.sections.reduce((sum, section) => sum + section.questions.length, 0),
    sections: series.sections.map((section) => ({
      partNumber: section.partNumber,
      title: section.title,
      sectionType: section.sectionType,
      questionCount: section.questions.length,
      durationMinutes: section.durationMinutes,
      points: section.points,
    })),
  })),
});

const importParsedExamDocument = async ({ pool, parsed, adminId = null }) => {
  await ensureDocumentImportSchema(pool);
  const existing = await pool.query(
    `SELECT * FROM exam_document_imports WHERE document_hash = $1 LIMIT 1`,
    [parsed.documentHash]
  );
  if (existing.rows[0]) {
    return {
      duplicate: true,
      import: existing.rows[0],
      exams: [],
      parsed,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insertedImport = await client.query(
      `INSERT INTO exam_document_imports (
         document_hash, filename, mime_type, size_bytes, provider, exam_type, level, section_type,
         total_series, total_sections, total_questions, extraction_method, validation_warnings,
         raw_outline, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)
       RETURNING *`,
      [
        parsed.documentHash,
        parsed.filename,
        parsed.mimetype || null,
        parsed.sizeBytes,
        parsed.metadata.provider,
        parsed.metadata.examType,
        parsed.metadata.level,
        parsed.metadata.sectionType,
        parsed.series.length,
        parsed.validation.sectionCount,
        parsed.validation.questionCount,
        parsed.extraction.method,
        JSON.stringify(parsed.validation.warnings),
        JSON.stringify(summarizeOutline(parsed)),
        adminId,
      ]
    );
    const importRow = insertedImport.rows[0];
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
            parser: "documentImport.v1",
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
        for (const [questionIndex, question] of section.questions.entries()) {
          await client.query(
            `INSERT INTO exam_questions (
               exam_id, section_id, module_id, prompt, options, correct_answer, explanation,
               position, question_type, transcript, audio, scoring, source_metadata
             )
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)`,
            [
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
              }),
            ]
          );
        }
      }
    }

    await client.query(
      `UPDATE exam_document_imports
       SET imported_exam_ids = $1::jsonb
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(importedExams.map((exam) => exam.id)), importRow.id]
    );
    await client.query("COMMIT");

    return {
      duplicate: false,
      import: {
        ...importRow,
        imported_exam_ids: importedExams.map((exam) => exam.id),
      },
      exams: importedExams,
      parsed,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  analyzeExamDocument,
  ensureDocumentImportSchema,
  importParsedExamDocument,
  summarizeOutline,
};
