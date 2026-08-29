import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

// Skills packs v1: distributable workflow instructions living at
// ~/.oleafly/skills/<id>/ (SKILL.md + manifest.json, seeded by the backend).
// The manifest is zod-validated here; invalid packs are skipped, never fatal.
// sha256 reserves the pin slot for the future signed CDN catalog.

export interface RawSkillPack {
  id: string;
  manifest_json: string;
  skill_md: string;
}

const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1).default("0.0.0"),
  description: z.string().default(""),
  sha256: z.record(z.string()).optional(),
});

export interface SkillPack {
  id: string;
  name: string;
  version: string;
  description: string;
  instructions: string;
}

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

function parseFrontmatter(markdown: string): Frontmatter {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: markdown.trim() };
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return { fields, body: match[2].trim() };
}

export function parseSkillPacks(raw: RawSkillPack[]): SkillPack[] {
  const packs: SkillPack[] = [];
  for (const pack of raw) {
    const { fields, body } = parseFrontmatter(pack.skill_md);
    if (!body) continue;
    let name = fields.name ?? pack.id;
    let version = "0.0.0";
    let description = fields.description ?? "";
    if (pack.manifest_json.trim()) {
      let manifestRaw: unknown;
      try {
        manifestRaw = JSON.parse(pack.manifest_json);
      } catch {
        continue;
      }
      const manifest = manifestSchema.safeParse(manifestRaw);
      if (!manifest.success) continue;
      name = manifest.data.name;
      version = manifest.data.version;
      description = manifest.data.description || description;
    }
    packs.push({ id: pack.id, name, version, description, instructions: body });
  }
  return packs;
}

export async function loadSkillPacks(): Promise<SkillPack[]> {
  const raw = await invoke<RawSkillPack[]>("skills_list");
  return parseSkillPacks(raw);
}

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: loadSkillPacks,
    staleTime: 60_000,
    meta: { silent: true },
  });
}
