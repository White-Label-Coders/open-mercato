**Date:** 2026-04-11
**Status:** Approved for Implementation
**Scope:** OSS
**Consensus:** Peer review agreed the decentralization direction is sound and implementation-ready after applying the critical fixes from review: use the existing in-process MCP bridge, hydrate ACL from the base session auth context, register manifests at bootstrap instead of using `@/` imports inside packages, preserve Code Mode `search` and `execute` as migration fallback tools, reuse the existing `McpToolDefinition` contract, preserve current CRUD prompt recipes, and promote API Whitelist Auto-Tools into the Phase 5 roadmap.

## 1. Summary

Open Mercato will migrate the AI assistant from the current OpenCode-centered architecture to a decentralized, module-driven architecture built on the Vercel AI SDK while preserving existing capabilities during rollout.

The target design keeps one chat entrypoint but decentralizes domain knowledge into module-owned `ai-manifest.ts` declarations. Each manifest contributes routing metadata, domain context, optional dependencies on other modules, and module-owned tool sets. The native chat path will execute tools through the existing `InProcessMcpClient` and `mcp-tool-adapter.ts`, not through a new dispatcher.

The migration is intentionally additive. OpenCode remains available behind a feature flag during rollout, and legacy Code Mode `search` and `execute` stay available as fallback tools until all critical CRM, Sales, Catalog, and utility capabilities have first-class manifest coverage.

## 2. Motivation

The current architecture has three structural problems:

1. Code Mode centralizes all knowledge behind two meta-tools, `search` and `execute`, which flatten the platform into one opaque tool surface.
2. OpenCode owns the conversation loop outside the application, limiting in-app extensibility, prompt composition, routing control, and operational simplicity.
3. Existing module `ai-tools.ts` definitions are typed and generated but effectively dormant in the current chat flow.

This specification resolves those issues without discarding working infrastructure already present on the branch. The in-process MCP client, MCP-to-AI-SDK adapter, and current tool registry are now treated as the migration base. The change therefore focuses on manifest declaration, routing, prompt composition, bootstrap registration, and a native chat execution path rather than inventing a new tool runtime.

## 3. Architecture Overview

### 3.1 Updated Runtime Flow

```text
Frontend chat UI
  -> POST /api/chat
  -> native route selected when AI_CHAT_MODE=native

Chat Route
  -> getAuthFromRequest(req)
  -> createRequestContainer()
  -> rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId })
  -> build hydrated auth context:
     userId=auth.sub, tenantId=auth.tenantId, organizationId=auth.orgId,
     userFeatures=acl.features, isSuperAdmin=derived from ACL/roles
  -> getAiManifests() and merge legacy ai-tools runtime wrappers
  -> manifest router selects active modules plus contextDependencies
  -> prompt-composer builds system prompt from base rules + active manifests + page context
  -> InProcessMcpClient.createWithAuthContext(...)
  -> listToolsWithSchemas()
  -> filter to active manifest tools + context_whoami + legacy Code Mode search/execute fallback
  -> convertMcpToolsToAiSdk()
  -> streamText()
  -> SSE/data stream response
```

### 3.2 Architectural Mapping

The approved architecture reflects both the reviewed draft and the whiteboard schema:

- The chat component continues to call a single Vercel API endpoint.
- A central manifest registry is populated during bootstrap, not by package-local `@/` imports.
- The prompt is composed centrally from platform rules plus module fragments.
- Module manifests remain the ownership boundary for domain context and tools.
- Phase 5 may add module-specialized agents or sub-agents, but Phase 2 and Phase 3 stay on one native chat loop.

### 3.3 Core Design Rules

- Phase 2 must use the existing `InProcessMcpClient` and `mcp-tool-adapter.ts` bridge to Vercel AI SDK.
- No new parallel tool dispatcher is introduced.
- `AiManifest` is additive to the module system.
- The canonical tool contract remains the existing MCP tool contract. The spec must not introduce a second `AiToolDefinition`.
- Prompt composition must preserve current Open Mercato CRUD rules, not replace them with generic assistant guidance.
- Code Mode `search` and `execute` remain available during migration to avoid CRM/Sales/Catalog regressions.

## 4. Phased Implementation Plan

### Phase 1. Foundation and Bootstrap Registration

Goals:

- Add manifest support without breaking current chat behavior.
- Introduce manifest registration through bootstrap.
- Keep the existing MCP tool contract as the single type source.

Scope:

- Create `packages/shared/src/modules/ai.ts` with:
  - `AiManifest`
  - `AiDataCapability`
  - `AiContextDependency`
  - bootstrap registry helpers `registerAiManifests()` and `getAiManifests()`
