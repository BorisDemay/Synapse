/** Windows returns extended-length paths (`\\?\C:\…`, `\\?\UNC\server\…`).
 * The prefix means nothing to a reader: show the path as Explorer would. */
export function displayLocalPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  if (path.startsWith("\\\\?\\")) return path.slice(4);
  return path;
}
