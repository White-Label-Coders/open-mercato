import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as SqlEntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { selectBestPrice, type PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import { resolveUnitDictionary } from '@open-mercato/core/modules/catalog/lib/unitResolution'
import { CatalogProduct, CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { canonicalizeUnitCode } from '@open-mercato/shared/lib/units/unitCodes'

const lineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  unitPriceGross: z.coerce.number().nonnegative().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  confidence: z.coerce.number().min(0).max(1).optional().default(0.5),
})

const createQuoteQuickActionSchema = z.object({
  actionType: z.literal('create_quote'),
  prefill: z.object({
    source: z.object({
      callId: z.string().trim().min(1).max(191),
      suggestionId: z.string().trim().min(1).max(191),
      triggerSegmentId: z.coerce.number().int(),
    }),
    customerId: z.string().uuid(),
    companyId: z.string().uuid().optional().nullable(),
    channelId: z.string().uuid().optional().nullable(),
    currencyCode: z.string().trim().regex(/^[A-Z]{3}$/).optional().nullable(),
    transcriptSummary: z.string().trim().min(1).max(3000),
    detectedIntents: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    lines: z.array(lineSchema).min(1),
    shippingAddressId: z.string().uuid().optional().nullable(),
    billingAddressId: z.string().uuid().optional().nullable(),
    note: z.string().trim().max(2000).optional().nullable(),
    extractionMethod: z.enum(['llm', 'heuristic', 'heuristic_fallback']).optional().nullable(),
  }),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['voice_channels.copilot.view', 'sales.quotes.manage'] },
}

export const openApi = {
  summary: 'Create a sales quote draft from a voice Copilot quick action',
  tags: ['Voice Channels'],
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

async function runGuards(
  ctx: CommandRuntimeContext,
  input: MutationGuardInput,
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  if (!legacyGuard) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards([legacyGuard], input, {
    userFeatures: resolveUserFeatures(ctx.auth),
  })
}

async function runGuardAfterSuccessCallbacks(
  callbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>,
  input: {
    tenantId: string
    organizationId: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete'
    requestMethod: string
    requestHeaders: Headers
  },
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      ...input,
      metadata: callback.metadata ?? null,
    })
  }
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx }
}

function normalizeMoney(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
  }
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

async function resolveSupportedQuantityUnit(
  em: EntityManager,
  product: CatalogProduct,
  organizationId: string,
  tenantId: string,
): Promise<string | null> {
  const candidate =
    canonicalizeUnitCode(product.defaultSalesUnit ?? null) ??
    canonicalizeUnitCode(product.defaultUnit ?? null)

  if (!candidate) return null

  const dictionary = await resolveUnitDictionary(em as SqlEntityManager, organizationId, tenantId)
  if (!dictionary) return null

  const entry = await em.findOne(DictionaryEntry, {
    dictionary,
    organizationId: dictionary.organizationId,
    tenantId: dictionary.tenantId,
    $or: [{ normalizedValue: candidate }, { value: candidate }],
  })

  if (!entry || typeof entry.value !== 'string' || entry.value.trim().length === 0) {
    return null
  }

  return entry.value.trim()
}

async function resolveCustomer(
  em: EntityManager,
  customerId: string,
  organizationId: string,
  tenantId: string,
): Promise<CustomerEntity> {
  const customer = await em.findOne(CustomerEntity, {
    id: customerId,
    organizationId,
    tenantId,
    deletedAt: null,
  })

  if (!customer) {
    throw new CrudHttpError(400, { error: 'Customer from call context could not be found.' })
  }

  return customer
}

async function resolveChannel(
  em: EntityManager,
  requestedChannelId: string | null | undefined,
  organizationId: string,
  tenantId: string,
): Promise<SalesChannel> {
  if (requestedChannelId) {
    const requested = await em.findOne(SalesChannel, {
      id: requestedChannelId,
      organizationId,
      tenantId,
      deletedAt: null,
      isActive: true,
    })
    if (!requested) {
      throw new CrudHttpError(400, { error: 'Selected sales channel is not available.' })
    }
    return requested
  }

  const channels = await em.find(
    SalesChannel,
    {
      organizationId,
      tenantId,
      deletedAt: null,
      isActive: true,
    },
    {
      orderBy: { createdAt: 'ASC' },
    },
  )

  if (channels.length === 1) return channels[0]

  const demoChannel = channels.find((channel) => channel.code === 'voice_channels_demo')
  if (demoChannel) return demoChannel

  throw new CrudHttpError(400, {
    error: 'Unable to determine a sales channel for this call. Configure a default channel or include channel context.',
  })
}

