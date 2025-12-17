/**
 * Re-export types from local copies
 * In production: import * from '@light-engine/api-types'
 */

export * from './api-types';
// Re-export only the device-related types from index
export type {
  CommType,
  SupportBadge,
  LightDefinition,
  SetupGuideStep,
  SetupGuide,
  GroupKind,
  GroupMatch,
  GroupMember,
  DeviceGroup
} from './index-types';
