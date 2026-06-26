const STYLE_BLOCK_TYPES = new Set([
  "exam_intro",
  "section_title",
  "section_instructions",
  "question_prompt",
  "question_explanation",
  "question_transcript",
  "answer_options",
]);

const STYLE_OPTION_KEYS = [
  "fontSize",
  "fontFamily",
  "bold",
  "italic",
  "underline",
  "textColor",
  "backgroundColor",
  "spacing",
  "alignment",
  "lineBreaks",
  "listLayout",
  "blockStyle",
];

const DEFAULT_STYLE_OPTIONS = STYLE_OPTION_KEYS.reduce((acc, key) => ({ ...acc, [key]: true }), {});
const MAX_STYLE_APPLY_BLOCKS = 7000;
const MAX_STYLE_BATCH_BLOCKS = 150;
const SAFE_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
const SAFE_FONT_SIZE_PATTERN = /^(\d+(?:\.\d+)?(?:px|rem|em|%)|small|medium|large|x-large|xx-large)$/i;
const SAFE_LENGTH_PATTERN = /^(\d+(?:\.\d+)?(?:px|rem|em|%)|0)$/i;
const SAFE_LINE_HEIGHT_PATTERN = /^(\d+(?:\.\d+)?|normal|\d+(?:\.\d+)?(?:px|rem|em|%))$/i;
const SAFE_TEXT_ALIGNMENTS = new Set(["left", "center", "right", "justify"]);
const SAFE_FONT_FAMILIES = new Set(["arial", "georgia", "times new roman", "verdana", "tahoma", "courier new"]);

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const decodeBasicEntities = (value) =>
  String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