async function buildQuoteLines(
  em: EntityManager,
  input: z.infer<typeof createQuoteQuickActionSchema>['prefill'],
  organizationId: string,
  tenantId: string,
  channelId: string,
): Promise<Array<Record<string, unknown>>> {
  const lines: Array<Record<string, unknown>> = []

  for (const [index, line] of input.lines.entries()) {
    const product = await em.findOne(CatalogProduct, {
      id: line.productId,
      organizationId,
      tenantId,
      deletedAt: null,
      isActive: true,
    })

    if (!product) {
      throw new CrudHttpError(400, { error: `Product ${line.productId} could not be found.` })
    }

    const priceRows = await em.find(
      CatalogProductPrice,
      {
        product: product.id,
        organizationId,
        tenantId,
      },
      {
        populate: ['offer', 'priceKind'],
      },
    )

    const selectedPrice = selectBestPrice(priceRows as PriceRow[], {
      customerId: input.customerId,
      quantity: line.quantity,
      date: new Date(),
      channelId,
    })

    const currencyCode =
      input.currencyCode ??
      selectedPrice?.currencyCode ??
      priceRows[0]?.currencyCode ??
      'PLN'

    const resolvedUnitPriceGross =
      line.unitPriceGross ??
      normalizeMoney(selectedPrice?.unitPriceGross ?? selectedPrice?.unitPriceNet) ??
      normalizeMoney(priceRows[0]?.unitPriceGross ?? priceRows[0]?.unitPriceNet) ??
      0

    const quantityUnit = await resolveSupportedQuantityUnit(
      em,
      product,
      organizationId,
      tenantId,
    )

    lines.push({
      lineNumber: index + 1,
      kind: 'product',
      ...(quantityUnit ? { productId: product.id, quantityUnit } : {}),
      name: product.title,
      description: typeof line.note === 'string' && line.note.trim().length > 0 ? line.note.trim() : undefined,
      quantity: line.quantity,
      currencyCode,
      unitPriceGross: resolvedUnitPriceGross,
      priceId: selectedPrice?.id ?? undefined,
      metadata: {
        source: 'voice_channels.copilot',
        voiceCallId: input.source.callId,
        confidence: line.confidence,
        catalogProductId: product.id,
        ...(quantityUnit ? {} : { uomFallbackMode: 'custom_line_without_product_link' }),
      },
    })
  }

  return lines
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveRequestContext(req)
    const payload = await req.json().catch(() => ({}))
    const parsed = createQuoteQuickActionSchema.parse(payload)
    const guardResult = await runGuards(ctx, {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
      resourceKind: 'sales.quote',
      resourceId: parsed.prefill.customerId,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload as Record<string, unknown>,
    })

    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
    }

    const em = ctx.container.resolve('em') as EntityManager
    const fork = em.fork()
    const tenantId = ctx.auth?.tenantId ?? ''
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: 'Organization context is required.' })
    }

    await resolveCustomer(fork, parsed.prefill.customerId, organizationId, tenantId)
    const channel = await resolveChannel(fork, parsed.prefill.channelId, organizationId, tenantId)
    const lines = await buildQuoteLines(
      fork,
      parsed.prefill,
      organizationId,
      tenantId,
      channel.id,
    )

    const currencyCode =
      parsed.prefill.currencyCode ??
      (typeof lines[0]?.currencyCode === 'string' ? (lines[0].currencyCode as string) : null) ??
      'PLN'

    const comments = clipText(
      [
        parsed.prefill.note ? parsed.prefill.note : null,
        parsed.prefill.transcriptSummary,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n\n'),
      4000,
    )

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      Record<string, unknown>,
      { quoteId: string }
    >('sales.quotes.create', {
      input: {
        organizationId,
        tenantId,
        customerEntityId: parsed.prefill.customerId,
        channelId: channel.id,
        billingAddressId: parsed.prefill.billingAddressId ?? undefined,
        shippingAddressId: parsed.prefill.shippingAddressId ?? undefined,
        currencyCode,
        validFrom: new Date(),
        comments,
        metadata: {
          source: 'voice_channels.copilot',
          voiceCall: {
            callId: parsed.prefill.source.callId,
            suggestionId: parsed.prefill.source.suggestionId,
            triggerSegmentId: parsed.prefill.source.triggerSegmentId,
            transcriptSummary: parsed.prefill.transcriptSummary,
            detectedIntents: parsed.prefill.detectedIntents,
            companyId: parsed.prefill.companyId ?? null,
            extractionMethod: parsed.prefill.extractionMethod ?? null,
          },
        },
        lines,
      },
      ctx,
    })

    const quoteId = result?.quoteId
    if (!quoteId) {
      throw new CrudHttpError(400, { error: 'Quote creation finished without a quote ID.' })
    }

    if (guardResult.afterSuccessCallbacks.length) {
      await runGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
        tenantId,
        organizationId,
        userId: ctx.auth?.sub ?? '',
        resourceKind: 'sales.quote',
        resourceId: quoteId,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return NextResponse.json({
      quoteId,
      redirectTo: `/backend/sales/quotes/${quoteId}`,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: err.issues?.[0]?.message ?? 'Invalid quick action payload.',
          issues: err.issues,
        },
        { status: 400 },
      )
    }

    console.error('[voice_channels.quick_actions.create-quote] failed', err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to create quote from call.',
      },
      { status: 400 },
    )
  }
}
