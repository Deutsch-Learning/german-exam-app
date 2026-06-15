export const stripQuestionMaterial = (text, tasks = []) => {
  const lines = String(text ?? "")
    .replace(/\r/g, "")
    .replace(/--- PAGE\s+\d+\/\d+\s+---/gi, "")
    .split("\n");
  const taskPrompts = tasks
    .map((task) => String(task?.question ?? task?.prompt ?? "").split("\n")[0].trim())
    .filter((prompt) => prompt.length > 18);
  const cleaned = [];
  let skippingTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!skippingTable) cleaned.push("");
      continue;
    }

    if (/^Anzeigen\s*:/i.test(trimmed)) {
      skippingTable = false;
      cleaned.push(trimmed);
      continue;
    }

    if (/^Nr\.?\s+(Aussage|Situation|Person|Aufgabe|Frage)/i.test(trimmed)) {
      skippingTable = true;
      continue;
    }

    if (skippingTable) continue;
    if (/^\d{1,2}\s+.+\s+(?:n\s+n|___)$/i.test(trimmed)) continue;
    if (/^Aufgabe\s+\d{1,2}\s*:/i.test(trimmed)) continue;
    if (/^n\s+[a-c]\)/i.test(trimmed)) continue;
    if (taskPrompts.some((prompt) => trimmed.includes(prompt) || prompt.includes(trimmed))) continue;

    cleaned.push(line.replace(/\s+$/g, ""));
  }

  const result = cleaned
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return result || String(text ?? "").trim();
};