const htmlToPlainLayout = (value) => {
  const raw = String(value ?? "");
  if (!raw.trim()) return [];
  const text = decodeBasicEntities(
    raw
      .replace(/\r/g, "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/\s*(p|div)\s*>/gi, "\n\n")
      .replace(/<\s*li[^>]*>/gi, "\n")
      .replace(/<\s*\/\s*li\s*>/gi, "")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    )
    .filter((block) => block.length);
};

const plainTextPreview = (value, max = 160) => {
  const text = htmlToPlainLayout(value).flat().join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const safeColor = (value) => {
  const text = String(value ?? "").trim();
  return SAFE_COLOR_PATTERN.test(text) ? text : "";
};

const safeFontFamily = (value) => {
  const text = String(value ?? "").split(",")[0].replace(/['"]/g, "").trim();
  return SAFE_FONT_FAMILIES.has(text.toLowerCase()) ? text : "";
};

const safeFontSize = (value) => {
  const sizeMap = {
    1: "0.82rem",
    2: "0.92rem",
    3: "1rem",
    4: "1.14rem",
    5: "1.32rem",
    6: "1.52rem",
    7: "1.75rem",
  };
  const text = String(value ?? "").trim();
  if (sizeMap[text]) return sizeMap[text];
  return SAFE_FONT_SIZE_PATTERN.test(text) ? text : "";
};

const safeTextAlign = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  return SAFE_TEXT_ALIGNMENTS.has(text) ? text : "";
};

const safeLength = (value) => {
  const text = String(value ?? "").trim();
  return SAFE_LENGTH_PATTERN.test(text) ? text : "";
};

const safeLineHeight = (value) => {
  const text = String(value ?? "").trim();
  return SAFE_LINE_HEIGHT_PATTERN.test(text) ? text : "";
};

const normalizeStyleJson = (styleJson, blockType = "section_instructions") => {
  const source = asObject(styleJson);
  const inline = asObject(source.inline);
  const marks = asObject(source.marks);
  const block = asObject(source.block);
  const layout = asObject(source.layout);
  return {
    version: 1,
    blockType: STYLE_BLOCK_TYPES.has(source.blockType) ? source.blockType : blockType,
    sourcePreview: String(source.sourcePreview ?? "").slice(0, 240),
    inline: {
      color: safeColor(inline.color),
      backgroundColor: safeColor(inline.backgroundColor),
      fontFamily: safeFontFamily(inline.fontFamily),
      fontSize: safeFontSize(inline.fontSize),
    },
    marks: {
      bold: Boolean(marks.bold),
      italic: Boolean(marks.italic),
      underline: Boolean(marks.underline),
    },
    block: {
      textAlign: safeTextAlign(block.textAlign),
      lineHeight: safeLineHeight(block.lineHeight),
      marginBottom: safeLength(block.marginBottom),
      paddingLeft: safeLength(block.paddingLeft),
    },
    layout: {
      listKind: ["ordered", "unordered"].includes(layout.listKind) ? layout.listKind : "",
      paragraphCount: Math.max(0, Math.min(80, Number(layout.paragraphCount) || 0)),
      hasLineBreaks: Boolean(layout.hasLineBreaks),
      sourceWasRich: Boolean(layout.sourceWasRich),
    },
  };
};

const normalizeStyleOptions = (value) => {
  const input = asObject(value);
  const legacyEmphasis = input.emphasis;
  return STYLE_OPTION_KEYS.reduce(
    (acc, key) => ({
      ...acc,
      [key]: input[key] === undefined
        ? ["bold", "italic", "underline"].includes(key) && legacyEmphasis !== undefined
          ? Boolean(legacyEmphasis)
          : DEFAULT_STYLE_OPTIONS[key]
        : Boolean(input[key]),
    }),
    {}
  );
};

const styleAttr = (styles) => {
  const entries = Object.entries(styles).filter(([, value]) => value);
  return entries.length ? ` style="${entries.map(([key, value]) => `${key}: ${escapeHtml(value)}`).join("; ")}"` : "";
};

const applyStyleToText = (value, styleJson, styleOptions) => {
  const style = normalizeStyleJson(styleJson);
  const options = normalizeStyleOptions(styleOptions);
  const blocks = htmlToPlainLayout(value);
  if (!blocks.length) return "";

  const inlineStyles = {};
  const blockStyles = {};
  if (options.textColor && style.inline.color) inlineStyles.color = style.inline.color;
  if (options.backgroundColor && style.inline.backgroundColor) inlineStyles["background-color"] = style.inline.backgroundColor;
  if (options.fontFamily && style.inline.fontFamily) inlineStyles["font-family"] = style.inline.fontFamily;
  if (options.fontSize && style.inline.fontSize) inlineStyles["font-size"] = style.inline.fontSize;
  if (options.underline && style.marks.underline) inlineStyles["text-decoration"] = "underline";
  if (options.alignment && style.block.textAlign) blockStyles["text-align"] = style.block.textAlign;
  if (options.spacing && style.block.lineHeight) blockStyles["line-height"] = style.block.lineHeight;
  if (options.spacing && style.block.marginBottom) blockStyles["margin-bottom"] = style.block.marginBottom;
  if (options.blockStyle && style.block.paddingLeft) blockStyles["padding-left"] = style.block.paddingLeft;

  const wrapMarks = (text) => {
    let output = `<span${styleAttr(inlineStyles)}>${escapeHtml(text)}</span>`;
    if (options.underline && style.marks.underline && !inlineStyles["text-decoration"]) output = `<u>${output}</u>`;
    if (options.italic && style.marks.italic) output = `<em>${output}</em>`;
    if (options.bold && style.marks.bold) output = `<strong>${output}</strong>`;
    return output;
  };

  if (options.listLayout && style.layout.listKind) {
    const tag = style.layout.listKind === "ordered" ? "ol" : "ul";
    const items = blocks.flat().map((line) => `<li${styleAttr(blockStyles)}>${wrapMarks(line)}</li>`).join("");
    return `<${tag}>${items}</${tag}>`;
  }

  return blocks
    .map((block) => {
      if (options.lineBreaks) {
        return `<p${styleAttr(blockStyles)}>${block.map(wrapMarks).join("<br>")}</p>`;
      }
      return `<p${styleAttr(blockStyles)}>${wrapMarks(block.join(" "))}</p>`;
    })
    .join("");
};

const getBlockId = (blockType, id) => `${blockType}:${id}`;

const formatExamLabel = (exam) =>
  [exam.provider || exam.exam_type || "custom", exam.level, exam.series_number ? `Series ${exam.series_number}` : null, exam.section_type]
    .filter(Boolean)
    .join(" / ");

const getOptionText = (options) =>
  Array.isArray(options)
    ? options
        .map((option, index) => `${option?.value ?? String.fromCharCode(97 + index)}) ${option?.label ?? option?.text ?? option?.title ?? ""}`.trim())
        .filter(Boolean)
        .join("\n")
    : "";

const buildBlocksByType = async (pool, blockType) => {
  if (blockType === "exam_intro") {
    const result = await pool.query(`
      SELECT e.id AS exam_id, e.provider, e.exam_type, e.level, e.section_type, e.series_number,
             e.name AS exam_name, e.metadata, e.metadata->>'instructions' AS value
      FROM exams e
      ORDER BY e.provider, e.level, e.series_number, e.id
    `);
    return result.rows.map((row) => ({
      blockId: getBlockId(blockType, row.exam_id),
      blockType,
      storageType: "exam_metadata_instructions",
      examId: row.exam_id,
      sectionId: null,
      questionId: null,
      provider: String(row.provider || row.exam_type || "").toLowerCase(),
      level: String(row.level || "").toUpperCase(),
      seriesNumber: row.series_number,
      moduleId: row.section_type,
      label: `${formatExamLabel(row)} - Website intro`,
      currentValue: row.value || "",
      storageValue: asObject(row.metadata),
    }));
  }

  if (blockType === "section_title" || blockType === "section_instructions") {
    const result = await pool.query(`
      SELECT s.*, e.provider, e.exam_type, e.level, e.series_number, e.section_type AS exam_section_type,
             e.name AS exam_name
      FROM exam_sections s
      JOIN exams e ON e.id = s.exam_id
      ORDER BY e.provider, e.level, e.series_number, s.position, s.id
    `);
    return result.rows.map((row) => ({
      blockId: getBlockId(blockType, row.id),
      blockType,
      storageType: blockType,
      examId: row.exam_id,
      sectionId: row.id,
      questionId: null,
      provider: String(row.provider || row.exam_type || "").toLowerCase(),
      level: String(row.level || "").toUpperCase(),
      seriesNumber: row.series_number,
      moduleId: row.section_type || row.exam_section_type,
      label: `${formatExamLabel(row)} - Teil ${row.part_number || row.position || row.id} ${blockType === "section_title" ? "title" : "instructions"}`,
      currentValue: blockType === "section_title" ? row.title || "" : row.instructions || "",
      storageValue: blockType === "section_title" ? row.title || "" : row.instructions || "",
    }));
  }

  const questionField = {
    question_prompt: "prompt",
    question_explanation: "explanation",
    question_transcript: "transcript",
  }[blockType];

  if (questionField || blockType === "answer_options") {
    const result = await pool.query(`
      SELECT q.*, s.title AS section_title, s.part_number, s.position AS section_position,
             e.provider, e.exam_type, e.level, e.series_number, e.section_type AS exam_section_type,
             e.name AS exam_name
      FROM exam_questions q
      JOIN exams e ON e.id = q.exam_id
      LEFT JOIN exam_sections s ON s.id = q.section_id
      ORDER BY e.provider, e.level, e.series_number, COALESCE(s.position, 0), q.position, q.id
    `);
    return result.rows.map((row) => ({
      blockId: getBlockId(blockType, row.id),
      blockType,
      storageType: blockType,
      examId: row.exam_id,
      sectionId: row.section_id,
      questionId: row.id,
      provider: String(row.provider || row.exam_type || "").toLowerCase(),
      level: String(row.level || "").toUpperCase(),
      seriesNumber: row.series_number,
      moduleId: row.module_id || row.exam_section_type,
      label: `${formatExamLabel(row)} - ${row.section_title ? `Teil ${row.part_number || row.section_position}: ` : ""}Task ${row.position || row.id} ${blockType.replace(/^question_/, "")}`,
      currentValue: blockType === "answer_options" ? getOptionText(row.options) : row[questionField] || "",
      storageValue: blockType === "answer_options" ? asObject(row.source_metadata) : row[questionField] || "",
    }));
  }

  return [];
};

const parseManualBlockId = (value) => {
  const [blockType, id] = String(value ?? "").split(":");
  return STYLE_BLOCK_TYPES.has(blockType) && id ? `${blockType}:${id}` : "";
};

const resolveBlocks = async (pool, payload) => {
  const sourceBlock = asObject(payload.sourceBlock);
  const sourceType = String(sourceBlock.blockType || sourceBlock.type || "").trim();
  if (!STYLE_BLOCK_TYPES.has(sourceType)) throw new Error("Invalid source block type");

  const scope = String(payload.scope || "block");
  const allowCrossType = Boolean(payload.allowCrossType);
  const manualIds = new Set((Array.isArray(payload.manualBlockIds) ? payload.manualBlockIds : []).map(parseManualBlockId).filter(Boolean));
  const candidateTypes = scope === "manual" && allowCrossType
    ? [...STYLE_BLOCK_TYPES]
    : [sourceType];
  const allBlocks = (await Promise.all(candidateTypes.map((type) => buildBlocksByType(pool, type)))).flat();
  const sourceId = sourceBlock.blockId || getBlockId(sourceType, sourceBlock.questionId || sourceBlock.sectionId || sourceBlock.examId);
  const source = allBlocks.find((block) => block.blockId === sourceId)
    || allBlocks.find((block) =>
      (sourceBlock.questionId && Number(block.questionId) === Number(sourceBlock.questionId)) ||
      (sourceBlock.sectionId && Number(block.sectionId) === Number(sourceBlock.sectionId)) ||
      (sourceBlock.examId && Number(block.examId) === Number(sourceBlock.examId))
    );
  if (!source) throw new Error("Source block was not found");

  const filtered = allBlocks.filter((block) => {
    if (scope === "manual") return manualIds.has(block.blockId) && (allowCrossType || block.blockType === source.blockType);
    if (block.blockType !== source.blockType) return false;
    if (scope === "block") return block.blockId === source.blockId;
    if (scope === "task") {
      if (source.questionId) return block.questionId && Number(block.questionId) === Number(source.questionId);
      if (source.sectionId) return block.sectionId && Number(block.sectionId) === Number(source.sectionId);
      return Number(block.examId) === Number(source.examId);
    }
    if (scope === "section") {
      if (source.sectionId) return block.sectionId && Number(block.sectionId) === Number(source.sectionId);
      return Number(block.examId) === Number(source.examId);
    }
    if (scope === "series") return Number(block.examId) === Number(source.examId);
    if (scope === "level") return block.provider === source.provider && block.level === source.level;
    if (scope === "body") return block.provider === source.provider;
    return block.blockId === source.blockId;
  });

  return { source, blocks: filtered };
};

const buildPreviewBlocks = (blocks, styleJson, styleOptions) =>
  blocks.map((block) => ({
    blockId: block.blockId,
    blockType: block.blockType,
    examId: block.examId,
    sectionId: block.sectionId,
    questionId: block.questionId,
    label: block.label,
    currentPreview: plainTextPreview(block.currentValue),
    currentValue: block.currentValue,
    nextValue: applyStyleToText(block.currentValue, styleJson, styleOptions),
  }));

const compactBlock = (block) => ({
  blockId: block.blockId,
  blockType: block.blockType,
  examId: block.examId,
  sectionId: block.sectionId,
  questionId: block.questionId,
  label: block.label,
});

const updateBlock = async (client, block, nextValue, styleJson) => {
  if (block.blockType === "exam_intro") {
    const metadata = {
      ...asObject(block.storageValue),
      instructions: nextValue,
    };
    await client.query(`UPDATE exams SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2`, [
      JSON.stringify(metadata),
      block.examId,
    ]);
    return { previousStorageValue: block.storageValue, nextStorageValue: metadata };
  }

  if (block.blockType === "section_title") {
    await client.query(`UPDATE exam_sections SET title = $1, updated_at = NOW() WHERE id = $2`, [nextValue, block.sectionId]);
    return { previousStorageValue: block.storageValue, nextStorageValue: nextValue };
  }

  if (block.blockType === "section_instructions") {
    await client.query(`UPDATE exam_sections SET instructions = $1, updated_at = NOW() WHERE id = $2`, [nextValue, block.sectionId]);
    return { previousStorageValue: block.storageValue, nextStorageValue: nextValue };
  }

  if (block.blockType === "answer_options") {
    const metadata = {
      ...asObject(block.storageValue),
      contentStyle: {
        ...asObject(asObject(block.storageValue).contentStyle),
        answerOptions: normalizeStyleJson(styleJson, "answer_options"),
      },
    };
    await client.query(`UPDATE exam_questions SET source_metadata = $1::jsonb, updated_at = NOW() WHERE id = $2`, [
      JSON.stringify(metadata),
      block.questionId,
    ]);
    return { previousStorageValue: block.storageValue, nextStorageValue: metadata };
  }

  const column = {
    question_prompt: "prompt",
    question_explanation: "explanation",
    question_transcript: "transcript",
  }[block.blockType];
  if (!column) throw new Error(`Unsupported block type: ${block.blockType}`);
  await client.query(`UPDATE exam_questions SET ${column} = $1, updated_at = NOW() WHERE id = $2`, [nextValue, block.questionId]);
  return { previousStorageValue: block.storageValue, nextStorageValue: nextValue };
};

const restoreBlock = async (client, item) => {
  const blockType = item.blockType;
  const value = item.previousStorageValue;
  if (blockType === "exam_intro") {
    await client.query(`UPDATE exams SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(asObject(value)), item.examId]);
    return;
  }
  if (blockType === "section_title") {
    await client.query(`UPDATE exam_sections SET title = $1, updated_at = NOW() WHERE id = $2`, [String(value ?? ""), item.sectionId]);
    return;
  }
  if (blockType === "section_instructions") {
    await client.query(`UPDATE exam_sections SET instructions = $1, updated_at = NOW() WHERE id = $2`, [String(value ?? ""), item.sectionId]);
    return;
  }
  if (blockType === "answer_options") {
    await client.query(`UPDATE exam_questions SET source_metadata = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(asObject(value)), item.questionId]);
    return;
  }
  const column = {
    question_prompt: "prompt",
    question_explanation: "explanation",
    question_transcript: "transcript",
  }[blockType];
  if (column) {
    await client.query(`UPDATE exam_questions SET ${column} = $1, updated_at = NOW() WHERE id = $2`, [String(value ?? ""), item.questionId]);
  }
};

const ensureContentStyleSchema = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_style_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      block_type TEXT NOT NULL,
      style_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE content_style_templates ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_style_templates_active_idx
      ON content_style_templates(block_type, is_active, updated_at DESC);
  `);
};

const registerContentStyleRoutes = ({ app, pool, requireAdmin, auditAdminAction }) => {
  app.get("/api/admin/style-templates", requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, name, description, block_type, style_json, created_by, is_active, created_at, updated_at
        FROM content_style_templates
        WHERE is_active = TRUE
        ORDER BY updated_at DESC, id DESC
      `);
      return res.json({ ok: true, templates: result.rows });
    } catch (err) {
      console.error("Style templates lookup failed", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  app.post("/api/admin/style-templates", requireAdmin, async (req, res) => {
    try {
      const name = String(req.body?.name ?? "").trim().slice(0, 120);
      const description = String(req.body?.description ?? "").trim().slice(0, 500) || null;
      const blockType = String(req.body?.blockType ?? req.body?.block_type ?? "").trim();
      if (!name) return res.status(400).json({ ok: false, error: "Template name is required" });
      if (!STYLE_BLOCK_TYPES.has(blockType)) return res.status(400).json({ ok: false, error: "Invalid block type" });
      const styleJson = normalizeStyleJson(req.body?.styleJson ?? req.body?.style_json, blockType);
      const inserted = await pool.query(
        `INSERT INTO content_style_templates (name, description, block_type, style_json, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING *`,
        [name, description, blockType, JSON.stringify(styleJson), req.user.id]
      );
      await auditAdminAction(req, "style.template_create", "content_style_template", inserted.rows[0].id, {
        blockType,
        name,
      });
      return res.status(201).json({ ok: true, template: inserted.rows[0] });
    } catch (err) {
      console.error("Style template create failed", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  app.put("/api/admin/style-templates/:id", requireAdmin, async (req, res) => {
    try {
      const templateId = Number(req.params.id);
      const blockType = String(req.body?.blockType ?? req.body?.block_type ?? "").trim();
      if (blockType && !STYLE_BLOCK_TYPES.has(blockType)) return res.status(400).json({ ok: false, error: "Invalid block type" });
      const styleJson = req.body?.styleJson || req.body?.style_json
        ? normalizeStyleJson(req.body?.styleJson ?? req.body?.style_json, blockType || "section_instructions")
        : undefined;
      const updated = await pool.query(
        `UPDATE content_style_templates
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             block_type = COALESCE($3, block_type),
             style_json = COALESCE($4::jsonb, style_json),
             updated_at = NOW()
         WHERE id = $5 AND is_active = TRUE
         RETURNING *`,
        [
          req.body?.name ? String(req.body.name).trim().slice(0, 120) : null,
          req.body?.description === undefined ? null : String(req.body.description ?? "").trim().slice(0, 500),
          blockType || null,
          styleJson ? JSON.stringify(styleJson) : null,
          templateId,
        ]
      );
      if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Template not found" });
      await auditAdminAction(req, "style.template_update", "content_style_template", templateId, { blockType });
      return res.json({ ok: true, template: updated.rows[0] });
    } catch (err) {
      console.error("Style template update failed", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  app.delete("/api/admin/style-templates/:id", requireAdmin, async (req, res) => {
    try {
      const templateId = Number(req.params.id);
      const updated = await pool.query(
        `UPDATE content_style_templates SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [templateId]
      );
      if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Template not found" });
      await auditAdminAction(req, "style.template_archive", "content_style_template", templateId, {});
      return res.json({ ok: true, template: updated.rows[0] });
    } catch (err) {
      console.error("Style template archive failed", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  app.post("/api/admin/style-templates/preview", requireAdmin, async (req, res) => {
    try {
      const styleJson = normalizeStyleJson(req.body?.styleJson ?? req.body?.style_json, req.body?.sourceBlock?.blockType);
      const styleOptions = normalizeStyleOptions(req.body?.styleOptions ?? req.body?.style_options);
      const { source, blocks } = await resolveBlocks(pool, req.body ?? {});
      if (blocks.length > MAX_STYLE_APPLY_BLOCKS) {
        return res.status(400).json({
          ok: false,
          error: `Too many blocks selected. The maximum is ${MAX_STYLE_APPLY_BLOCKS}. Narrow the scope first.`,
        });
      }
      const previewBlocks = blocks.slice(0, 50);
      const previews = buildPreviewBlocks(previewBlocks, styleJson, styleOptions);
      return res.json({
        ok: true,
        source: compactBlock(source),
        count: blocks.length,
        blockIds: blocks.map((block) => block.blockId),
        blocks: previews,
        styleJson,
        styleOptions,
      });
    } catch (err) {
      console.error("Style apply preview failed", err);
      return res.status(400).json({ ok: false, error: err.message || "Preview failed" });
    }
  });

  app.post("/api/admin/style-templates/apply", requireAdmin, async (req, res) => {
    if (!req.body?.confirmed) {
      return res.status(400).json({ ok: false, error: "Bulk style apply must be confirmed" });
    }
    let client;
    try {
      const styleJson = normalizeStyleJson(req.body?.styleJson ?? req.body?.style_json, req.body?.sourceBlock?.blockType);
      const styleOptions = normalizeStyleOptions(req.body?.styleOptions ?? req.body?.style_options);
      const { source, blocks } = await resolveBlocks(pool, req.body ?? {});
      if (!blocks.length) return res.status(400).json({ ok: false, error: "No compatible blocks found" });
      if (blocks.length > MAX_STYLE_BATCH_BLOCKS) return res.status(400).json({ ok: false, error: "Too many blocks in one batch. Apply in smaller batches." });

      const undoBlocks = [];
      const affectedBlocks = [];
      client = await pool.connect();
      await client.query("BEGIN");
      for (const block of blocks) {
        const nextValue = applyStyleToText(block.currentValue, styleJson, styleOptions);
        const update = await updateBlock(client, block, nextValue, styleJson);
        const compact = compactBlock(block);
        affectedBlocks.push(compact);
        undoBlocks.push({
          ...compact,
          previousStorageValue: update.previousStorageValue,
        });
      }

      const touchedExamIds = [...new Set(affectedBlocks.map((block) => block.examId).filter(Boolean))];
      for (const examId of touchedExamIds) {
        await client.query(`UPDATE exams SET updated_at = NOW() WHERE id = $1`, [examId]);
      }
      await client.query("COMMIT");

      const audit = await auditAdminAction(req, "style.apply", "content_style", source.blockId, {
        sourceBlock: compactBlock(source),
        scope: req.body?.scope || "block",
        batchId: req.body?.batchId || null,
        batchIndex: Number(req.body?.batchIndex) || null,
        batchTotal: Number(req.body?.batchTotal) || null,
        styleOptions,
        styleJson,
        affectedBlocks: undoBlocks,
        affectedBlockSummary: affectedBlocks,
      });
      return res.json({ ok: true, count: affectedBlocks.length, auditId: audit?.id ?? null, affectedBlocks });
    } catch (err) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      console.error("Style apply failed", err);
      return res.status(400).json({ ok: false, error: err.message || "Style apply failed" });
    } finally {
      if (client) client.release();
    }
  });

  app.post("/api/admin/style-templates/undo-last", requireAdmin, async (req, res) => {
    let client;
    try {
      const result = await pool.query(
        `SELECT id, metadata
         FROM admin_audit_logs
         WHERE action = 'style.apply'
           AND ($1::int IS NULL OR admin_user_id = $1)
         ORDER BY created_at DESC
         LIMIT 1`,
        [req.user?.id ?? null]
      );
      const audit = result.rows[0];
      if (!audit) {
        return res.status(404).json({ ok: false, error: "No style apply action available to undo" });
      }
      const batchId = audit.metadata?.batchId;
      const audits = batchId
        ? (await pool.query(
            `SELECT id, metadata
             FROM admin_audit_logs
             WHERE action = 'style.apply'
               AND metadata->>'batchId' = $1
               AND ($2::int IS NULL OR admin_user_id = $2)
             ORDER BY COALESCE((metadata->>'batchIndex')::int, 0) DESC, created_at DESC`,
            [String(batchId), req.user?.id ?? null]
          )).rows
        : [audit];
      const affectedBlocks = audits.flatMap((item) =>
        Array.isArray(item?.metadata?.affectedBlocks) ? item.metadata.affectedBlocks : []
      );
      if (!affectedBlocks.length) {
        return res.status(404).json({ ok: false, error: "No style apply action available to undo" });
      }

      client = await pool.connect();
      await client.query("BEGIN");
      for (const item of affectedBlocks) {
        await restoreBlock(client, item);
      }
      const touchedExamIds = [...new Set(affectedBlocks.map((block) => block.examId).filter(Boolean))];
      for (const examId of touchedExamIds) {
        await client.query(`UPDATE exams SET updated_at = NOW() WHERE id = $1`, [examId]);
      }
      await client.query("COMMIT");

      await auditAdminAction(req, "style.undo", "content_style", audit.id, {
        undoneAuditId: audit.id,
        affectedBlocks: affectedBlocks.map((block) => ({
          blockId: block.blockId,
          blockType: block.blockType,
          examId: block.examId,
          sectionId: block.sectionId,
          questionId: block.questionId,
          label: block.label,
        })),
      });
      return res.json({ ok: true, count: affectedBlocks.length, undoneAuditId: audit.id });
    } catch (err) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      console.error("Style undo failed", err);
      return res.status(400).json({ ok: false, error: err.message || "Style undo failed" });
    } finally {
      if (client) client.release();
    }
  });
};

module.exports = {
  ensureContentStyleSchema,
  registerContentStyleRoutes,
};