- Do not create a new `AiToolDefinition`.
- Re-export the existing `McpToolDefinition` from `@open-mercato/ai-assistant/types` for manifest tool typing.
- Extend `packages/shared/src/modules/registry.ts` with optional `aiManifest?: AiManifest`.
- Add CLI generator support for `ai-manifest.ts` discovery and output `ai-manifests.generated.ts`.
- Update `apps/mercato/src/bootstrap.ts` to import generated manifest entries and call `registerAiManifests(aiManifestEntries)`.

Required outcome:

- Packages can consume manifests via shared registration helpers without relying on the app-only `@/` alias.

### Phase 2. Native Vercel AI SDK Chat Route

Goals:

- Stand up the native chat path in parallel with OpenCode.
- Reuse the branch’s existing in-process MCP infrastructure.
- Preserve current capability coverage during migration.

Scope:

- Add a native chat route or native branch in the current chat route behind `AI_CHAT_MODE=native`.
- Authenticate with the base session flow using `getAuthFromRequest(req)`.
- Resolve `rbacService` from the request container and call:
  - `rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId })`
- Build the hydrated tool auth context from that ACL result:
  - `userId = auth.sub`
  - `tenantId = auth.tenantId`
  - `organizationId = auth.orgId`
  - `userFeatures = loaded ACL features`
  - `isSuperAdmin = derived from ACL or role state`
- Create `InProcessMcpClient` with `createWithAuthContext`.
- Call `listToolsWithSchemas()`, convert tools through `convertMcpToolsToAiSdk()`, and execute through `streamText()`.
- Compose prompts with `prompt-composer.ts`.
- Load manifests through `getAiManifests()`.
- Merge runtime fallback manifests for legacy `ai-tools.ts` modules that do not yet have an `ai-manifest.ts`.
- Always include `context_whoami`, `search`, and `execute` in the filtered tool set even when they are outside the currently selected manifest tool names.

Required outcome:

- Native chat works with proper ACL enforcement and no loss of CRM/Sales/Catalog capability.

### Phase 3. Manifest Router, Prompt Composer, and Module Migration

Goals:

- Move module intelligence into manifests.
- Add routing and prompt composition that are domain-aware but deterministic.

Scope:

- Create `manifest-router.ts` that:
  - routes by manifest domain, description, keywords, and data capability metadata
  - respects manifest `requiredFeatures`
  - activates `contextDependencies`
  - always includes `search` when available
  - merges runtime wrappers for legacy tool-only modules
- Create `prompt-composer.ts` with structured sections for:
  - role
  - auth context
  - active modules
  - page/current-record context
  - module-specific guidance
  - platform guidelines
- The platform guidelines must preserve existing Open Mercato CRUD recipes, including:
  - read operations use GET only
  - PUT uses the collection path and requires the record ID in the request body
  - confirmation is required before any write operation
  - maximum tool-call discipline from the current chat prompt
  - existing create/update/list conventions already used by the current assistant
- Migrate and prioritize manifests in this order:
  - `search`
  - `inbox_ops`
  - `customers`
  - `sales`
  - `catalog`
  - `auth`
  - `dictionaries`

Required outcome:

- The assistant routes to relevant modules with module-owned context while preserving platform-specific interaction rules.

### Phase 4. OpenCode Retirement

Goals:

- Remove the old orchestration path only after native parity is demonstrated.

Scope:

- Switch `AI_CHAT_MODE` default to native after rollout validation.
- Remove OpenCode-specific route logic, client code, handlers, and env-driven operational dependencies.
- Keep removal gated on functional parity for:
  - native chat streaming
  - confirmation flows
  - ACL-safe tool exposure
  - CRM/Sales/Catalog common operations
- Remove Code Mode fallback only when critical module coverage is complete and validated.

Required outcome:

- Native Vercel AI SDK chat becomes the only production path with no dependency on OpenCode.

### Phase 5. Advanced Features Roadmap

Goals:

- Build higher-order assistant capabilities once the native manifest architecture is stable.

Scope:

- Module-scoped specialist agents or sub-agents for deep domain flows.
- Hybrid or vector-assisted manifest routing.
- Page-aware context resolvers and standardized module context providers.
- API Whitelist Auto-Tools:
  - manifests may whitelist approved OpenAPI endpoints for discrete tool generation
  - generated tools must remain ACL-aware and route-safe
  - this is the approved path to scale CRUD tool coverage without recreating Code Mode opacity

Required outcome:

- Advanced assistant capabilities can expand without recentralizing tool ownership.

