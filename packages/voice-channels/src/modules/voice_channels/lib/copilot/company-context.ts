import type { EntityManager } from '@mikro-orm/core'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'

export const COPILOT_CONTEXT_COMPANY_FIELD = 'copilot_context_company'
export const COPILOT_CONTEXT_ENTITY_ID = 'customers:customer_company_profile'
export const COPILOT_CONTEXT_MAX_LENGTH = 1500

export type CompanyResolution = {
  companyEntityId: string
  companyProfileId: string
  companyName: string | null
}

type Scope = {
  tenantId: string
  organizationId: string
}

/**
 * Resolve the company linked to a customer record.
 *
 * - If `customerId` points to a person record, returns the linked company
 *   (via `personProfile.company`).
 * - If `customerId` points to a company record itself, returns it directly.
 * - Returns `null` when no company association exists.
 *
 * The custom field on `customers:customer_company_profile` is keyed by the
 * `CustomerCompanyProfile.id` (not the parent `CustomerEntity.id`), so callers
 * must use `companyProfileId` as the recordId for read/write operations.
 */
export async function resolveCompanyForCustomer(
  em: EntityManager,
  customerId: string,
  scope: Scope,
): Promise<CompanyResolution | null> {
  const customer = await em.findOne(
    CustomerEntity,
    {
      id: customerId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    {
      populate: [
        'personProfile',
        'personProfile.company',
        'personProfile.company.companyProfile',
        'companyProfile',
      ],
    },
  )

  if (!customer) return null

  if (customer.kind === 'company' && customer.companyProfile) {
    return {
      companyEntityId: customer.id,
      companyProfileId: customer.companyProfile.id,
      companyName:
        customer.companyProfile.legalName ?? customer.companyProfile.brandName ?? null,
    }
  }

  if (customer.kind === 'person' && customer.personProfile?.company) {
    const company = customer.personProfile.company
    if (!company.companyProfile) return null
    return {
      companyEntityId: company.id,
      companyProfileId: company.companyProfile.id,
      companyName:
        company.companyProfile.legalName ?? company.companyProfile.brandName ?? null,
    }
  }

  return null
}

/**
 * Read the persisted Copilot context document for a company.
 * Returns null when nothing has been saved yet.
 */
export async function readCompanyContext(
  em: EntityManager,
  companyProfileId: string,
  scope: Scope,
): Promise<string | null> {
  const row = await em.findOne(CustomFieldValue, {
    entityId: COPILOT_CONTEXT_ENTITY_ID,
    recordId: companyProfileId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    fieldKey: COPILOT_CONTEXT_COMPANY_FIELD,
  })
  if (!row) return null
  const text = row.valueMultiline ?? row.valueText ?? null
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Persist the Copilot context document for a company.
 * Truncates to COPILOT_CONTEXT_MAX_LENGTH characters to bound storage size.
 */
export async function writeCompanyContext(
  em: EntityManager,
  companyProfileId: string,
  context: string,
  scope: Scope,
): Promise<void> {
  const trimmed = context.trim()
  if (trimmed.length === 0) return
  const bounded =
    trimmed.length <= COPILOT_CONTEXT_MAX_LENGTH
      ? trimmed
      : `${trimmed.slice(0, COPILOT_CONTEXT_MAX_LENGTH - 1).trimEnd()}…`

  await setRecordCustomFields(em, {
    entityId: COPILOT_CONTEXT_ENTITY_ID,
    recordId: companyProfileId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    values: { [COPILOT_CONTEXT_COMPANY_FIELD]: bounded },
  })
  await em.flush()
}
