import { cf } from '@open-mercato/shared/modules/dsl'

export const entities = [
  {
    id: 'customers:customer_company_profile',
    fields: [
      cf.multiline('copilot_context_company', {
        label: 'Copilot context (company)',
        description:
          'Long-form, AI-maintained memory of the customer relationship: pain points, decisions, commitments, people, competitors. Read at call start, refreshed at call end by the Voice Copilot.',
        listVisible: false,
      }),
    ],
  },
]

export default entities
