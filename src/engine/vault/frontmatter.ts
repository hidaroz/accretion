import matter from "gray-matter";

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  content: string;
}

export function parseNote(raw: string): ParsedNote {
  const { data, content } = matter(raw);
  return { frontmatter: data, content };
}

export function stringifyNote(
  content: string,
  frontmatter: Record<string, unknown>
): string {
  // Only add frontmatter block if there are fields
  if (Object.keys(frontmatter).length === 0) {
    return content;
  }
  return matter.stringify(content, frontmatter);
}


/**
 * Extract title from frontmatter or first H1 heading, falling back to filename.
 */
export function extractTitle(
  frontmatter: Record<string, unknown>,
  content: string,
  filePath: string
): string {
  if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
    return frontmatter.title.trim();
  }

  // Look for first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Fall back to filename without extension
  const basename = filePath.split("/").pop() || filePath;
  return basename.replace(/\.md$/i, "");
}

/**
 * Extract tags from frontmatter and inline #tags.
 */
export function extractTags(
  frontmatter: Record<string, unknown>,
  content: string
): string[] {
  const tags = new Set<string>();

  // From frontmatter
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === "string") tags.add(t.toLowerCase());
    }
  } else if (typeof fmTags === "string") {
    for (const t of fmTags.split(",")) {
      const trimmed = t.trim().toLowerCase();
      if (trimmed) tags.add(trimmed);
    }
  }

  // Inline #tags
  const inlineTagRegex = /(?:^|\s)#([a-zA-Z][\w/-]*)/g;
  let match;
  while ((match = inlineTagRegex.exec(content)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags).sort();
}
