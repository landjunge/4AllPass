/**
 * GitHub capabilities this vault template understands.
 * Not the full GitHub REST scope list. `repository.delete` is high-risk and
 * denied unless the entry lists it.
 */
export const GitHub = {
  provider: "GitHub",
  repositoryRead: "repository.read",
  repositoryWrite: "repository.write",
  issueRead: "issue.read",
  repositoryDelete: "repository.delete",
} as const;

export const GITHUB_CAPABILITIES = [
  GitHub.repositoryRead,
  GitHub.repositoryWrite,
  GitHub.issueRead,
  GitHub.repositoryDelete,
] as const;
