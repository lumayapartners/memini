#!/usr/bin/env node
// Lightweight hook entrypoint: loads only what guardrails need (no commander,
// no MCP SDK) so the per-edit latency stays low. Invoked by the generated shim
// in .memini/hooks/ — see installClaudeHooks().
import { runPreToolUseHook, runSessionStartHook } from './hooks.js';

const event = process.argv[2];
if (event === 'claude-pre-tool-use') await runPreToolUseHook();
else if (event === 'claude-session-start') await runSessionStartHook();
// unknown events exit 0 silently: fail open, forward compatible
