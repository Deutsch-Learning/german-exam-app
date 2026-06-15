const TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;
const SAFE_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
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

const sanitizeNode = (node) => {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tagName = node.tagName.toUpperCase();
  const children = Array.from(node.childNodes).map(sanitizeNode).join("");
  if (!ALLOWED_TAGS.has(tagName)) return children;
  if (tagName === "FONT") {
    const color = getSafeColor(node);
    return color ? `<span style="color: ${color}">${children}</span>` : children;
  }
  if (tagName === "SPAN") {
    const color = getSafeColor(node);
    return color ? `<span style="color: ${color}">${children}</span>` : children;
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
