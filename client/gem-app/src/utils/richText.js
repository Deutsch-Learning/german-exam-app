const TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;
const SAFE_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
const SAFE_FONT_SIZE_PATTERN = /^(\d+(?:\.\d+)?(?:px|rem|em|%)|small|medium|large|x-large|xx-large)$/i;
const SAFE_FONT_FAMILIES = new Set(["arial", "georgia", "times new roman", "verdana", "tahoma", "courier new"]);
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "P", "BR", "UL", "OL", "LI", "SPAN", "FONT"]);

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
  const fontFamily = getSafeFontFamily(element);
  const fontSize = getSafeFontSize(element);
  if (color) styles.push(`color: ${color}`);
  if (fontFamily) styles.push(`font-family: ${fontFamily}`);
  if (fontSize) styles.push(`font-size: ${fontSize}`);
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

  return `<${tagName.toLowerCase()}>${children}</${tagName.toLowerCase()}>`;
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