## 5. Environment Variables

Required and transitional environment variables:

- `AI_CHAT_MODE`
  - values: `opencode`, `native`
  - default remains `opencode` until Phase 4 promotion
- `AI_PROVIDER`
  - preferred provider selector for native chat
- `AI_MODEL`
  - preferred global model override for native chat
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`

Backward-compatible transitional variables:

- `OPENCODE_PROVIDER`
  - read as fallback while provider naming is migrated
- `OPENCODE_MODEL`
  - read as fallback while model naming is migrated
- Existing OpenCode runtime variables remain supported until Phase 4 removal.

Resolution rules:

- Native chat resolves provider and model through the shared provider abstraction.
- New `AI_*` variables take precedence.
- Legacy `OPENCODE_*` variables remain fallback-compatible during transition only.

## 6. Backward Compatibility & Deprecation Protocol

This specification changes contract surfaces additively and follows the repository deprecation rules.

Compatibility commitments:

- `Module.aiManifest` is optional and additive.
- Existing `ai-tools.ts` modules remain supported through runtime manifest wrapping during migration.
- Existing MCP tool registration and execution paths remain canonical in Phases 1 through 3.
- OpenCode remains available behind feature flag until native parity is proven.
- Legacy Code Mode `search` and `execute` remain exposed during migration to prevent functional regression.
- Existing import contracts for tool definitions remain intact by reusing `@open-mercato/ai-assistant/types`.

Deprecation protocol:

1. Introduce native chat and manifest registry without removing OpenCode or Code Mode fallback.
2. Mark legacy OpenCode-oriented provider naming and wrappers as deprecated in code and docs.
3. Keep bridge wrappers and fallback env names for at least one minor version.
4. Document the migration in release notes when the default switches to native.
5. Remove OpenCode and Code Mode fallback only after Phase 4 verification is complete.

## 7. Test Strategy

Test coverage must validate both migration safety and final behavior.

Unit coverage:

- `AiManifest` registration and retrieval helpers.
- Manifest router scoring, feature filtering, and dependency activation.
- Runtime merge of manifest entries with legacy `ai-tools.ts` modules.
- Prompt composer output, including preserved CRUD recipes.
- Provider/model resolution precedence.

Integration coverage:

- Native chat route authentication and ACL hydration using `rbacService.loadAcl`.
- Tool filtering includes:
  - active manifest tools
  - `context_whoami`
  - fallback Code Mode `search`
  - fallback Code Mode `execute`
- Native chat streaming with `InProcessMcpClient` and `convertMcpToolsToAiSdk()`.
- Bootstrap registration path from `apps/mercato/src/bootstrap.ts` through `getAiManifests()`.
- Cross-module routing for common CRM and Sales flows.

Regression scenarios:

- CRM lookup and update flows still work before customers/sales manifests are fully implemented.
- Confirmation is still required before writes.
- PUT requests still follow collection-path plus ID-in-body rules.
- Users without required features do not see or execute restricted tools.
- Native chat and OpenCode mode can coexist during rollout.

Recommended end-to-end scenarios:

1. Find a customer or product through native chat.
2. Create or update a sales document with confirmation gating.
3. Open chat from a module page and confirm page context improves routing.
4. Verify feature-gated tools are excluded for a restricted user.
5. Verify fallback `search` and `execute` remain usable for unmigrated modules.

## 8. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Native chat ships with incomplete auth context hydration | High | Phase 2 must load ACL from `rbacService.loadAcl` using the base session auth context before tool exposure |
| Package code attempts to import generated manifests through `@/` | High | Register manifests at app bootstrap via `registerAiManifests()` and consume them through `getAiManifests()` |
| CRM/Sales/Catalog capability regresses during migration | High | Keep legacy Code Mode `search` and `execute` in the filtered native tool set until Phase 4 retirement |
| Duplicate tool type definitions drift | Medium | Reuse and re-export the existing `McpToolDefinition` contract from `@open-mercato/ai-assistant/types` |
| Generic prompt rules break current CRUD behavior | High | Port existing chat-route CRUD recipes directly into `prompt-composer.ts` guidelines |
| Tool count grows too large as manifests spread | Medium | Route by manifest relevance, keep `search` universal, and limit active module/tool sets per request |
| OpenCode removal happens before parity | High | Keep feature-flag rollout and require integration parity before Phase 4 deletion |
| Phase 5 re-centralizes logic through automation shortcuts | Medium | Keep module ownership of manifests and treat API Whitelist Auto-Tools as manifest-scoped generation, not global opaque execution |
