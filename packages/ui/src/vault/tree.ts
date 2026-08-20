import type { VaultTreeNode } from "../components/VaultTree.vue";

export interface TreeSource {
  id: string;
  path: string;
  label: string;
  kind?: "note" | "attachment";
  syncStatus?: VaultTreeNode["syncStatus"];
  tags?: string[];
}

export function buildVaultTree(sources: TreeSource[]): VaultTreeNode[] {
  const root: VaultTreeNode[] = [];

  for (const source of sources) {
    const segments = source.path.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    let level = root;
    for (const [index, segment] of segments.entries()) {
      const isLeaf = index === segments.length - 1;
      if (isLeaf) {
        level.push({
          id: source.id,
          kind: source.kind ?? "note",
          label: source.label || segment.replace(/\.md$/u, ""),
          path: source.path,
          syncStatus: source.syncStatus,
          tags: source.tags,
        });
        break;
      }
      const folderId = `folder:${segments.slice(0, index + 1).join("/")}`;
      let folder = level.find((node) => node.id === folderId);
      if (!folder) {
        folder = {
          children: [],
          id: folderId,
          kind: "folder",
          label: segment,
          path: segments.slice(0, index + 1).join("/"),
        };
        level.push(folder);
      }
      folder.children ??= [];
      level = folder.children;
    }
  }

  sortTree(root);
  return root;
}

function sortTree(nodes: VaultTreeNode[]) {
  nodes.sort((left, right) => {
    if ((left.kind === "folder") !== (right.kind === "folder")) {
      return left.kind === "folder" ? -1 : 1;
    }
    return left.label.localeCompare(right.label, "fr");
  });
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
}
