import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * HXLoLis 接入 Agent Notes v2
 * .agents/notes/implemented/process/2026-10-08-repository-agent-notes-v2-adoption.md
 */
export type { ClassValue };

export function cn(...parts: ClassValue[]): string {
	return twMerge(clsx(parts));
}
