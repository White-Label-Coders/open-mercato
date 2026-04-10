import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['voice_channels.*'],
    admin: ['voice_channels.*'],
    employee: ['voice_channels.copilot.view'],
  },
}

export default setup
