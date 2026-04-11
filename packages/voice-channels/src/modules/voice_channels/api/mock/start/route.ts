import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/core'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { MockCallScript } from '@open-mercato/voice-channels/modules/voice_channels/types'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

const startBodySchema = z.object({
  script: z.object({
    callId: z.string().min(1),
    phoneNumber: z.string().min(1),
    direction: z.enum(['inbound', 'outbound']),
    customerId: z.string().min(1),
    customerName: z.string().min(1),
    companyName: z.string().min(1),
    language: z.string().min(1),
    segments: z
      .array(
        z
          .object({
            segmentId: z.number().int().nonnegative(),
            speaker: z.enum(['rep', 'customer']),
            text: z.string().min(1),
            delayMs: z.number().int().nonnegative(),
            expectedIntent: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
  }),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Start a mock call simulation',
  tags: ['Voice Channels'],
}

async function resolveCustomerIdForScript(
  em: EntityManager,
  script: MockCallScript,
  tenantId: string,
  organizationId: string,
): Promise<string | null> {
  const directMatch = await em.findOne(CustomerEntity, {
    id: script.customerId,
    tenantId,
    organizationId,
  })

  if (directMatch) {
    return directMatch.id
  }

  const nameMatch = await em.findOne(
    CustomerEntity,
    {
      tenantId,
      organizationId,
      kind: 'person',
      displayName: script.customerName,
    },
    {
      populate: ['personProfile', 'personProfile.company', 'personProfile.company.companyProfile'],
    },
  )

  const companyName =
    nameMatch?.personProfile?.company?.companyProfile?.legalName ??
    nameMatch?.personProfile?.company?.displayName ??
    null

  if (nameMatch && companyName === script.companyName) {
    return nameMatch.id
  }

  return null
}

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const parsed = startBodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.auth?.orgId
  if (!tenantId || !organizationId) {
    return Response.json({ error: 'Missing tenant/organization scope' }, { status: 401 })
  }

  const repUserId =
    (typeof ctx.auth?.sub === 'string' && ctx.auth.sub) ||
    (typeof (ctx.auth as any)?.userId === 'string' && (ctx.auth as any).userId) ||
    null

  const simulator = ctx.container.resolve<any>('mockTranscriptSimulator')
  const orchestrator = ctx.container.resolve<any>('copilotOrchestrator')
  const em = ctx.container.resolve<EntityManager>('em').fork()

  try {
    const resolvedCustomerId = await resolveCustomerIdForScript(
      em,
      body.script as MockCallScript,
      tenantId,
      organizationId,
    )
    const resolvedScript: MockCallScript =
      resolvedCustomerId
        ? {
            ...body.script,
            customerId: resolvedCustomerId,
          }
        : body.script

    if (!resolvedCustomerId) {
      console.warn(
        `[voice_channels/mock/start] Demo customer not found for "${body.script.customerName}" (${body.script.companyName}); starting mock call without customer context`,
      )
    }

    // Emit call.started FIRST so the client initializes the workspace state
    // (callActive + activeCallId + empty suggestions) before the orchestrator
    // fires its auto-emitted customer_context suggestion. Otherwise the
    // call.started handler wipes the customer_context card via setSuggestions([]).
    const result = await simulator.startCall(resolvedScript, tenantId, organizationId)
    await orchestrator.startSession(
      resolvedScript.callId,
      resolvedCustomerId ?? undefined,
      tenantId,
      organizationId,
      repUserId,
    )
    return Response.json(result)
  } catch (err) {
    console.error('[voice_channels/mock/start] start failed', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to start mock call' },
      { status: 500 },
    )
  }
}
