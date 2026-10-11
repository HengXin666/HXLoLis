import type { Severity } from "./model.ts";

export const UTF8 = "utf8";
export const ERROR: Severity = "error";
export const WARNING: Severity = "warning";

export const QUALITY_ROOT = "scripts/.hx_code_quality";
export const REPORTS_DIR = QUALITY_ROOT + "/reports";
export const BUILD_DIR = QUALITY_ROOT + "/build";
export const CACHE_DIR = QUALITY_ROOT + "/cache";
export const CI_CONFIG = "scripts/quality/ci.json";
export const BASELINE_FILE = "scripts/quality/baseline.json";
export const TEST_PLAN = "test-plan.json";

export const CI_RULE = "HC-CI";
export const META_RULE = "HC-META";
export const TOOL_ERROR_RULE = "tool-error";
export const LITERAL_RULE = "HC-LITERAL";
export const ABSPATH_RULE = "HC-ABSPATH";

export const CHECK_GROUPS = ["code", "docs", "build", "compatibility"] as const;
export const REQUIRED_GROUPS = ["code", "docs"] as const;
export const TEST_GROUP = "tests";
export const CI_GROUPS = [...CHECK_GROUPS, TEST_GROUP] as const;

export const EVENT_LOCAL = "local";
export const EVENT_PUSH = "push";
export const EVENT_PR = "pr";
export const EMPTY_BASE = "EMPTY";
export const GIT_MAX_BUFFER = 64 * 1024 * 1024;
export const OUTPUT_MAX_BUFFER = 16 * 1024 * 1024;
export const DETAIL_LIMIT = 10;
export const LITERAL_THRESHOLD = 3;
