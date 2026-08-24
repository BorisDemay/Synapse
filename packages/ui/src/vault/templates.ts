export interface TemplateContext {
  date: Date;
  title: string;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function localDate(value: Date): string {
  return `${value.getFullYear()}-${twoDigits(value.getMonth() + 1)}-${twoDigits(value.getDate())}`;
}

function localTime(value: Date): string {
  return `${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}`;
}

/** Expands only fixed local placeholders; template contents never leave the client. */
export function renderTemplate(
  source: string,
  context: TemplateContext,
): string {
  return source
    .replaceAll("{{date}}", localDate(context.date))
    .replaceAll("{{time}}", localTime(context.date))
    .replaceAll("{{title}}", context.title);
}

export function dailyNotePath(date: Date, pattern: string): string {
  const path = pattern
    .replaceAll("YYYY", String(date.getFullYear()))
    .replaceAll("MM", twoDigits(date.getMonth() + 1))
    .replaceAll("DD", twoDigits(date.getDate()))
    .replaceAll("\\", "/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("..") ||
    path.includes("\0") ||
    !path.toLowerCase().endsWith(".md")
  ) {
    throw new Error("Invalid daily note path");
  }
  return path;
}
