import { realpathSync } from "node:fs";
import path from "node:path";

export function assertRepositoryAllowedForExternalTransfer(
  repositoryPath: string,
): void {
  const allowedRootsRaw = process.env.GIVILOOP_ALLOWED_REPOSITORIES;

  if (!allowedRootsRaw?.trim()) {
    return;
  }

  const repositoryRealPath = realpathSync(repositoryPath);
  const allowedRoots = allowedRootsRaw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => realpathSync(path.resolve(entry)));

  if (
    allowedRoots.some((allowedRoot) =>
      isPathInside(allowedRoot, repositoryRealPath),
    )
  ) {
    return;
  }

  throw new Error(
    [
      "Repository is not allowed for external transfer.",
      `Repository: ${repositoryPath}`,
      "Set GIVILOOP_ALLOWED_REPOSITORIES to include this repository root before sending to a web LLM.",
    ].join("\n"),
  );
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}
