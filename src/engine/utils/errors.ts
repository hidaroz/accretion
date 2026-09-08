export class NoteNotFoundError extends Error {
  constructor(path: string) {
    super(`Note not found: ${path}`);
    this.name = "NoteNotFoundError";
  }
}

export class NoteAlreadyExistsError extends Error {
  constructor(path: string) {
    super(`Note already exists: ${path}`);
    this.name = "NoteAlreadyExistsError";
  }
}


export class VaultNotFoundError extends Error {
  constructor(vaultId: string) {
    super(
      `Unknown vault: "${vaultId}". Use list_vaults to see available vaults.`
    );
    this.name = "VaultNotFoundError";
  }
}



export class WriteNotAllowedError extends Error {
  constructor(path: string, allowed: string[]) {
    super(
      `Write to "${path}" is outside this vault's writable paths (${allowed.join(", ") || "none"}). ` +
        `Curated notes change through proposals; see apply-proposals.`
    );
    this.name = "WriteNotAllowedError";
  }
}


