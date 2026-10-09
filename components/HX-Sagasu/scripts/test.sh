#!/usr/bin/env bash
# HX-Sagasu 测试入口。本仓库其他组件没有统一 test runner 约定 (HX-Memory 用 vitest),
# 这里刻意用 Node 内置 test runner + 原生 TypeScript 支持: 零依赖、零构建步骤,
# 因此不会因为"忘了 build"而让门禁变绿或变红。Node >= 22.6 即可。
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --test "tests/*.test.ts"
