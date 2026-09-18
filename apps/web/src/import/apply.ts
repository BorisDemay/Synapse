import type { MarkdownImportPlan } from "./markdown-folder";

export interface MarkdownImportTarget {
  findNoteId(path: string): string | undefined;
  saveAttachment(
    attachment: MarkdownImportPlan["attachments"][number],
  ): Promise<void>;
  saveNote(
    note: MarkdownImportPlan["notes"][number],
    existingId?: string,
  ): Promise<void>;
}

export interface ImportProgress {
  completed: number;
  total: number;
}

/**
 * Writes a confirmed local plan one encrypted item at a time. Cancellation is
 * deliberately cooperative: completed items remain durable and visible.
 */
export async function applyMarkdownImport(
  plan: MarkdownImportPlan,
  target: MarkdownImportTarget,
  options: {
    isCancelled(): boolean;
    onProgress(progress: ImportProgress): void;
  },
): Promise<ImportProgress & { cancelled: boolean }> {
  const total = plan.notes.length + plan.attachments.length;
  let completed = 0;
  const progress = () => ({ completed, total });

  for (const note of plan.notes) {
    if (options.isCancelled()) return { ...progress(), cancelled: true };
    await target.saveNote(note, target.findNoteId(note.path));
    completed += 1;
    options.onProgress(progress());
  }
  for (const attachment of plan.attachments) {
    if (options.isCancelled()) return { ...progress(), cancelled: true };
    await target.saveAttachment(attachment);
    completed += 1;
    options.onProgress(progress());
  }
  return { ...progress(), cancelled: false };
}
