import type { LucideIcon } from "lucide-react";
import {
  Activity,
  FolderKanban,
  LayoutDashboard,
  Mail,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
} from "@/components/icons/pack";
import { serverRoleAllows, type ServerAction, type ServerRole } from "../roles";

export const CONSOLE_SECTIONS = [
  "overview",
  "people",
  "access",
  "projects",
  "settings",
  "email",
  "log",
  "checks",
] as const;

export type ConsoleSection = (typeof CONSOLE_SECTIONS)[number];

const SECTION_ACTION: Readonly<Record<ConsoleSection, ServerAction>> = {
  overview: "manageMembers",
  people: "manageMembers",
  access: "manageMembers",
  projects: "manageMembers",
  settings: "manageMembers",
  email: "manageMembers",
  log: "readSecurityLog",
  checks: "manageMembers",
};

export const SECTION_ICONS: Readonly<Record<ConsoleSection, LucideIcon>> = {
  overview: LayoutDashboard,
  people: Users,
  access: ShieldCheck,
  projects: FolderKanban,
  settings: Settings2,
  email: Mail,
  log: ScrollText,
  checks: Activity,
};

export function visibleConsoleSections(role: ServerRole): ConsoleSection[] {
  return CONSOLE_SECTIONS.filter((section) => serverRoleAllows(role, SECTION_ACTION[section]));
}

export function isConsoleSection(value: unknown): value is ConsoleSection {
  return (CONSOLE_SECTIONS as readonly unknown[]).includes(value);
}
