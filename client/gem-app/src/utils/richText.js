const TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;
const SAFE_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
const SAFE_FONT_SIZE_PATTERN = /^(\d+(?:\.\d+)?(?:px|rem|em|%)|small|medium|large|x-large|xx-large)$/i;
const SAFE_LENGTH_PATTERN = /^(\d+(?:\.\d+)?(?:px|rem|em|%)|0)$/i;
const SAFE_LINE_HEIGHT_PATTERN = /^(\d+(?:\.\d+)?|normal|\d+(?:\.\d+)?(?:px|rem|em|%))$/i;
const SAFE_FONT_FAMILIES = new Set(["arial", "georgia", "times new roman", "verdana", "tahoma", "courier new"]);
const SAFE_TEXT_ALIGNMENTS = new Set(["left", "center", "right", "justify"]);
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "P", "DIV", "BR", "UL", "OL", "LI", "SPAN", "FONT"]);

export const hasRichTextMarkup = (value) => TAG_PATTERN.test(String(value ?? ""));

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const textToHtml = (value) =>
  escapeHtml(value)
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, "<br>"))
    .map((block) => `<p>${block}</p>`)
    .join("");

const getSafeColor = (element) => {
  const inlineColor = element.style?.color || element.getAttribute?.("color") || "";
  const color = String(inlineColor).trim();
  return SAFE_COLOR_PATTERN.test(color) ? color : "";
};

const getSafeBackgroundColor = (element) => {
  const color = String(element.style?.backgroundColor || "").trim();
  return SAFE_COLOR_PATTERN.test(color) ? color : "";
};

const getSafeFontFamily = (element) => {
  const rawFamily = element.style?.fontFamily || element.getAttribute?.("face") || "";
  const family = String(rawFamily).split(",")[0].replace(/['"]/g, "").trim();
  return SAFE_FONT_FAMILIES.has(family.toLowerCase()) ? family : "";
};

const getSafeFontSize = (element) => {
  const rawSize = element.style?.fontSize || element.getAttribute?.("size") || "";
  const sizeMap = {
    1: "0.82rem",
    2: "0.92rem",
    3: "1rem",
    4: "1.14rem",
    5: "1.32rem",
    6: "1.52rem",
    7: "1.75rem",
  };
  const size = String(rawSize).trim();
  if (sizeMap[size]) return sizeMap[size];
  return SAFE_FONT_SIZE_PATTERN.test(size) ? size : "";
};

const getSafeStyle = (element) => {
  const styles = [];
  const color = getSafeColor(element);
  const backgroundColor = getSafeBackgroundColor(element);
  const fontFamily = getSafeFontFamily(element);
  const fontSize = getSafeFontSize(element);
  const textAlign = String(element.style?.textAlign || "").trim().toLowerCase();
  const lineHeight = String(element.style?.lineHeight || "").trim();
  const marginBottom = String(element.style?.marginBottom || "").trim();
  const paddingLeft = String(element.style?.paddingLeft || "").trim();
  const textDecoration = String(element.style?.textDecoration || "").trim().toLowerCase();
  if (color) styles.push(`color: ${color}`);
  if (backgroundColor) styles.push(`background-color: ${backgroundColor}`);
  if (fontFamily) styles.push(`font-family: ${fontFamily}`);
  if (fontSize) styles.push(`font-size: ${fontSize}`);
  if (SAFE_TEXT_ALIGNMENTS.has(textAlign)) styles.push(`text-align: ${textAlign}`);
  if (SAFE_LINE_HEIGHT_PATTERN.test(lineHeight)) styles.push(`line-height: ${lineHeight}`);
  if (SAFE_LENGTH_PATTERN.test(marginBottom)) styles.push(`margin-bottom: ${marginBottom}`);
  if (SAFE_LENGTH_PATTERN.test(paddingLeft)) styles.push(`padding-left: ${paddingLeft}`);
  if (textDecoration.includes("underline")) styles.push("text-decoration: underline");
  return styles.length ? ` style="${styles.join("; ")}"` : "";
};

const sanitizeNode = (node) => {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tagName = node.tagName.toUpperCase();
  const children = Array.from(node.childNodes).map(sanitizeNode).join("");
  if (!ALLOWED_TAGS.has(tagName)) return children;
  if (tagName === "FONT") {
    const style = getSafeStyle(node);
    return style ? `<span${style}>${children}</span>` : children;
  }
  if (tagName === "SPAN") {
    const style = getSafeStyle(node);
    return style ? `<span${style}>${children}</span>` : children;
  }
  if (tagName === "BR") return "<br>";
  if (tagName === "DIV") {
    const style = getSafeStyle(node);
    return `<p${style}>${children}</p>`;
  }

  const style = getSafeStyle(node);
  return `<${tagName.toLowerCase()}${style}>${children}</${tagName.toLowerCase()}>`;
};

export const sanitizeRichTextHtml = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!hasRichTextMarkup(raw)) return textToHtml(raw);
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return textToHtml(raw.replace(/<[^>]*>/g, ""));
  }

  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
  return Array.from(doc.body.firstElementChild?.childNodes ?? []).map(sanitizeNode).join("");
};

export const richTextToPlainText = (value) => {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(sanitizeRichTextHtml(raw), "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
};
