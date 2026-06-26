import { hasRichTextMarkup, richTextToPlainText, sanitizeRichTextHtml } from "./richText";

export const STYLE_BLOCK_TYPES = [
  { id: "exam_intro", label: "Website intro", compatibleLabel: "other website intros" },
  { id: "section_title", label: "Section/task title", compatibleLabel: "other section/task titles" },
  { id: "section_instructions", label: "Instructions / reading text", compatibleLabel: "other instruction blocks" },
  { id: "question_prompt", label: "Question / prompt", compatibleLabel: "other prompts" },
  { id: "question_explanation", label: "Explanation", compatibleLabel: "other explanations" },
  { id: "question_transcript", label: "Hoeren transcript", compatibleLabel: "other transcripts" },
  { id: "answer_options", label: "Answer options layout", compatibleLabel: "other answer option lists" },
];

export const STYLE_SCOPE_OPTIONS = [
  { id: "block", label: "Only this block" },
  { id: "task", label: "Similar blocks in this task" },
  { id: "section", label: "Similar blocks in this section" },
  { id: "series", label: "Similar blocks in this series" },
  { id: "level", label: "Similar blocks in this exam level" },
  { id: "body", label: "Similar blocks in this exam body" },
  { id: "manual", label: "Manually selected blocks" },
];

export const STYLE_PROPERTY_OPTIONS = [
  { id: "fontSize", label: "Font size" },
  { id: "fontFamily", label: "Font family" },
  { id: "bold", label: "Bold" },
  { id: "italic", label: "Italic" },
  { id: "underline", label: "Underline" },
  { id: "textColor", label: "Text color" },
  { id: "backgroundColor", label: "Background color" },
  { id: "spacing", label: "Spacing" },
  { id: "alignment", label: "Alignment" },
  { id: "lineBreaks", label: "Line breaks / paragraphs" },
  { id: "listLayout", label: "List / answer layout" },
  { id: "blockStyle", label: "Block style" },
];

export const DEFAULT_STYLE_OPTIONS = STYLE_PROPERTY_OPTIONS.reduce(
  (acc, item) => ({ ...acc, [item.id]: true }),
  {}
);

const firstNonEmpty = (...values) =>
  values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";

const readElementStyle = (element) => {
  if (!element) return {};
  const style = element.style ?? {};
  return {
    color: firstNonEmpty(style.color, element.getAttribute?.("color")),
    backgroundColor: firstNonEmpty(style.backgroundColor),
    fontFamily: firstNonEmpty(style.fontFamily, element.getAttribute?.("face")).replace(/['"]/g, ""),
    fontSize: firstNonEmpty(style.fontSize, element.getAttribute?.("size")),
    textAlign: firstNonEmpty(style.textAlign),
    lineHeight: firstNonEmpty(style.lineHeight),
    marginBottom: firstNonEmpty(style.marginBottom),
    paddingLeft: firstNonEmpty(style.paddingLeft),
    textDecoration: firstNonEmpty(style.textDecoration),
  };
};

const findFirstStyleValue = (root, property) => {
  const elements = Array.from(root.querySelectorAll("*"));
  for (const element of elements) {
    const value = readElementStyle(element)[property];
    if (value) return value;
  }
  return "";
};

const normalizeFontSize = (value) => {
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
  return sizeMap[text] ?? text;
};

const getMark = (root, selector, styleCheck) =>
  Boolean(root.querySelector(selector)) ||
  Array.from(root.querySelectorAll("*")).some((element) => styleCheck(readElementStyle(element), element));

export const getStyleBlockTypeLabel = (blockType) =>
  STYLE_BLOCK_TYPES.find((item) => item.id === blockType)?.label ?? blockType;

export const extractContentStyleTemplate = (value, blockType = "section_instructions") => {
  const safeHtml = sanitizeRichTextHtml(value);
  const plain = richTextToPlainText(safeHtml);
  const html = safeHtml || sanitizeRichTextHtml(plain);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  const firstBlock = root.querySelector("p, ul, ol, li") ?? root.firstElementChild;
  const firstInline = root.querySelector("span, font, strong, b, em, i, u") ?? firstBlock;
  const blockStyle = readElementStyle(firstBlock);
  const inlineStyle = readElementStyle(firstInline);
  const list = root.querySelector("ul, ol");
  const paragraphs = Array.from(root.querySelectorAll("p, li")).length || (plain ? 1 : 0);

  return {
    version: 1,
    blockType,
    sourcePreview: plain.slice(0, 220),
    inline: {
      color: firstNonEmpty(inlineStyle.color, findFirstStyleValue(root, "color")),
      backgroundColor: firstNonEmpty(inlineStyle.backgroundColor, findFirstStyleValue(root, "backgroundColor")),
      fontFamily: firstNonEmpty(inlineStyle.fontFamily, findFirstStyleValue(root, "fontFamily")),
      fontSize: normalizeFontSize(firstNonEmpty(inlineStyle.fontSize, findFirstStyleValue(root, "fontSize"))),
    },
    marks: {
      bold: getMark(root, "strong, b", (_style, element) => Number(element.style?.fontWeight) >= 600 || element.style?.fontWeight === "bold"),
      italic: getMark(root, "em, i", (_style, element) => element.style?.fontStyle === "italic"),
      underline: getMark(root, "u", (style) => String(style.textDecoration).includes("underline")),
    },
    block: {
      textAlign: firstNonEmpty(blockStyle.textAlign, findFirstStyleValue(root, "textAlign")),
      lineHeight: firstNonEmpty(blockStyle.lineHeight, findFirstStyleValue(root, "lineHeight")),
      marginBottom: firstNonEmpty(blockStyle.marginBottom, findFirstStyleValue(root, "marginBottom")),
      paddingLeft: firstNonEmpty(blockStyle.paddingLeft, findFirstStyleValue(root, "paddingLeft")),
    },
    layout: {
      listKind: list?.tagName?.toLowerCase() === "ol" ? "ordered" : list?.tagName?.toLowerCase() === "ul" ? "unordered" : "",
      paragraphCount: paragraphs,
      hasLineBreaks: html.includes("<br>") || paragraphs > 1 || /\n/.test(String(value ?? "")),
      sourceWasRich: hasRichTextMarkup(value),
    },
  };
};

export const describeStyleTemplate = (styleJson) => {
  const style = styleJson && typeof styleJson === "object" ? styleJson : {};
  const parts = [];
  if (style.inline?.fontFamily) parts.push(style.inline.fontFamily);
  if (style.inline?.fontSize) parts.push(style.inline.fontSize);
  if (style.inline?.color) parts.push(`text ${style.inline.color}`);
  if (style.inline?.backgroundColor) parts.push(`background ${style.inline.backgroundColor}`);
  if (style.marks?.bold) parts.push("bold");
  if (style.marks?.italic) parts.push("italic");
  if (style.marks?.underline) parts.push("underline");
  if (style.block?.textAlign) parts.push(style.block.textAlign);
  if (style.layout?.listKind) parts.push(`${style.layout.listKind} list`);
  return parts.length ? parts.join(" · ") : "Plain style pattern";
};
